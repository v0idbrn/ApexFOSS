import { Database, Q } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import { schema } from '../data/schema';
import { migrations } from '../data/migrations';
import { modelClasses } from '../data/models';
import { makeDbActions } from '../data/actions';
import { listCompletedSessions, loadSessionDetail } from '../data/history';
import {
  applyWorkoutEvent,
  isTimerExpired,
  loadActiveWorkout,
  loadWorkoutRuntime,
  reconcileTimerNotification,
  startWorkoutSession,
} from './runner';
import { emptyPrescription, type RoutineDraft } from '../types/draft';
import type { SetPayload, TransitionType } from '../types/engine';

jest.mock('../notifications', () => ({
  scheduleTimerNotification: jest.fn(async (expiresAt: number, title: string) => `notif_${expiresAt}_${title}`),
  cancelTimerNotification: jest.fn(async () => undefined),
  requestNotificationPermission: jest.fn(async () => true),
  listScheduledNotificationIds: jest.fn(async () => []),
  __resetNotificationPermissionLatchForTests: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const notifications = require('../notifications');

function makeDb(): Database {
  const adapter = new LokiJSAdapter({
    dbName: `apexfoss-day4-${Math.random().toString(36).slice(2)}`,
    schema,
    migrations,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
  });
  return new Database({ adapter, modelClasses: modelClasses as any });
}

const T0 = 1_700_000_000_000;
const SET: SetPayload = { weightGrams: 100_000, reps: 5, durationMs: null, distanceMm: null, rir: 2 };

function draftWithRest(name: string, opts?: { sets?: number; restMs?: number; steps?: number }): RoutineDraft {
  const sets = opts?.sets ?? 2;
  const restMs = opts?.restMs ?? 60_000;
  const nSteps = opts?.steps ?? 2;
  const steps = Array.from({ length: nSteps }, (_, i) => ({
    localId: `s${i}`,
    exerciseId: null,
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

async function buildAndStart(db: Database, draft: RoutineDraft) {
  const actions = makeDbActions(db);
  for (const block of draft.blocks) {
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
  const routineId = await actions.saveRoutineDraft(draft);
  const sessionId = await startWorkoutSession(db, routineId);
  const rt = await loadWorkoutRuntime(db, sessionId);
  if (!rt) throw new Error('runtime load failed');
  return { routineId, sessionId, rt };
}

/** Advance a session into REST timer state (after first set of step 1 with sets=2). */
async function enterRestTimer(db: Database, draft: RoutineDraft) {
  const { routineId, sessionId, rt } = await buildAndStart(db, draft);
  const after = await applyWorkoutEvent(db, rt, { type: 'COMPLETE_SET', now: T0, set: SET });
  expect(after.cursor.timer).not.toBeNull();
  return { routineId, sessionId, rt: after };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Day 4 — persistent timer (expiresAt canonical)', () => {
  it('timer persists across reload with identical expiresAt', async () => {
    const db = makeDb();
    const { sessionId } = await enterRestTimer(db, draftWithRest('PersistTimer'));
    const reloaded = await loadWorkoutRuntime(db, sessionId);
    const original = await loadWorkoutRuntime(db, sessionId);
    expect(reloaded!.cursor.timer!.expiresAt).toBe(original!.cursor.timer!.expiresAt);
    expect(reloaded!.session.timerExpiresAt).toBe(original!.cursor.timer!.expiresAt);
  });

  it('remaining is derived from expiresAt, not a persisted remainingSeconds field', async () => {
    const db = makeDb();
    const { sessionId } = await enterRestTimer(db, draftWithRest('Derive'));
    const rt = await loadWorkoutRuntime(db, sessionId);
    const timer = rt!.cursor.timer!;
    // cursor_json has no remainingSeconds key
    expect(rt!.session.cursorJson).not.toContain('remainingSeconds');
    expect(timer.expiresAt).toBeGreaterThan(T0);
    expect(isTimerExpired(rt!.cursor, timer.expiresAt - 1_000)).toBe(false);
    expect(isTimerExpired(rt!.cursor, timer.expiresAt)).toBe(true);
  });

  it('scenario A: reload before expiration — timer stays active, no premature advance', async () => {
    const db = makeDb();
    const { sessionId } = await enterRestTimer(db, draftWithRest('ScenarioA'));
    const rt = await loadWorkoutRuntime(db, sessionId);
    expect(isTimerExpired(rt!.cursor, rt!.cursor.timer!.expiresAt - 5_000)).toBe(false);
    expect(rt!.cursor.timer).not.toBeNull();
    expect(rt!.cursor.setIndex).toBe(2);
    expect(rt!.session.sessionStatus).toBe('active');
  });

  it('scenario B: reload after expiration — detects expiry and TIMER_EXPIRE advances via runner', async () => {
    const db = makeDb();
    const { sessionId } = await enterRestTimer(db, draftWithRest('ScenarioB'));
    const rt = await loadWorkoutRuntime(db, sessionId);
    const past = rt!.cursor.timer!.expiresAt + 1_000;
    expect(isTimerExpired(rt!.cursor, past)).toBe(true);
    const next = await applyWorkoutEvent(db, rt!, { type: 'TIMER_EXPIRE', now: past });
    expect(next.cursor.timer).toBeNull();
    expect(next.cursor.setIndex).toBe(2);
    const reloaded = await loadWorkoutRuntime(db, sessionId);
    expect(reloaded!.cursor.timer).toBeNull();
    expect(reloaded!.session.timerExpiresAt).toBeNull();
  });

  it('scenario C: force-stop simulation — full state recovered from store only', async () => {
    const db = makeDb();
    const { sessionId } = await enterRestTimer(db, draftWithRest('ScenarioC'));
    // Drop all prior references; re-derive everything (process death analogue).
    const fresh = await loadActiveWorkout(db);
    expect(fresh).not.toBeNull();
    expect(fresh!.sessionId).toBe(sessionId);
    expect(fresh!.definition.name).toBe('ScenarioC');
    expect(fresh!.cursor.status).toBe('active');
    expect(fresh!.cursor.timer).not.toBeNull();
    expect(fresh!.definition.blocks[0].steps[fresh!.cursor.stepIndex].exerciseName).toBe('Ex1');
    expect(fresh!.cursor.round).toBe(1);
  });

  it('scenario E: skip timer → force-stop → reopen shows no timer and setIndex advanced', async () => {
    const db = makeDb();
    const { sessionId, rt } = await enterRestTimer(db, draftWithRest('ScenarioE'));
    const skipped = await applyWorkoutEvent(db, rt, { type: 'SKIP_TIMER', now: T0 + 1_000 });
    expect(skipped.cursor.timer).toBeNull();
    const fresh = await loadActiveWorkout(db);
    expect(fresh!.sessionId).toBe(sessionId);
    expect(fresh!.cursor.timer).toBeNull();
    expect(fresh!.cursor.setIndex).toBe(2);
    expect(fresh!.session.timerExpiresAt).toBeNull();
  });

  it('completion clears timer and derived cache', async () => {
    const db = makeDb();
    const { sessionId, rt } = await enterRestTimer(db, draftWithRest('CompleteClears'));
    const done = await applyWorkoutEvent(db, rt, { type: 'COMPLETE_SESSION', now: T0 + 10_000 });
    expect(done.cursor.status).toBe('completed');
    const session = await db.get<any>('workout_sessions').find(sessionId);
    expect(session.sessionStatus).toBe('completed');
    expect(session.timerExpiresAt).toBeNull();
    expect(session.cursorJson).not.toContain('"timer":{');
  });

  it('skip while timer active cancels timer state in persisted cursor', async () => {
    const db = makeDb();
    const { sessionId, rt } = await enterRestTimer(db, draftWithRest('SkipCancels'));
    const skipped = await applyWorkoutEvent(db, rt, { type: 'SKIP_TIMER', now: T0 + 500 });
    const reloaded = await loadWorkoutRuntime(db, sessionId);
    expect(reloaded!.cursor.timer).toBeNull();
    expect(reloaded!.session.timerExpiresAt).toBeNull();
    // reversibility preserved (SKIP_TIMER does not clear lastReversible)
    expect(reloaded!.cursor.lastReversible).toMatchObject({ kind: 'set' });
  });
});

describe('Day 4 — notifications (application layer)', () => {
  it('REST timer schedules a notification via the runner', async () => {
    const db = makeDb();
    const { rt } = await enterRestTimer(db, draftWithRest('SchedNotif'));
    expect(notifications.scheduleTimerNotification).toHaveBeenCalledTimes(1);
    const [expiresAt] = notifications.scheduleTimerNotification.mock.calls[0];
    expect(expiresAt).toBe(rt.cursor.timer!.expiresAt);
  });

  it('skip timer cancels the scheduled notification', async () => {
    const db = makeDb();
    const { rt } = await enterRestTimer(db, draftWithRest('SkipCancelsNotif'));
    notifications.scheduleTimerNotification.mockClear();
    notifications.cancelTimerNotification.mockClear();
    await applyWorkoutEvent(db, rt, { type: 'SKIP_TIMER', now: T0 + 100 });
    expect(notifications.cancelTimerNotification).toHaveBeenCalled();
  });

  it('session completion cancels any active notification', async () => {
    const db = makeDb();
    const { rt } = await enterRestTimer(db, draftWithRest('CompleteCancelsNotif'));
    notifications.scheduleTimerNotification.mockClear();
    notifications.cancelTimerNotification.mockClear();
    await applyWorkoutEvent(db, rt, { type: 'COMPLETE_SESSION', now: T0 + 100 });
    expect(notifications.cancelTimerNotification).toHaveBeenCalled();
    expect(notifications.scheduleTimerNotification).not.toHaveBeenCalled();
  });

  it('reconcile on recovered expired timer cancels — never schedules a contradictory alert', async () => {
    const db = makeDb();
    const { sessionId, rt } = await enterRestTimer(db, draftWithRest('ReconcileExpired'));
    notifications.scheduleTimerNotification.mockClear();
    notifications.cancelTimerNotification.mockClear();
    const recovered = await loadWorkoutRuntime(db, sessionId);
    await reconcileTimerNotification(sessionId, recovered!.cursor.timer, recovered!.cursor.timer!.expiresAt + 1);
    expect(notifications.scheduleTimerNotification).not.toHaveBeenCalled();
    expect(notifications.cancelTimerNotification).toHaveBeenCalled();
  });

  it('reconcile with live timer schedules a fresh notification (process-death recovery)', async () => {
    const db = makeDb();
    const { sessionId, rt } = await enterRestTimer(db, draftWithRest('ReconcileLive'));
    notifications.scheduleTimerNotification.mockClear();
    await reconcileTimerNotification(sessionId, rt.cursor.timer, T0);
    expect(notifications.scheduleTimerNotification).toHaveBeenCalledTimes(1);
    const [expiresAt] = notifications.scheduleTimerNotification.mock.calls[0];
    expect(expiresAt).toBe(rt.cursor.timer!.expiresAt);
  });

  it('notification id never replaces cursor timer state', async () => {
    const db = makeDb();
    const { sessionId, rt } = await enterRestTimer(db, draftWithRest('NotifNotTruth'));
    await reconcileTimerNotification(sessionId, rt.cursor.timer, T0);
    const reloaded = await loadWorkoutRuntime(db, sessionId);
    // Truth remains expiresAt in cursor_json — no notification id stored as timer.
    expect(reloaded!.cursor.timer!.expiresAt).toBe(rt.cursor.timer!.expiresAt);
    expect(reloaded!.session.cursorJson).not.toContain('notif_');
    expect(typeof reloaded!.cursor.timer!.expiresAt).toBe('number');
  });

  it('reconcile with null timer clears notifications', async () => {
    notifications.cancelTimerNotification.mockClear();
    await reconcileTimerNotification('sess_x', null, T0);
    expect(notifications.cancelTimerNotification).toHaveBeenCalled();
    expect(notifications.scheduleTimerNotification).not.toHaveBeenCalled();
  });
});

describe('Day 4 — History list', () => {
  it('completed session appears with routine name, duration and set count', async () => {
    const db = makeDb();
    const { sessionId, rt } = await buildAndStart(db, draftWithRest('HistOne', { sets: 1, steps: 1 }));
    await applyWorkoutEvent(db, rt, { type: 'COMPLETE_SET', now: T0, set: SET });
    const rows = await listCompletedSessions(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(sessionId);
    expect(rows[0].name).toBe('HistOne');
    expect(rows[0].endedAt).toBeGreaterThan(0);
    expect(rows[0].durationMs).toBe(rows[0].endedAt! - rows[0].startedAt);
    expect(rows[0].setCount).toBe(1);
  });

  it('active session does not appear as completed history', async () => {
    const db = makeDb();
    await enterRestTimer(db, draftWithRest('StillActive'));
    const rows = await listCompletedSessions(db);
    expect(rows).toHaveLength(0);
  });

  it('newest completed session sorts first', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    // Create two completed sessions with controlled timestamps via direct writes after completion.
    for (const name of ['Older', 'Newer']) {
      const draft = draftWithRest(name, { sets: 1, steps: 1 });
      for (const step of draft.blocks[0].steps) {
        step.exerciseId = await actions.createExercise({ name: step.exerciseName, category: 't', equipment: 'n', metricFlags: 7 });
      }
      const rid = await actions.saveRoutineDraft(draft);
      const sid = await startWorkoutSession(db, rid);
      const rt = await loadWorkoutRuntime(db, sid);
      await applyWorkoutEvent(db, rt!, { type: 'COMPLETE_SET', now: T0, set: SET });
      const ses = await db.get<any>('workout_sessions').find(sid);
      await db.write(async () => {
        await ses.update((rec: any) => {
          rec.startedAt = name === 'Older' ? T0 : T0 + 10_000;
          rec.endedAt = name === 'Older' ? T0 + 60_000 : T0 + 70_000;
        });
      });
    }
    const rows = await listCompletedSessions(db);
    expect(rows.map((r) => r.name)).toEqual(['Newer', 'Older']);
  });

  it('empty state: no completed sessions → empty array', async () => {
    const db = makeDb();
    expect(await listCompletedSessions(db)).toEqual([]);
  });

  it('voided set logs are not counted in setCount', async () => {
    const db = makeDb();
    const { rt } = await buildAndStart(db, draftWithRest('VoidCount', { sets: 3, steps: 1 }));
    const after = await applyWorkoutEvent(db, rt, { type: 'COMPLETE_SET', now: T0, set: SET });
    await applyWorkoutEvent(db, after, { type: 'UNDO_LAST', now: T0 + 100 });
    // finish remaining sets
    let cur = await loadWorkoutRuntime(db, after.sessionId);
    // after undo we're back at set 1
    cur = await applyWorkoutEvent(db, (await loadWorkoutRuntime(db, after.sessionId))!, {
      type: 'COMPLETE_SET',
      now: T0,
      set: SET,
    });
    cur = await applyWorkoutEvent(db, cur, { type: 'SKIP_TIMER', now: T0 });
    cur = await applyWorkoutEvent(db, cur, { type: 'COMPLETE_SET', now: T0, set: SET });
    cur = await applyWorkoutEvent(db, cur, { type: 'SKIP_TIMER', now: T0 });
    cur = await applyWorkoutEvent(db, cur, { type: 'COMPLETE_SET', now: T0, set: SET });
    expect(cur.cursor.status).toBe('completed');
    const rows = await listCompletedSessions(db);
    // 1 voided + 3 completed? Actually: set1 voided then redone... logs: voided(0) + 3 completed = 3 counted
    // Sequence: complete1, undo1, complete1, complete2, complete3 → 3 completed + 1 voided
    expect(rows[0].setCount).toBe(3);
  });
});

describe('Day 4 — History detail', () => {
  it('detail uses definition_json snapshot and shows actual set logs in order', async () => {
    const db = makeDb();
    const draft = draftWithRest('SnapHist', { sets: 2, steps: 2 });
    const { sessionId, rt } = await buildAndStart(db, draft);
    // Ex1 set1 → rest timer → skip → Ex1 set2 → immediate Ex2 → rest edge → skip? Ex2 last set completes?
    // Simpler: sets=1, two steps with rest on last — complete both.
    let cur = await applyWorkoutEvent(db, rt, { type: 'COMPLETE_SET', now: T0, set: { ...SET, weightGrams: 120_000, reps: 8 } });
    // step1 sets=2 → timer between sets
    cur = await applyWorkoutEvent(db, cur, { type: 'SKIP_TIMER', now: T0 });
    cur = await applyWorkoutEvent(db, cur, { type: 'COMPLETE_SET', now: T0, set: { ...SET, weightGrams: 110_000, reps: 7 } });
    // → step2 immediate
    cur = await applyWorkoutEvent(db, cur, { type: 'COMPLETE_SET', now: T0, set: { ...SET, weightGrams: null, reps: 10 } });
    cur = await applyWorkoutEvent(db, cur, { type: 'SKIP_TIMER', now: T0 });
    cur = await applyWorkoutEvent(db, cur, { type: 'COMPLETE_SET', now: T0, set: { ...SET, weightGrams: null, reps: 9 } });
    expect(cur.cursor.status).toBe('completed');

    const detail = await loadSessionDetail(db, sessionId);
    expect(detail).not.toBeNull();
    expect(detail!.name).toBe('SnapHist');
    expect(detail!.status).toBe('completed');
    expect(detail!.blocks).toHaveLength(1);
    expect(detail!.totalCompletedSets).toBe(4);

    const step0 = detail!.blocks[0].steps[0];
    expect(step0.exerciseName).toBe('Ex1');
    expect(step0.targetWeightGrams).toBe(100_000); // from snapshot
    expect(step0.logs).toHaveLength(2);
    expect(step0.logs[0].weightGrams).toBe(120_000);
    expect(step0.logs[0].reps).toBe(8);
    expect(step0.logs[1].weightGrams).toBe(110_000);
    expect(step0.logs[1].reps).toBe(7);

    const step1 = detail!.blocks[0].steps[1];
    expect(step1.logs.map((l) => l.reps)).toEqual([10, 9]);
  });

  it('later routine edits do not corrupt old history snapshot', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    const draft = draftWithRest('EditSafe', { sets: 1, steps: 1 });
    draft.blocks[0].steps[0].prescription.targetWeightGrams = 100_000;
    for (const step of draft.blocks[0].steps) {
      step.exerciseId = await actions.createExercise({ name: step.exerciseName, category: 't', equipment: 'n', metricFlags: 7 });
    }
    const routineId = await actions.saveRoutineDraft(draft);
    const sessionId = await startWorkoutSession(db, routineId);
    const rt = await loadWorkoutRuntime(db, sessionId);
    await applyWorkoutEvent(db, rt!, { type: 'COMPLETE_SET', now: T0, set: SET });

    // Mutate the live routine after the session completed.
    const live = await actions.loadRoutineDraft(routineId);
    live.name = 'Renamed Later';
    live.blocks[0].steps[0].prescription.targetWeightGrams = 200_000;
    live.blocks[0].steps[0].exerciseName = 'Different Exercise';
    await actions.saveRoutineDraft(live);

    const detail = await loadSessionDetail(db, sessionId);
    expect(detail!.name).toBe('EditSafe'); // session name frozen
    expect(detail!.definition.name).toBe('EditSafe');
    expect(detail!.blocks[0].steps[0].targetWeightGrams).toBe(100_000); // snapshot target
    expect(detail!.blocks[0].steps[0].exerciseName).toBe('Ex1');
  });

  it('detail returns null for missing or non-completed sessions', async () => {
    const db = makeDb();
    expect(await loadSessionDetail(db, 'does-not-exist')).toBeNull();
    const { sessionId } = await enterRestTimer(db, draftWithRest('StillActiveDetail'));
    expect(await loadSessionDetail(db, sessionId)).toBeNull(); // active, not completed
  });

  it('detail handles session with zero logs safely', async () => {
    const db = makeDb();
    const { sessionId, rt } = await buildAndStart(db, draftWithRest('NoLogs', { sets: 1, steps: 1 }));
    await applyWorkoutEvent(db, rt, { type: 'COMPLETE_SESSION', now: T0 });
    const detail = await loadSessionDetail(db, sessionId);
    expect(detail).not.toBeNull();
    expect(detail!.totalCompletedSets).toBe(0);
    expect(detail!.blocks[0].steps[0].logs).toEqual([]);
  });

  it('malformed definition_json is handled safely (null detail)', async () => {
    const db = makeDb();
    const { sessionId, rt } = await buildAndStart(db, draftWithRest('Corrupt', { sets: 1, steps: 1 }));
    await applyWorkoutEvent(db, rt, { type: 'COMPLETE_SESSION', now: T0 });
    const ses = await db.get<any>('workout_sessions').find(sessionId);
    await db.write(async () => {
      await ses.update((rec: any) => {
        rec.definitionJson = '{not-json';
      });
    });
    expect(await loadSessionDetail(db, sessionId)).toBeNull();
  });

  it('block and step order follow the original snapshot', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    const draft: RoutineDraft = {
      id: null,
      name: 'Ordered',
      blocks: [
        {
          localId: 'b1',
          name: 'First Block',
          kind: 'normal',
          rounds: 1,
          steps: [
            {
              localId: 's1',
              exerciseId: null,
              exerciseName: 'Squat',
              prescription: { ...emptyPrescription(), targetSets: 1 },
              transition: { type: 'immediate', delayMs: 0 },
            },
            {
              localId: 's2',
              exerciseId: null,
              exerciseName: 'Press',
              prescription: { ...emptyPrescription(), targetSets: 1 },
              transition: { type: 'immediate', delayMs: 0 },
            },
          ],
        },
        {
          localId: 'b2',
          name: 'Second Block',
          kind: 'circuit',
          rounds: 1,
          steps: [
            {
              localId: 's3',
              exerciseId: null,
              exerciseName: 'Plank',
              prescription: { ...emptyPrescription(), targetSets: 1 },
              transition: { type: 'immediate', delayMs: 0 },
            },
          ],
        },
      ],
    };
    for (const b of draft.blocks) {
      for (const s of b.steps) {
        s.exerciseId = await actions.createExercise({ name: s.exerciseName, category: 't', equipment: 'n', metricFlags: 7 });
      }
    }
    const routineId = await actions.saveRoutineDraft(draft);
    const sessionId = await startWorkoutSession(db, routineId);
    let rt = (await loadWorkoutRuntime(db, sessionId))!;
    // Walk the whole session: b1s1, b1s2, rest 120 default? transitions are immediate on s2 (last of block) → wait
    // s2 last of block1 with immediate → immediate to block2? timing immediate + not complete → advance.
    rt = await applyWorkoutEvent(db, rt, { type: 'COMPLETE_SET', now: T0, set: SET });
    rt = await applyWorkoutEvent(db, rt, { type: 'COMPLETE_SET', now: T0, set: SET });
    // may have timer for block transition — skip any timer
    while (rt.cursor.timer && rt.cursor.status === 'active') {
      rt = await applyWorkoutEvent(db, rt, { type: 'SKIP_TIMER', now: T0 });
    }
    if (rt.cursor.status === 'active') {
      rt = await applyWorkoutEvent(db, rt, { type: 'COMPLETE_SET', now: T0, set: SET });
    }
    expect(rt.cursor.status).toBe('completed');

    const detail = await loadSessionDetail(db, sessionId);
    expect(detail!.blocks.map((b) => b.name)).toEqual(['First Block', 'Second Block']);
    expect(detail!.blocks[0].steps.map((s) => s.exerciseName)).toEqual(['Squat', 'Press']);
    expect(detail!.blocks[1].steps.map((s) => s.exerciseName)).toEqual(['Plank']);
    expect(detail!.blocks[1].kind).toBe('circuit');
  });
});

describe('Day 4 — recovery scenario D', () => {
  it('scenario D: complete session → reopen → appears in History, no active session', async () => {
    const db = makeDb();
    const { sessionId, rt } = await buildAndStart(db, draftWithRest('ScenarioD', { sets: 1, steps: 1 }));
    const done = await applyWorkoutEvent(db, rt, { type: 'COMPLETE_SET', now: T0, set: SET });
    expect(done.cursor.status).toBe('completed');

    // "Reopen" — only DB access
    expect(await loadActiveWorkout(db)).toBeNull();
    const history = await listCompletedSessions(db);
    expect(history.map((h) => h.id)).toContain(sessionId);
    const detail = await loadSessionDetail(db, sessionId);
    expect(detail!.status).toBe('completed');
    expect(detail!.totalCompletedSets).toBe(1);
  });
});
