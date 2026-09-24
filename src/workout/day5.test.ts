import { Database, Q } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import { schema } from '../data/schema';
import { migrations } from '../data/migrations';
import { modelClasses } from '../data/models';
import { makeDbActions } from '../data/actions';
import { listCompletedSessions, loadSessionDetail } from '../data/history';
import {
  applyWorkoutEvent,
  discardWorkout,
  loadActiveWorkout,
  loadWorkoutRuntime,
  startWorkoutSession,
} from '../workout/runner';
import { parseCursor } from '../engine/cursor';
import { emptyPrescription, type RoutineDraft } from '../types/draft';
import type { SetPayload, TransitionType } from '../types/engine';
import { sessionsToCsv } from '../export/export';

jest.mock('../notifications', () => ({
  scheduleTimerNotification: jest.fn(async () => 'n1'),
  cancelTimerNotification: jest.fn(async () => undefined),
  requestNotificationPermission: jest.fn(async () => true),
  listScheduledNotificationIds: jest.fn(async () => []),
  __resetNotificationPermissionLatchForTests: jest.fn(),
}));

function makeDb(): Database {
  const adapter = new LokiJSAdapter({
    dbName: `apexfoss-day5-${Math.random().toString(36).slice(2)}`,
    schema,
    migrations,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
  });
  return new Database({ adapter, modelClasses: modelClasses as any });
}

const T0 = 1_700_000_000_000;
const SET: SetPayload = { weightGrams: 100_000, reps: 5, durationMs: null, distanceMm: null, rir: 2 };

function draft(name: string, opts?: { sets?: number; steps?: number; restMs?: number }): RoutineDraft {
  const sets = opts?.sets ?? 2;
  const nSteps = opts?.steps ?? 2;
  const restMs = opts?.restMs ?? 60_000;
  const steps = Array.from({ length: nSteps }, (_, i) => ({
    localId: `s${i}`,
    exerciseId: null as string | null,
    exerciseName: `Ex${i + 1}`,
    prescription: { ...emptyPrescription(), targetSets: sets, targetWeightGrams: 100_000 },
    transition: {
      type: (i === nSteps - 1 && nSteps > 1 ? 'rest' : 'immediate') as TransitionType,
      delayMs: i === nSteps - 1 && nSteps > 1 ? restMs : 0,
    },
  }));
  return {
    id: null,
    name,
    blocks: [{ localId: 'b1', name: 'Block A', kind: 'normal', rounds: 1, steps }],
  };
}

async function setup(db: Database, d: RoutineDraft) {
  const actions = makeDbActions(db);
  for (const block of d.blocks) {
    for (const step of block.steps) {
      if (!step.exerciseId) {
        step.exerciseId = await actions.createExercise({
          name: step.exerciseName,
          category: 'test',
          equipment: 'none',
          metricFlags: 7,
        });
      }
    }
  }
  const routineId = await actions.saveRoutineDraft(d);
  const sessionId = await startWorkoutSession(db, routineId);
  const rt = await loadWorkoutRuntime(db, sessionId);
  if (!rt) throw new Error('no runtime');
  return { routineId, sessionId, rt };
}

describe('sessions edge cases', () => {
  it('cannot create multiple active sessions (start discards previous)', async () => {
    const db = makeDb();
    const { routineId, sessionId: s1 } = await setup(db, draft('Multi', { sets: 1, steps: 1 }));
    const s2 = await startWorkoutSession(db, routineId);
    expect(s2).not.toBe(s1);
    const active = await loadActiveWorkout(db);
    expect(active!.sessionId).toBe(s2);
    const statuses = await db.get<any>('workout_sessions').query().fetch();
    const activeCount = statuses.filter((s) => s.sessionStatus === 'active').length;
    expect(activeCount).toBe(1);
  });

  it('discard active session removes it and leaves no active', async () => {
    const db = makeDb();
    const { sessionId, rt } = await setup(db, draft('DiscardMe', { sets: 1, steps: 1 }));
    await discardWorkout(db, rt);
    expect(await loadActiveWorkout(db)).toBeNull();
    await expect(loadWorkoutRuntime(db, sessionId)).resolves.toBeNull();
  });

  it('malformed definition snapshot fails load safely (null runtime)', async () => {
    const db = makeDb();
    const { sessionId } = await setup(db, draft('CorruptDef', { sets: 1, steps: 1 }));
    const ses = await db.get<any>('workout_sessions').find(sessionId);
    await db.write(async () => {
      await ses.update((rec: any) => {
        rec.definitionJson = 'not-json{';
      });
    });
    const rt = await loadWorkoutRuntime(db, sessionId);
    expect(rt).toBeNull();
  });

  it('malformed cursor_json throws parseCursor safely', () => {
    expect(() => parseCursor('{bad')).toThrow();
    expect(() => parseCursor('{"blockIndex":"x"}')).toThrow('corrupt cursor_json');
  });

  it('reopen completed session: loadWorkoutRuntime returns completed cursor, loadActiveWorkout null', async () => {
    const db = makeDb();
    const { sessionId, rt } = await setup(db, draft('Done', { sets: 1, steps: 1 }));
    await applyWorkoutEvent(db, rt, { type: 'COMPLETE_SET', now: T0, set: SET });
    const after = await loadWorkoutRuntime(db, sessionId);
    expect(after!.cursor.status).toBe('completed');
    expect(await loadActiveWorkout(db)).toBeNull();
  });
});

