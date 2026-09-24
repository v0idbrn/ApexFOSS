import { Database, Q } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import { schema } from '../data/schema';
import { migrations } from '../data/migrations';
import { modelClasses } from '../data/models';
import { makeDbActions } from '../data/actions';
import { serializeRoutine, definitionOf, cursorOf } from '../data/serialize';
import {
  applyWorkoutEvent,
  discardWorkout,
  isTimerExpired,
  loadActiveWorkout,
  loadWorkoutRuntime,
  startWorkoutSession,
} from './runner';
import { initialCursor } from '../engine/cursor';
import { dispatch } from '../engine';
import type { RoutineDefinition, SetPayload, TransitionType, BlockKind } from '../types/engine';
import { emptyPrescription, type RoutineDraft } from '../types/draft';

function makeDb(): Database {
  const adapter = new LokiJSAdapter({
    dbName: `apexfoss-day3-${Math.random().toString(36).slice(2)}`,
    schema,
    migrations,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
  });
  return new Database({ adapter, modelClasses: modelClasses as any });
}

const T0 = 1_700_000_000_000;
const SET: SetPayload = { weightGrams: 100_000, reps: 5, durationMs: null, distanceMm: null, rir: 2 };

async function buildRoutine(
  db: Database,
  draft: RoutineDraft,
): Promise<string> {
  const actions = makeDbActions(db);
  const ids = new Map<string, string>();
  for (const block of draft.blocks) {
    for (const step of block.steps) {
      if (!step.exerciseId) {
        const exId = await actions.createExercise({
          name: step.exerciseName || 'Exercise',
          category: 'test',
          equipment: 'none',
          metricFlags: 7,
        });
        ids.set(step.exerciseName, exId);
        step.exerciseId = exId;
      }
    }
  }
  return actions.saveRoutineDraft(draft);
}

function simpleDraft(name: string, opts?: {
  kind?: BlockKind;
  rounds?: number;
  steps?: Array<{ sets: number; transition: { type: TransitionType; delayMs: number } }>;
}): RoutineDraft {
  const steps = (opts?.steps ?? [{ sets: 2, transition: { type: 'immediate' as TransitionType, delayMs: 0 } }]).map(
    (s, i) => ({
      localId: `s${i}`,
      exerciseId: null,
      exerciseName: `Ex${i + 1}`,
      prescription: { ...emptyPrescription(), targetSets: s.sets },
      transition: s.transition,
    }),
  );
  return {
    id: null,
    name,
    blocks: [
      {
        localId: 'b1',
        name: 'Block A',
        kind: opts?.kind ?? 'normal',
        rounds: opts?.rounds ?? 1,
        steps,
      },
    ],
  };
}

async function startRuntime(db: Database, draft: RoutineDraft) {
  const routineId = await buildRoutine(db, draft);
  const sessionId = await startWorkoutSession(db, routineId);
  const rt = await loadWorkoutRuntime(db, sessionId);
  if (!rt) throw new Error('runtime failed to load');
  return { routineId, sessionId, rt };
}

