import { Database, Q } from '@nozbe/watermelondb';
import { WorkoutSession, SetLog } from './models';
import { definitionOf } from './serialize';
import { normalizeSessionEndReason, type SessionEndReason } from '../types/engine';
import type { RoutineDefinition, BlockDef, StepDef } from '../types/engine';

/**
 * History queries — terminal sessions (completed + incomplete), newest first.
 * Active sessions never appear here; discarded sessions are soft-deleted.
 * Historical structure always comes from the session's immutable definition_json snapshot.
 */

export interface HistoryListItem {
  id: string;
  name: string;
  startedAt: number;
  endedAt: number | null;
  durationMs: number | null;
  setCount: number;
  /** Terminal state: 'completed' | 'incomplete' (legacy rows read 'completed'). */
  status: string;
  /** Athlete-stated stop-early reason; null unless status is 'incomplete'. */
  incompleteReason: SessionEndReason | null;
}

export interface HistorySetLog {
  id: string;
  blockIndex: number;
  stepIndex: number;
  round: number;
  setIndex: number;
  weightGrams: number | null;
  reps: number | null;
  durationMs: number | null;
  distanceMm: number | null;
  rir: number | null;
  isCompleted: number;
  completedAt: number | null;
}

export interface HistoryStepRow {
  blockIndex: number;
  stepIndex: number;
  round: number;
  setIndex: number;
  weightGrams: number | null;
  reps: number | null;
  durationMs: number | null;
  rir: number | null;
  /** Phase 3C execution marking; absent/null = legacy normal row. */
  executionType?: string | null;
  /** Phase 3C athlete-stated reason; null = none stated. */
  overrideReason?: string | null;
}

/** A prescribed position recorded as skipped (Phase 3C adherence record). */
export interface HistorySkippedRow {
  blockIndex: number;
  stepIndex: number;
  round: number;
  setIndex: number;
}

/** Explicit substitution recorded on a step (1.1.0); null = as programmed. */
export interface HistorySubstitution {
  actualExerciseName: string;
  reason: string | null;
}

export interface HistoryBlockView {
  blockIndex: number;
  name: string;
  kind: string;
  /** Programming role metadata (1.1.0); null = main. */
  role: string | null;
  rounds: number;
  steps: Array<{
    stepIndex: number;
    exerciseName: string;
    targetSets: number | null;
    targetRepsMin: number | null;
    targetRepsMax: number | null;
    targetWeightGrams: number | null;
    targetDurationMs: number | null;
    targetRir: number | null;
    logs: HistoryStepRow[];
    /** Skipped prescribed positions (never performed, never voided). */
    skipped: HistorySkippedRow[];
    /** Per-exercise note (1.1.0); null = none. */
    exerciseNote: string | null;
    /** Explicit substitution (1.1.0); null = as programmed. */
    substitution: HistorySubstitution | null;
  }>;
}

export interface HistoryDetail {
  id: string;
  name: string;
  startedAt: number;
  endedAt: number | null;
  durationMs: number | null;
  status: string;
  /** Athlete-stated stop-early reason; null unless status is 'incomplete'. */
  incompleteReason: SessionEndReason | null;
  /** Post-workout session note (schema v5); null when absent. */
  note: string | null;
  definition: RoutineDefinition;
  blocks: HistoryBlockView[];
  totalCompletedSets: number;
}

/** Read the stop-early reason from canonical cursor_json (never inferred). */
function reasonOf(session: WorkoutSession): SessionEndReason | null {
  try {
    const cursor = JSON.parse(session.cursorJson) as { incompleteReason?: unknown };
    return normalizeSessionEndReason(cursor?.incompleteReason);
  } catch {
    return null;
  }
}

function durationOf(startedAt: number, endedAt: number | null): number | null {
  if (endedAt === null || endedAt < startedAt) return null;
  return endedAt - startedAt;
}

/** Terminal sessions (completed + incomplete), newest first. Does not load set_logs (N+1 avoided via one grouped query). */
export async function listCompletedSessions(db: Database): Promise<HistoryListItem[]> {
  const sessions = await db
    .get<WorkoutSession>('workout_sessions')
    .query(Q.where('session_status', Q.oneOf(['completed', 'incomplete'])), Q.sortBy('ended_at', 'desc'))
    .fetch();

  if (sessions.length === 0) return [];

  const sessionIds = sessions.map((s) => s.id);
  const logs = await db
    .get<SetLog>('set_logs')
    .query(Q.where('session_exercise_id', Q.oneOf(await sessionExerciseIds(db, sessionIds))))
    .fetch();

  // Count completed sets per session via session_exercises bridge.
  const seRows = await db
    .get<any>('session_exercises')
    .query(Q.where('session_id', Q.oneOf(sessionIds)))
    .fetch();
  const seById = new Map(seRows.map((r: { id: string; sessionId: string }) => [r.id, r.sessionId]));
  const countBySession = new Map<string, number>();
  for (const log of logs) {
    if (log.isCompleted !== 1) continue;
    const sid = seById.get(log.sessionExerciseId);
    if (!sid) continue;
    countBySession.set(sid, (countBySession.get(sid) ?? 0) + 1);
  }

  return sessions.map((s) => ({
    id: s.id,
    name: s.name,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    durationMs: durationOf(s.startedAt, s.endedAt),
    setCount: countBySession.get(s.id) ?? 0,
    status: s.sessionStatus,
    incompleteReason: reasonOf(s),
  }));
}