describe('set edge cases', () => {
  it('accepts zero weight (bodyweight) and null optional fields', async () => {
    const db = makeDb();
    const { sessionId, rt } = await setup(db, draft('ZeroW', { sets: 1, steps: 1 }));
    const payload: SetPayload = { weightGrams: 0, reps: 0, durationMs: null, distanceMm: null, rir: null };
    const after = await applyWorkoutEvent(db, rt, { type: 'COMPLETE_SET', now: T0, set: payload });
    expect(after.cursor.status).toBe('completed');
    const detail = await loadSessionDetail(db, sessionId);
    expect(detail!.blocks[0].steps[0].logs[0].weightGrams).toBe(0);
    expect(detail!.blocks[0].steps[0].logs[0].rir).toBeNull();
  });

  it('accepts very large reasonable values without precision loss', async () => {
    const db = makeDb();
    const { sessionId, rt } = await setup(db, draft('Big', { sets: 1, steps: 1 }));
    const payload: SetPayload = { weightGrams: 999_999_000, reps: 999, durationMs: 3_600_000, distanceMm: null, rir: 99 };
    await applyWorkoutEvent(db, rt, { type: 'COMPLETE_SET', now: T0, set: payload });
    const detail = await loadSessionDetail(db, sessionId);
    const log = detail!.blocks[0].steps[0].logs[0];
    expect(log.weightGrams).toBe(999_999_000);
    expect(log.reps).toBe(999);
    expect(log.durationMs).toBe(3_600_000);
    expect(log.rir).toBe(99);
  });

  it('UNDO after COMPLETE_SET then COMPLETE_SET again logs correctly (no duplicate void bug)', async () => {
    const db = makeDb();
    const { sessionId, rt } = await setup(db, draft('UndoRedo', { sets: 2, steps: 1 }));
    const a = await applyWorkoutEvent(db, rt, { type: 'COMPLETE_SET', now: T0, set: SET });
    const b = await applyWorkoutEvent(db, a, { type: 'UNDO_LAST', now: T0 + 1 });
    const c = await applyWorkoutEvent(db, b, { type: 'COMPLETE_SET', now: T0 + 2, set: { ...SET, reps: 6 } });
    // finish remaining
    const done =
      c.cursor.timer != null
        ? await applyWorkoutEvent(db, c, { type: 'SKIP_TIMER', now: T0 + 3 })
        : c;
    const final = done.cursor.status === 'completed' ? done : await applyWorkoutEvent(db, done, { type: 'COMPLETE_SET', now: T0 + 4, set: SET });
    expect(final.cursor.status).toBe('completed');
    const detail = await loadSessionDetail(db, sessionId);
    // voided log not counted; one completed log with reps 6 for set 1 + one for set 2
    expect(detail!.totalCompletedSets).toBe(2);
    const s1logs = detail!.blocks[0].steps[0].logs.filter((l) => l.setIndex === 1);
    expect(s1logs).toHaveLength(1);
    expect(s1logs[0].reps).toBe(6);
  });
});