describe('Day 3 — start persisted workout sessions', () => {
  it('startSession creates an active session with an initial cursor', async () => {
    const db = makeDb();
    const { rt } = await startRuntime(db, simpleDraft('Starter'));
    expect(rt.session.sessionStatus).toBe('active');
    expect(rt.cursor).toMatchObject({ blockIndex: 0, stepIndex: 0, round: 1, setIndex: 1, status: 'active', timer: null });
    expect(rt.cursor.startedAt).toBeGreaterThan(0);
  });

  it('definition_json is an immutable snapshot of the routine at start', async () => {
    const db = makeDb();
    const { routineId, sessionId } = await startRuntime(db, simpleDraft('Snapshot'));
    const actions = makeDbActions(db);
    // Edit routine after start
    const draft = await actions.loadRoutineDraft(routineId);
    draft.name = 'Renamed After Start';
    draft.blocks[0].steps[0].prescription.targetSets = 9;
    await actions.saveRoutineDraft(draft);

    const session = await db.get<any>('workout_sessions').find(sessionId);
    const frozen = definitionOf(session);
    expect(frozen.name).toBe('Snapshot');
    expect(frozen.blocks[0].steps[0].prescription.targetSets).toBe(2);

    const routine = await db.get<any>('routines').find(routineId);
    const fresh = await serializeRoutine(db, routine);
    expect(fresh.name).toBe('Renamed After Start');
    expect(fresh.blocks[0].steps[0].prescription.targetSets).toBe(9);
  });

  it('initialCursor on the frozen definition matches the persisted cursor', async () => {
    const db = makeDb();
    const { rt } = await startRuntime(db, simpleDraft('Init'));
    const expected = initialCursor(rt.definition, rt.cursor.startedAt);
    expect(rt.cursor).toEqual(expected);
  });

  it('starting a new session discards the previous active session (single active)', async () => {
    const db = makeDb();
    const draft = simpleDraft('OnlyOne');
    const firstId = await buildRoutine(db, draft);
    const s1 = await startWorkoutSession(db, firstId);
    const s2 = await startWorkoutSession(db, firstId);
    expect(s2).not.toBe(s1);
    const all = await db.get<any>('workout_sessions').query().fetch();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(s2);
    const active = await makeDbActions(db).getActiveSession();
    expect(active!.id).toBe(s2);
  });

  it('discard removes the session and its set logs', async () => {
    const db = makeDb();
    const { rt } = await startRuntime(db, simpleDraft('DiscardMe'));
    const applied = await applyWorkoutEvent(db, rt, { type: 'COMPLETE_SET', now: T0, set: SET });
    expect(await db.get<any>('set_logs').query().fetch()).toHaveLength(1);
    await discardWorkout(db, applied);
    expect(await db.get<any>('workout_sessions').query().fetch()).toHaveLength(0);
    expect(await db.get<any>('set_logs').query().fetch()).toHaveLength(0);
    expect(await loadActiveWorkout(db)).toBeNull();
  });
});

describe('Day 3 — LOG_SET / set_log persistence', () => {
  it('COMPLETE_SET writes a completed set_log with payload and coordinates', async () => {
    const db = makeDb();
    const { rt } = await startRuntime(db, simpleDraft('LogSet'));
    await applyWorkoutEvent(db, rt, { type: 'COMPLETE_SET', now: T0, set: SET });
    const logs = await db.get<any>('set_logs').query().fetch();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      blockIndex: 0,
      stepIndex: 0,
      round: 1,
      setIndex: 1,
      weightGrams: 100_000,
      reps: 5,
      rir: 2,
      isCompleted: 1,
    });
    expect(logs[0].completedAt).toBeGreaterThan(0);
  });

  it('applyWorkoutEvent attaches setLogId to lastReversible for future UNDO', async () => {
    const db = makeDb();
    const { rt } = await startRuntime(db, simpleDraft('UndoId'));
    const next = await applyWorkoutEvent(db, rt, { type: 'COMPLETE_SET', now: T0, set: SET });
    expect(next.cursor.lastReversible).toMatchObject({ kind: 'set', setLogId: expect.any(String) });
    const logs = await db.get<any>('set_logs').query().fetch();
    expect(next.cursor.lastReversible!.setLogId).toBe(logs[0].id);
  });

  it('session_exercises row is created alongside the first log for the step', async () => {
    const db = makeDb();
    const { rt } = await startRuntime(db, simpleDraft('SesEx'));
    await applyWorkoutEvent(db, rt, { type: 'COMPLETE_SET', now: T0, set: SET });
    const ses = await db.get<any>('session_exercises').query().fetch();
    expect(ses).toHaveLength(1);
    expect(ses[0].exerciseName).toBe('Ex1');
    const logs = await db.get<any>('set_logs').query().fetch();
    expect(logs[0].sessionExerciseId).toBe(ses[0].id);
  });
});