async function sessionExerciseIds(db: Database, sessionIds: string[]): Promise<string[]> {
  const rows = await db
    .get<any>('session_exercises')
    .query(Q.where('session_id', Q.oneOf(sessionIds)))
    .fetch();
  return rows.map((r: { id: string }) => r.id);
}

/**
 * Load one terminal session's detail from its snapshot + set_logs.
 * Returns null if missing / active / corrupt snapshot.
 */
export async function loadSessionDetail(db: Database, sessionId: string): Promise<HistoryDetail | null> {
  try {
    const session = await db.get<WorkoutSession>('workout_sessions').find(sessionId);
    if (!session || (session.sessionStatus !== 'completed' && session.sessionStatus !== 'incomplete')) return null;
    const definition = definitionOf(session);
    if (!definition || !Array.isArray(definition.blocks)) return null;

    const seRows = await db
      .get<any>('session_exercises')
      .query(Q.where('session_id', sessionId))
      .fetch();
    const seIds = seRows.map((r: { id: string }) => r.id);
    // Session-exercise rows keyed by position for notes + explicit substitutions.
    const seByPosition = new Map(
      seRows.map((r: { blockIndex: number; orderIndex: number }) => [`${r.blockIndex}:${r.orderIndex}`, r]),
    );

    const allLogs: SetLog[] =
      seIds.length === 0
        ? []
        : await db.get<SetLog>('set_logs').query(Q.where('session_exercise_id', Q.oneOf(seIds))).fetch();

    // Group logs by block/step (ignore voided rows for display of performed sets).
    // Skipped records (isCompleted 0 + execution_type 'skipped') are collected
    // separately for adherence display; voided rows stay invisible.
    const logsByStep = new Map<string, HistoryStepRow[]>();
    const skippedByStep = new Map<string, HistorySkippedRow[]>();
    let totalCompletedSets = 0;
    for (const log of allLogs) {
      const key = `${log.blockIndex}:${log.stepIndex}`;
      if (log.isCompleted !== 1) {
        if (log.executionType === 'skipped') {
          const list = skippedByStep.get(key) ?? [];
          list.push({
            blockIndex: log.blockIndex,
            stepIndex: log.stepIndex,
            round: log.round,
            setIndex: log.setIndex,
          });
          skippedByStep.set(key, list);
        }
        continue;
      }
      totalCompletedSets += 1;
      const list = logsByStep.get(key) ?? [];
      list.push({
        blockIndex: log.blockIndex,
        stepIndex: log.stepIndex,
        round: log.round,
        setIndex: log.setIndex,
        weightGrams: log.weightGrams,
        reps: log.reps,
        durationMs: log.durationMs,
        rir: log.rir,
        executionType: log.executionType ?? null,
        overrideReason: log.overrideReason ?? null,
      });
      logsByStep.set(key, list);
    }

    const blocks: HistoryBlockView[] = definition.blocks.map((block: BlockDef, blockIndex: number) => ({
      blockIndex,
      name: block.name,
      kind: block.kind,
      role: block.role ?? null,
      rounds: block.rounds,
      steps: block.steps.map((step: StepDef, stepIndex: number) => {
        const logs = (logsByStep.get(`${blockIndex}:${stepIndex}`) ?? []).slice().sort((a, b) => {
          if (a.round !== b.round) return a.round - b.round;
          return a.setIndex - b.setIndex;
        });
        const skipped = (skippedByStep.get(`${blockIndex}:${stepIndex}`) ?? []).slice().sort((a, b) => {
          if (a.round !== b.round) return a.round - b.round;
          return a.setIndex - b.setIndex;
        });
        const se: any = seByPosition.get(`${blockIndex}:${stepIndex}`);
        const p = step.prescription;
        return {
          stepIndex,
          exerciseName: step.exerciseName,
          targetSets: p.targetSets,
          targetRepsMin: p.targetRepsMin,
          targetRepsMax: p.targetRepsMax,
          targetWeightGrams: p.targetWeightGrams,
          targetDurationMs: p.targetDurationMs,
          targetRir: p.targetRir,
          logs,
          skipped,
          exerciseNote: (se?.exerciseNote as string | null) ?? null,
          substitution:
            se?.actualExerciseName != null
              ? {
                  actualExerciseName: se.actualExerciseName as string,
                  reason: (se.substitutionReason as string | null) ?? null,
                }
              : null,
        };
      }),
    }));

    return {
      id: session.id,
      name: session.name,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      durationMs: durationOf(session.startedAt, session.endedAt),
      status: session.sessionStatus,
      incompleteReason: reasonOf(session),
      note: session.note ?? null,
      definition,
      blocks,
      totalCompletedSets,
    };
  } catch {
    return null;
  }
}