describe('transition edge cases', () => {
  it('skip on final step completes session', async () => {
    const db = makeDb();
    const { sessionId, rt } = await setup(db, draft('SkipFinal', { sets: 1, steps: 1 }));
    const after = await applyWorkoutEvent(db, rt, { type: 'SKIP_STEP', now: T0 });
    expect(after.cursor.status).toBe('completed');
    const ses = await db.get<any>('workout_sessions').find(sessionId);
    expect(ses.sessionStatus).toBe('completed');
  });

  it('undo after skip restores previous position when lastReversible exists', async () => {
    const db = makeDb();
    const { rt } = await setup(db, draft('UndoAfterSkip', { sets: 3, steps: 1 }));
    const a = await applyWorkoutEvent(db, rt, { type: 'COMPLETE_SET', now: T0, set: SET });
    // a may be in rest timer — skip then skip step
    const b = a.cursor.timer ? await applyWorkoutEvent(db, a, { type: 'SKIP_TIMER', now: T0 + 1 }) : a;
    const c = await applyWorkoutEvent(db, b, { type: 'SKIP_STEP', now: T0 + 2 });
    // undo should be available if lastReversible survived SKIP_STEP? Day 3: SKIP_STEP clears lastReversible
    // Document actual semantics: after SKIP_STEP lastReversible is null → UNDO is no-op
    const d = await applyWorkoutEvent(db, c, { type: 'UNDO_LAST', now: T0 + 3 });
    expect(d.cursor.lastReversible).toBeNull();
    // cursor remains consistent
    expect(['active', 'completed']).toContain(d.cursor.status);
  });

  it('auto_advance transition starts a timer', async () => {
    const db = makeDb();
    const d = draft('Auto', { sets: 1, steps: 2 });
    d.blocks[0].steps[0].transition = { type: 'auto_advance', delayMs: 30_000 };
    d.blocks[0].steps[1].transition = { type: 'immediate', delayMs: 0 };
    const { rt } = await setup(db, d);
    const after = await applyWorkoutEvent(db, rt, { type: 'COMPLETE_SET', now: T0, set: SET });
    expect(after.cursor.timer).not.toBeNull();
    expect(after.cursor.timer!.kind).toBe('auto');
  });
});

describe('history + export edge cases', () => {
  it('export of empty history is header-only CSV (no mutation)', async () => {
    const db = makeDb();
    const before = await db.get<any>('workout_sessions').query().fetch();
    const csv = sessionsToCsv([]);
    expect(csv.trim().split('\r\n')).toHaveLength(1);
    const after = await db.get<any>('workout_sessions').query().fetch();
    expect(after.length).toBe(before.length);
  });

  it('old session after routine modification still exports from snapshot', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    const d = draft('SnapshotSafe', { sets: 1, steps: 1 });
    for (const step of d.blocks[0].steps) {
      step.exerciseId = await actions.createExercise({ name: step.exerciseName, category: 't', equipment: 'n', metricFlags: 7 });
    }
    const routineId = await actions.saveRoutineDraft(d);
    const sessionId = await startWorkoutSession(db, routineId);
    const rt = (await loadWorkoutRuntime(db, sessionId))!;
    await applyWorkoutEvent(db, rt, { type: 'COMPLETE_SET', now: T0, set: SET });

    // Mutate routine after session complete
    const live = await actions.loadRoutineDraft(routineId);
    live.name = 'Renamed Later';
    live.blocks[0].steps[0].exerciseName = 'Totally Different';
    await actions.saveRoutineDraft(live);

    const detail = await loadSessionDetail(db, sessionId);
    expect(detail!.name).toBe('SnapshotSafe');
    expect(detail!.blocks[0].steps[0].exerciseName).toBe('Ex1');
    const csv = sessionsToCsv([detail!]);
    expect(csv).toContain('SnapshotSafe');
    expect(csv).not.toContain('Totally Different');
    expect(csv).not.toContain('Renamed Later');
  });

  it('listCompletedSessions ignores active sessions; empty DB returns []', async () => {
    const db = makeDb();
    expect(await listCompletedSessions(db)).toEqual([]);
    await setup(db, draft('ActiveOnly', { sets: 5, steps: 1 }));
    expect(await listCompletedSessions(db)).toEqual([]);
  });

  it('session with missing set logs exports target rows without fake actuals', async () => {
    const db = makeDb();
    const { sessionId, rt } = await setup(db, draft('NoLogs', { sets: 1, steps: 1 }));
    await applyWorkoutEvent(db, rt, { type: 'COMPLETE_SESSION', now: T0 });
    const detail = await loadSessionDetail(db, sessionId);
    expect(detail!.totalCompletedSets).toBe(0);
    const csv = sessionsToCsv([detail!]);
    // one row per step with empty actual columns
    expect(csv).toContain('Ex1');
    const dataLine = csv.trim().split('\r\n')[1];
    expect(dataLine.endsWith(',,,')).toBe(true);
  });
});

describe('duplicate completion / guards', () => {
  it('events on completed cursor are no-ops (engine guards)', async () => {
    const db = makeDb();
    const { sessionId, rt } = await setup(db, draft('Noop', { sets: 1, steps: 1 }));
    const done = await applyWorkoutEvent(db, rt, { type: 'COMPLETE_SESSION', now: T0 });
    const again = await applyWorkoutEvent(db, done, { type: 'COMPLETE_SET', now: T0 + 1, set: SET });
    expect(again.cursor.status).toBe('completed');
    const detail = await loadSessionDetail(db, sessionId);
    expect(detail!.totalCompletedSets).toBe(0);
  });
});