describe('Day 3 — transitions at the persistence layer', () => {
  it('IMMEDIATE transition advances the step with no timer in the persisted cursor', async () => {
    const db = makeDb();
    const { rt } = await startRuntime(
      db,
      simpleDraft('Imm', { steps: [
        { sets: 1, transition: { type: 'immediate', delayMs: 0 } },
        { sets: 1, transition: { type: 'immediate', delayMs: 0 } },
      ] }),
    );
    const next = await applyWorkoutEvent(db, rt, { type: 'COMPLETE_SET', now: T0, set: SET });
    expect(next.cursor.stepIndex).toBe(1);
    expect(next.cursor.timer).toBeNull();
    const reloaded = await loadWorkoutRuntime(db, rt.sessionId);
    expect(reloaded!.cursor.stepIndex).toBe(1);
    expect(reloaded!.session.timerExpiresAt).toBeNull();
  });

  it('REST transition starts a rest timer persisted in cursor + derived cache', async () => {
    const db = makeDb();
    const { rt } = await startRuntime(
      db,
      simpleDraft('RestEdge', { steps: [
        { sets: 1, transition: { type: 'rest', delayMs: 120_000 } },
        { sets: 1, transition: { type: 'immediate', delayMs: 0 } },
      ] }),
    );
    const next = await applyWorkoutEvent(db, rt, { type: 'COMPLETE_SET', now: T0, set: SET });
    expect(next.cursor.timer).toMatchObject({ kind: 'rest', durationMs: 120_000, expiresAt: T0 + 120_000 });
    const reloaded = await loadWorkoutRuntime(db, rt.sessionId);
    expect(reloaded!.cursor.timer).toMatchObject({ kind: 'rest', expiresAt: T0 + 120_000 });
    expect(reloaded!.session.timerExpiresAt).toBe(T0 + 120_000);
  });

  it('AUTO_ADVANCE transition starts an auto timer with the edge delay', async () => {
    const db = makeDb();
    const { rt } = await startRuntime(
      db,
      simpleDraft('AutoEdge', { kind: 'circuit', steps: [
        { sets: 1, transition: { type: 'auto_advance', delayMs: 15_000 } },
        { sets: 1, transition: { type: 'immediate', delayMs: 0 } },
      ] }),
    );
    const next = await applyWorkoutEvent(db, rt, { type: 'COMPLETE_SET', now: T0, set: SET });
    expect(next.cursor.timer).toMatchObject({ kind: 'auto', durationMs: 15_000 });
  });

  it('timer expiry advances round and persists the new round', async () => {
    const db = makeDb();
    const { rt } = await startRuntime(
      db,
      simpleDraft('Rounds', { rounds: 2, kind: 'superset', steps: [
        { sets: 1, transition: { type: 'immediate', delayMs: 0 } },
        { sets: 1, transition: { type: 'rest', delayMs: 90_000 } },
      ] }),
    );
    // Step A → B immediate
    let cur = await applyWorkoutEvent(db, rt, { type: 'COMPLETE_SET', now: T0, set: SET });
    expect(cur.cursor).toMatchObject({ stepIndex: 1, timer: null });
    // Step B (last) → explicit REST 90s loop
    cur = await applyWorkoutEvent(db, cur, { type: 'COMPLETE_SET', now: T0, set: SET });
    expect(cur.cursor.timer).toMatchObject({ kind: 'rest', durationMs: 90_000 });
    expect(cur.cursor.round).toBe(1);
    // Expire → round 2, step 0
    cur = await applyWorkoutEvent(db, cur, { type: 'TIMER_EXPIRE', now: T0 + 90_000 });
    expect(cur.cursor).toMatchObject({ stepIndex: 0, round: 2 });
    const reloaded = await loadWorkoutRuntime(db, rt.sessionId);
    expect(reloaded!.cursor).toMatchObject({ stepIndex: 0, round: 2 });
    expect(reloaded!.session.currentRound).toBe(2);
  });

  it('explicit IMMEDIATE on last step advances the round with no timer', async () => {
    const db = makeDb();
    const { rt } = await startRuntime(
      db,
      simpleDraft('ImmRound', { rounds: 2, steps: [
        { sets: 1, transition: { type: 'immediate', delayMs: 0 } },
        { sets: 1, transition: { type: 'immediate', delayMs: 0 } },
      ] }),
    );
    let cur = await applyWorkoutEvent(db, rt, { type: 'COMPLETE_SET', now: T0, set: SET });
    cur = await applyWorkoutEvent(db, cur, { type: 'COMPLETE_SET', now: T0, set: SET });
    // Explicit immediate wins over the implicit rest-loop default.
    expect(cur.cursor.timer).toBeNull();
    expect(cur.cursor).toMatchObject({ stepIndex: 0, round: 2 });
  });

  it('end of block with a next block: REST then ADVANCE_BLOCK persisted', async () => {
    const db = makeDb();
    const draft = simpleDraft('TwoBlocks', { steps: [{ sets: 1, transition: { type: 'rest', delayMs: 120_000 } }] });
    draft.blocks.push({
      localId: 'b2',
      name: 'Block B',
      kind: 'normal',
      rounds: 1,
      steps: [
        {
          localId: 's2b',
          exerciseId: null,
          exerciseName: 'ExB',
          prescription: { ...emptyPrescription(), targetSets: 1 },
          transition: { type: 'immediate', delayMs: 0 },
        },
      ],
    });
    const { rt } = await startRuntime(db, draft);
    let cur = await applyWorkoutEvent(db, rt, { type: 'COMPLETE_SET', now: T0, set: SET });
    // Single step, rounds exhausted, next block → explicit REST edge on the step
    expect(cur.cursor.timer).toMatchObject({ kind: 'rest', durationMs: 120_000 });
    expect(cur.cursor.timer!.target).toMatchObject({ blockIndex: 1 });
    cur = await applyWorkoutEvent(db, cur, { type: 'TIMER_EXPIRE', now: T0 + 120_000 });
    expect(cur.cursor).toMatchObject({ blockIndex: 1, stepIndex: 0, round: 1 });
    const reloaded = await loadWorkoutRuntime(db, rt.sessionId);
    expect(reloaded!.session.currentBlockIndex).toBe(1);
  });

  it('implicit end-of-block REST 120s fires when a step has no transition row', async () => {
    const db = makeDb();
    const draft = simpleDraft('ImplicitBlockRest', { steps: [{ sets: 1, transition: { type: 'immediate', delayMs: 0 } }] });
    draft.blocks.push({
      localId: 'b2',
      name: 'Block B',
      kind: 'normal',
      rounds: 1,
      steps: [
        {
          localId: 's2b',
          exerciseId: null,
          exerciseName: 'ExB',
          prescription: { ...emptyPrescription(), targetSets: 1 },
          transition: { type: 'immediate', delayMs: 0 },
        },
      ],
    });
    const { rt } = await startRuntime(db, draft);
    // Strip transitions → frozen implicit defaults (restBlockMs between blocks).
    const def: RoutineDefinition = {
      ...rt.definition,
      blocks: rt.definition.blocks.map((b) => ({ ...b, transitions: [] })),
    };
    const pure = dispatch(def, rt.cursor, { type: 'COMPLETE_SET', now: T0, set: SET });
    expect(pure.cursor.timer).toMatchObject({ kind: 'rest', durationMs: 120_000 });
    expect(pure.cursor.timer!.target).toMatchObject({ blockIndex: 1 });
  });
});

