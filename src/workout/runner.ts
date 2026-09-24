import type { Database } from '@nozbe/watermelondb';
import { dispatch } from '../engine';
import { makeDbActions } from '../data/actions';
import { definitionOf, cursorOf, serializeRoutine } from '../data/serialize';
import { Routine, WorkoutSession } from '../data/models';
import type { EngineEvent, ExecutionCursor, RoutineDefinition, TimerState } from '../types/engine';
import { scheduleTimerNotification, cancelTimerNotification } from '../notifications';

/**
 * Application layer between the pure engine and WatermelonDB.
 * Owns: snapshot at start, effect application, cursor persistence, notification side effects.
 * Never interprets transitions — that stays in the engine.
 */

export interface WorkoutRuntime {
  sessionId: string;
  session: WorkoutSession;
  definition: RoutineDefinition;
  cursor: ExecutionCursor;
}

const notificationIds = new Map<string, string | null>();

async function clearSessionNotification(sessionId: string): Promise<void> {
  await cancelTimerNotification(notificationIds.get(sessionId) ?? null);
  notificationIds.set(sessionId, null);
}

/**
 * Reconcile the local notification with the canonical cursor timer.
 * Called on load / app-resume / process-death recovery — never invents timer state.
 */
export async function reconcileTimerNotification(
  sessionId: string,
  timer: TimerState | null,
  now: number,
): Promise<void> {
  if (!timer || timer.expiresAt <= now) {
    await clearSessionNotification(sessionId);
    return;
  }
  // Fresh schedule on every reconcile: process death loses the in-memory id map,
  // and a stale notification for a past expiry must not survive recovery.
  await cancelTimerNotification(notificationIds.get(sessionId) ?? null);
  const id = await scheduleTimerNotification(
    timer.expiresAt,
    timer.kind === 'rest' ? 'Rest complete' : 'Next',
  );
  notificationIds.set(sessionId, id);
}

/**
 * Starts a new active session for a routine.
 * Guarantees a single active session by discarding any previous one (UI confirms first).
 */
export async function startWorkoutSession(db: Database, routineId: string): Promise<string> {
  const actions = makeDbActions(db);
  const previous = await actions.getActiveSession();
  if (previous) {
    await clearSessionNotification(previous.id);
    await actions.discardSession(previous);
  }
  const routine = await db.get<Routine>('routines').find(routineId);
  const definition = await serializeRoutine(db, routine);
  return actions.startSession(routine, definition);
}

export async function loadWorkoutRuntime(db: Database, sessionId: string): Promise<WorkoutRuntime | null> {
  try {
    const session = await db.get<WorkoutSession>('workout_sessions').find(sessionId);
    if (!session) return null;
    return {
      sessionId: session.id,
      session,
      definition: definitionOf(session),
      cursor: cursorOf(session),
    };
  } catch {
    return null;
  }
}

export async function loadActiveWorkout(db: Database): Promise<WorkoutRuntime | null> {
  const actions = makeDbActions(db);
  const session = await actions.getActiveSession();
  if (!session) return null;
  return loadWorkoutRuntime(db, session.id);
}

/**
 * Dispatch an engine event, apply DB effects, handle notification side effects,
 * and persist the canonical cursor (or complete the session).
 */
export async function applyWorkoutEvent(
  db: Database,
  rt: WorkoutRuntime,
  event: EngineEvent,
): Promise<WorkoutRuntime> {
  const actions = makeDbActions(db);
  const result = dispatch(rt.definition, rt.cursor, event);
  const cursor = await actions.applyEffects(rt.session, result.cursor, result.effects);

  for (const effect of result.effects) {
    if (effect.kind === 'SCHEDULE_NOTIFICATION') {
      const id = await scheduleTimerNotification(effect.expiresAt, effect.title);
      notificationIds.set(rt.sessionId, id);
    } else if (effect.kind === 'CANCEL_NOTIFICATION') {
      await clearSessionNotification(rt.sessionId);
    }
  }

  // Belt-and-suspenders: completion always cancels any leftover rest alert.
  if (cursor.status === 'completed') {
    await clearSessionNotification(rt.sessionId);
    await actions.completeSession(rt.session, cursor);
  } else {
    await actions.persistCursor(rt.session, cursor);
  }

  return { ...rt, cursor };
}

export async function discardWorkout(db: Database, rt: WorkoutRuntime): Promise<void> {
  const actions = makeDbActions(db);
  await clearSessionNotification(rt.sessionId);
  await actions.discardSession(rt.session);
}

/** Frozen rule: truth is cursor.timer.expiresAt; UI recomputes remaining from Date.now(). */
export function isTimerExpired(cursor: ExecutionCursor, now: number): boolean {
  return cursor.timer !== null && cursor.timer.expiresAt <= now;
}