describe('Day 3 — completion', () => {
  it('last set of the session completes it (status, endedAt, no timer)', async () => {
    const db = makeDb();
    const { rt } = await startRuntime(db, simpleDraft('Finish', { steps: [{ sets: 1, transition: { type: 'immediate', delayMs: 0 } }] }));
    const next = await applyWorkoutEvent(db, rt, { type: 'COMPLETE_SET', now: T0, set: SET });
    expect(next.cursor.status).toBe('completed');
    expect(next.cursor.timer).toBeNull();
    const session = await db.get<any>('workout_sessions').find(rt.sessionId);
    expect(session.sessionStatus).toBe('completed');
    expect(session.endedAt).toBeGreaterThan(0);
    expect(session.timerExpiresAt).toBeNull();
    // set_log for the final set still written
    expect(await db.get<any>('set_logs').query().fetch()).toHaveLength(1);
  });

  it('COMPLETE_SESSION event finishes early and clears the active slot', async () => {
    const db = makeDb();
    const { rt } = await startRuntime(db, simpleDraft('Early', { steps: [{ sets: 3, transition: { type: 'immediate', delayMs: 0 } }] }));
    const next = await applyWorkoutEvent(db, rt, { type: 'COMPLETE_SESSION', now: T0 });
    expect(next.cursor.status).toBe('completed');
    expect(await loadActiveWorkout(db)).toBeNull();
    const session = await db.get<any>('workout_sessions').find(rt.sessionId);
    expect(session.sessionStatus).toBe('completed');
  });
});

describe('Day 3 — skip and undo', () => {
  it('SKIP_STEP advances position immediately and persists it', async () => {
    const db = makeDb();
    const { rt } = await startRuntime(
      db,
      simpleDraft('Skip', { steps: [
        { sets: 3, transition: { type: 'immediate', delayMs: 0 } },
        { sets: 1, transition: { type: 'immediate', delayMs: 0 } },
      ] }),
    );
    const next = await applyWorkoutEvent(db, rt, { type: 'SKIP_STEP', now: T0 });
    expect(next.cursor.stepIndex).toBe(1);
    const reloaded = await loadWorkoutRuntime(db, rt.sessionId);
    expect(reloaded!.cursor.stepIndex).toBe(1);
  });

  it('SKIP during a rest timer jumps to the timer target', async () => {
    const db = makeDb();
    const { rt } = await startRuntime(
      db,
      simpleDraft('SkipRest', { steps: [
        { sets: 2, transition: { type: 'rest', delayMs: 60_000 } },
        { sets: 1, transition: { type: 'immediate', delayMs: 0 } },
      ] }),
    );
    const withTimer = await applyWorkoutEvent(db, rt, { type: 'COMPLETE_SET', now: T0, set: SET });
    expect(withTimer.cursor.timer).not.toBeNull();
    const next = await applyWorkoutEvent(db, withTimer, { type: 'SKIP_TIMER', now: T0 + 1_000 });
    expect(next.cursor.timer).toBeNull();
    expect(next.cursor.stepIndex).toBe(0); // same step, set 2
    expect(next.cursor.setIndex).toBe(2);
  });

  it('UNDO voids the last set_log (isCompleted 0) and restores the position', async () => {
    const db = makeDb();
    const { rt } = await startRuntime(db, simpleDraft('Undo', { steps: [{ sets: 3, transition: { type: 'immediate', delayMs: 0 } }] }));
    const afterSet = await applyWorkoutEvent(db, rt, { type: 'COMPLETE_SET', now: T0, set: SET });
    expect(afterSet.cursor.setIndex).toBe(2);
    const undone = await applyWorkoutEvent(db, afterSet, { type: 'UNDO_LAST', now: T0 + 5_000 });
    expect(undone.cursor).toMatchObject({ setIndex: 1, status: 'active', timer: null, lastReversible: null });
    const logs = await db.get<any>('set_logs').query().fetch();
    expect(logs).toHaveLength(1);
    expect(logs[0].isCompleted).toBe(0); // voided, history preserved
  });

  it('UNDO with nothing reversible is a no-op (cursor unchanged, no effects applied)', async () => {
    const db = makeDb();
    const { rt } = await startRuntime(db, simpleDraft('NoUndo'));
    const next = await applyWorkoutEvent(db, rt, { type: 'UNDO_LAST', now: T0 });
    expect(next.cursor).toEqual(rt.cursor);
    expect(await db.get<any>('set_logs').query().fetch()).toHaveLength(0);
  });

  it('UNDO after SKIP_STEP is rejected (lastReversible cleared by skip)', async () => {
    const db = makeDb();
    const { rt } = await startRuntime(db, simpleDraft('SkipThenUndo', { steps: [
      { sets: 2, transition: { type: 'immediate', delayMs: 0 } },
      { sets: 1, transition: { type: 'immediate', delayMs: 0 } },
    ] }));
    const afterSet = await applyWorkoutEvent(db, rt, { type: 'COMPLETE_SET', now: T0, set: SET });
    const skipped = await applyWorkoutEvent(db, afterSet, { type: 'SKIP_STEP', now: T0 });
    expect(skipped.cursor.lastReversible).toBeNull();
    const undone = await applyWorkoutEvent(db, skipped, { type: 'UNDO_LAST', now: T0 });
    expect(undone.cursor).toEqual(skipped.cursor);
    const logs = await db.get<any>('set_logs').query().fetch();
    expect(logs[0].isCompleted).toBe(1); // not voided
  });

  it('UNDO after SKIP_TIMER still works (skip rest does not clear the last set)', async () => {
    const db = makeDb();
    const { rt } = await startRuntime(db, simpleDraft('SkipRestUndo', { steps: [{ sets: 2, transition: { type: 'immediate', delayMs: 0 } }] }));
    const afterSet = await applyWorkoutEvent(db, rt, { type: 'COMPLETE_SET', now: T0, set: SET });
    expect(afterSet.cursor.timer).not.toBeNull();
    const skipped = await applyWorkoutEvent(db, afterSet, { type: 'SKIP_TIMER', now: T0 });
    expect(skipped.cursor.lastReversible).toMatchObject({ kind: 'set' });
    const undone = await applyWorkoutEvent(db, skipped, { type: 'UNDO_LAST', now: T0 });
    expect(undone.cursor).toMatchObject({ setIndex: 1, lastReversible: null });
    const logs = await db.get<any>('set_logs').query().fetch();
    expect(logs[0].isCompleted).toBe(0);
  });
});

describe('Day 3 — cursor persistence, reload and timer recovery', () => {
  it('reload active session restores definition + cursor from the store', async () => {
    const db = makeDb();
    const { rt } = await startRuntime(db, simpleDraft('Reload'));
    await applyWorkoutEvent(db, rt, { type: 'COMPLETE_SET', now: T0, set: SET });
    // Simulated restart: only DB access, no prior references.
    const fresh = await loadActiveWorkout(db);
    expect(fresh).not.toBeNull();
    expect(fresh!.sessionId).toBe(rt.sessionId);
    expect(fresh!.cursor.setIndex).toBe(2);
    expect(fresh!.definition.name).toBe('Reload');
    expect(fresh!.cursor.timer).toMatchObject({ kind: 'rest', expiresAt: expect.any(Number) });
  });

  it('timer recovery: remaining is derived from expiresAt; expired timers fire TIMER_EXPIRE', async () => {
    const db = makeDb();
    const { rt } = await startRuntime(db, simpleDraft('Recover', { steps: [{ sets: 2, transition: { type: 'immediate', delayMs: 0 } }] }));
    const withTimer = await applyWorkoutEvent(db, rt, { type: 'COMPLETE_SET', now: T0, set: SET });
    // Reload as if the app was killed mid-rest
    const recovered = await loadWorkoutRuntime(db, rt.sessionId);
    const timer = recovered!.cursor.timer!;
    expect(timer.expiresAt).toBe(withTimer.cursor.timer!.expiresAt);

    // Not yet expired
    expect(isTimerExpired(recovered!.cursor, timer.expiresAt - 1_000)).toBe(false);
    // Past expiry → recovery path dispatches TIMER_EXPIRE
    expect(isTimerExpired(recovered!.cursor, timer.expiresAt)).toBe(true);
    expect(isTimerExpired(recovered!.cursor, timer.expiresAt + 5_000)).toBe(true);

    const after = await applyWorkoutEvent(db, recovered!, { type: 'TIMER_EXPIRE', now: timer.expiresAt + 100 });
    expect(after.cursor.timer).toBeNull();
    expect(after.cursor.setIndex).toBe(2);
    const reloaded = await loadWorkoutRuntime(db, rt.sessionId);
    expect(reloaded!.cursor.timer).toBeNull();
    expect(reloaded!.session.timerExpiresAt).toBeNull();
  });

  it('persistCursor writes derived caches that mirror the canonical cursor', async () => {
    const db = makeDb();
    const { rt } = await startRuntime(db, simpleDraft('Caches'));
    const next = await applyWorkoutEvent(db, rt, { type: 'COMPLETE_SET', now: T0, set: SET });
    const session = await db.get<any>('workout_sessions').find(rt.sessionId);
    expect(session.cursorJson).toBe(JSON.stringify(next.cursor));
    expect(session.currentBlockIndex).toBe(next.cursor.blockIndex);
    expect(session.currentSetIndex).toBe(next.cursor.setIndex);
    expect(session.currentRound).toBe(next.cursor.round);
    expect(session.timerExpiresAt).toBe(next.cursor.timer ? next.cursor.timer.expiresAt : null);
    // currentStepId cache follows definition
    expect(session.currentStepId).toBe(next.definition.blocks[0].steps[0].id);
  });
});

describe('Day 3 — representative routines end-to-end through the runner', () => {
  it('normal multi-set routine: sets → rest → next step → complete', async () => {
    const db = makeDb();
    const draft = simpleDraft('Normal Flow', {
      steps: [
        { sets: 2, transition: { type: 'immediate', delayMs: 0 } },
        { sets: 1, transition: { type: 'immediate', delayMs: 0 } },
      ],
    });
    const { rt } = await startRuntime(db, draft);

    // Set 1 of Ex1
    let cur = await applyWorkoutEvent(db, rt, { type: 'COMPLETE_SET', now: T0, set: SET });
    expect(cur.cursor).toMatchObject({ stepIndex: 0, setIndex: 2 });
    expect(cur.cursor.timer).toMatchObject({ kind: 'rest', durationMs: 90_000 });

    // Skip rest → set 2
    cur = await applyWorkoutEvent(db, cur, { type: 'SKIP_TIMER', now: T0 + 1_000 });
    expect(cur.cursor).toMatchObject({ stepIndex: 0, setIndex: 2, timer: null });

    // Set 2 of Ex1 → immediate → Ex2 (last set of Ex1)
    cur = await applyWorkoutEvent(db, cur, { type: 'COMPLETE_SET', now: T0, set: SET });
    expect(cur.cursor).toMatchObject({ stepIndex: 1, setIndex: 1, timer: null });

    // Final set → session complete
    cur = await applyWorkoutEvent(db, cur, { type: 'COMPLETE_SET', now: T0, set: SET });
    expect(cur.cursor.status).toBe('completed');
    const logs = await db.get<any>('set_logs').query(Q.where('is_completed', 1)).fetch();
    expect(logs).toHaveLength(3);
    expect(await loadActiveWorkout(db)).toBeNull();
  });

  it('superset (multi-step, multi-round) runs round loop via rest timers', async () => {
    const db = makeDb();
    const draft = simpleDraft('Superset Flow', {
      kind: 'superset',
      rounds: 2,
      steps: [
        { sets: 1, transition: { type: 'immediate', delayMs: 0 } },
        { sets: 1, transition: { type: 'rest', delayMs: 90_000 } },
      ],
    });
    const { rt } = await startRuntime(db, draft);

    // Round 1: A → B
    let cur = await applyWorkoutEvent(db, rt, { type: 'COMPLETE_SET', now: T0, set: SET });
    expect(cur.cursor).toMatchObject({ stepIndex: 1, round: 1 });
    // B → explicit loop rest 90s
    cur = await applyWorkoutEvent(db, cur, { type: 'COMPLETE_SET', now: T0, set: SET });
    expect(cur.cursor.timer).toMatchObject({ kind: 'rest', durationMs: 90_000 });
    // Round 2
    cur = await applyWorkoutEvent(db, cur, { type: 'TIMER_EXPIRE', now: T0 + 90_000 });
    expect(cur.cursor).toMatchObject({ stepIndex: 0, round: 2 });
    cur = await applyWorkoutEvent(db, cur, { type: 'COMPLETE_SET', now: T0, set: SET });
    expect(cur.cursor).toMatchObject({ stepIndex: 1, round: 2 });
    // Final set completes
    cur = await applyWorkoutEvent(db, cur, { type: 'COMPLETE_SET', now: T0, set: SET });
    expect(cur.cursor.status).toBe('completed');
    const logs = await db.get<any>('set_logs').query(Q.where('is_completed', 1)).fetch();
    expect(logs).toHaveLength(4);
  });

  it('contrast routine with explicit IMMEDIATE/REST edges follows the frozen example', async () => {
    const db = makeDb();
    const draft: RoutineDraft = {
      id: null,
      name: 'PAP Lower',
      blocks: [
        {
          localId: 'b1',
          name: 'Contrast A',
          kind: 'contrast',
          rounds: 2,
          steps: [
            {
              localId: 'a',
              exerciseId: null,
              exerciseName: 'Heavy Squat',
              prescription: { ...emptyPrescription(), targetSets: 1, targetWeightGrams: 120_000 },
              transition: { type: 'immediate', delayMs: 0 },
            },
            {
              localId: 'b',
              exerciseId: null,
              exerciseName: 'Box Jump',
              prescription: { ...emptyPrescription(), targetSets: 1 },
              transition: { type: 'rest', delayMs: 120_000 },
            },
          ],
        },
      ],
    };
    const { rt } = await startRuntime(db, draft);

    // A → B immediate
    let cur = await applyWorkoutEvent(db, rt, { type: 'COMPLETE_SET', now: T0, set: { ...SET, weightGrams: 120_000 } });
    expect(cur.cursor).toMatchObject({ stepIndex: 1, timer: null });
    // B → REST 120s back to A
    cur = await applyWorkoutEvent(db, cur, { type: 'COMPLETE_SET', now: T0, set: { ...SET, weightGrams: null } });
    expect(cur.cursor.timer).toMatchObject({ kind: 'rest', durationMs: 120_000 });
    expect(cur.cursor.timer!.target).toMatchObject({ stepIndex: 0, round: 2 });
    // Round 2
    cur = await applyWorkoutEvent(db, cur, { type: 'TIMER_EXPIRE', now: T0 + 120_000 });
    expect(cur.cursor).toMatchObject({ stepIndex: 0, round: 2 });
    // Finish round 2
    cur = await applyWorkoutEvent(db, cur, { type: 'COMPLETE_SET', now: T0, set: { ...SET, weightGrams: 120_000 } });
    cur = await applyWorkoutEvent(db, cur, { type: 'COMPLETE_SET', now: T0, set: { ...SET, weightGrams: null } });
    expect(cur.cursor.status).toBe('completed');

    // Full flow re-readable after "restart"
    const finalLogs = await db.get<any>('set_logs').query(Q.where('is_completed', 1)).fetch();
    expect(finalLogs).toHaveLength(4);
    const session = await db.get<any>('workout_sessions').find(rt.sessionId);
    expect(session.sessionStatus).toBe('completed');
    // Snapshot still frozen as PAP Lower with original edge delays
    const frozen = definitionOf(session);
    expect(frozen.name).toBe('PAP Lower');
    expect(frozen.blocks[0].transitions.find((t) => t.fromStepId === frozen.blocks[0].steps[1].id)).toMatchObject({
      delayMs: 120_000,
      type: 'rest',
    });
  });

  it('engine pure dispatch agrees with runner-applied state for a skip mid-session', async () => {
    const db = makeDb();
    const draft = simpleDraft('Agree', { steps: [{ sets: 2, transition: { type: 'immediate', delayMs: 0 } }] });
    const { rt } = await startRuntime(db, draft);
    const pure = dispatch(rt.definition, rt.cursor, { type: 'SKIP_STEP', now: T0 });
    const applied = await applyWorkoutEvent(db, rt, { type: 'SKIP_STEP', now: T0 });
    expect(applied.cursor).toEqual(pure.cursor);
    const reloaded = await loadWorkoutRuntime(db, rt.sessionId);
    expect(reloaded!.cursor).toEqual(pure.cursor);
  });
});
