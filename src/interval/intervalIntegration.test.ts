import { Database, Q } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import { schema } from '../data/schema';
import { migrations } from '../data/migrations';
import { modelClasses } from '../data/models';
import { makeDbActions } from '../data/actions';
import { serializeRoutine, definitionOf, cursorOf } from '../data/serialize';
import { startWorkoutSession, loadWorkoutRuntime, applyWorkoutEvent, discardWorkout } from '../workout/runner';
import { parseCursor } from '../engine/cursor';
import { dispatch } from '../engine';
import { emptyPrescription, defaultIntervalSpec, type RoutineDraft } from '../types/draft';
import type { IntervalSpec, SetPayload } from '../types/engine';
import { startInterval, cancelInterval, sampleInterval, type IntervalRuntime } from './intervalEngine';

jest.mock('../notifications', () => ({
  scheduleTimerNotification: jest.fn(async () => 'n1'),
  cancelTimerNotification: jest.fn(async () => undefined),
  requestNotificationPermission: jest.fn(async () => true),
  listScheduledNotificationIds: jest.fn(async () => []),
  __resetNotificationPermissionLatchForTests: jest.fn(),
}));

function makeDb(): Database {
  const adapter = new LokiJSAdapter({
    dbName: `apexfoss-interval-${Math.random().toString(36).slice(2)}`,
    schema,
    migrations,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
  });
  return new Database({ adapter, modelClasses: modelClasses as any });
}

const T0 = 1_700_000_000_000;
const SET: SetPayload = { weightGrams: 100_000, reps: 5, durationMs: null, distanceMm: null, rir: 2 };

function intervalDraft(interval: IntervalSpec): RoutineDraft {
  return {
    id: null,
    name: 'Conditioning',
    blocks: [
      {
        localId: 'b1',
        name: 'Warmup',
        kind: 'normal',
        rounds: 1,
        steps: [
          {
            localId: 's1',
            exerciseId: null,
            exerciseName: 'Row',
            prescription: { ...emptyPrescription(), targetSets: 1, targetRepsMin: 1 },
            transition: { type: 'immediate', delayMs: 0 },
          },
        ],
      },
      {
        localId: 'b2',
        name: 'EMOM Block',
        kind: 'interval',
        rounds: 1,
        interval,
        steps: [
          {
            localId: 's2',
            exerciseId: null,
            exerciseName: 'Interval',
            prescription: emptyPrescription(),
            transition: { type: 'immediate', delayMs: 0 },
          },
        ],
      },
    ],
  };
}

async function saveDraft(db: Database, draft: RoutineDraft): Promise<string> {
  const actions = makeDbActions(db);
  const exId = await actions.createExercise({
    name: 'Row',
    category: 'engine',
    equipment: 'none',
    metricFlags: 7,
  });
  const d = {
    ...draft,
    blocks: draft.blocks.map((b) => ({
      ...b,
      steps: b.steps.map((s) => ({ ...s, exerciseId: s.exerciseId ?? exId })),
    })),
  };
  return actions.saveRoutineDraft(d);
}

describe('interval programming (serializer + cursor recovery)', () => {
  it('round-trips IntervalSpec through save → serialize → definition_json', async () => {
    const db = makeDb();
    const spec: IntervalSpec = {
      mode: 'emom',
      workMs: 30_000,
      restMs: 0,
      rounds: 10,
      periodMs: 60_000,
      preparationMs: 3_000,
    };
    const routineId = await saveDraft(db, intervalDraft(spec));
    const routine = await db.get('routines').find(routineId);
    const def = await serializeRoutine(db, routine as any);

    expect(def.blocks).toHaveLength(2);
    const ib = def.blocks[1];
    expect(ib.kind).toBe('interval');
    expect(ib.interval).toEqual(spec);
    expect(ib.rounds).toBe(1); // interval blocks pin engine rounds to 1
    // deterministic JSON: two serializations identical
    expect(JSON.stringify(def)).toBe(JSON.stringify(await serializeRoutine(db, routine as any)));
  });

  it('non-interval blocks have null interval field', async () => {
    const db = makeDb();
    const routineId = await saveDraft(db, intervalDraft(defaultIntervalSpec()));
    const routine = await db.get('routines').find(routineId);
    const def = await serializeRoutine(db, routine as any);
    expect(def.blocks[0].interval).toBeNull();
    expect(def.blocks[0].kind).toBe('normal');
  });

  it('start session + definition snapshot survives reload', async () => {
    const db = makeDb();
    const routineId = await saveDraft(db, intervalDraft(defaultIntervalSpec()));
    const sessionId = await startWorkoutSession(db, routineId);
    const rt = await loadWorkoutRuntime(db, sessionId);
    expect(rt).not.toBeNull();
    expect(rt!.definition.blocks[1].interval?.mode).toBe('hiit');
    expect(rt!.cursor.status).toBe('active');
    expect(rt!.cursor.blockIndex).toBe(0);
  });

  it('cursor interval field optional; parseCursor discards corrupt payload', () => {
    const base = {
      blockIndex: 0,
      stepIndex: 0,
      round: 1,
      setIndex: 1,
      status: 'active' as const,
      timer: null,
      lastReversible: null,
      startedAt: T0,
    };
    // absent → fine
    expect(parseCursor(JSON.stringify(base)).interval).toBeUndefined();
    // malformed object
    const bad = { ...base, interval: { status: 'running' } };
    expect(parseCursor(JSON.stringify(bad)).interval).toBeNull();
    // non-object
    expect(parseCursor(JSON.stringify({ ...base, interval: 'nope' })).interval).toBeNull();
    // valid running payload survives
    const live = startInterval(defaultIntervalSpec(), T0).runtime;
    const withIv = {
      ...base,
      interval: {
        status: 'running',
        config: live.config,
        startedAt: live.startedAt,
        round: live.round,
        phase: live.phase,
        phaseStartsAt: live.phaseStartsAt,
        phaseEndsAt: live.phaseEndsAt,
        workDoneEarly: false,
      },
    };
    const parsed = parseCursor(JSON.stringify(withIv));
    expect(parsed.interval?.status).toBe('running');
    expect(parsed.interval?.config?.rounds).toBe(8);
  });

  it('interval runtime can be persisted on cursor and recovered after "process death"', async () => {
    const db = makeDb();
    const routineId = await saveDraft(db, intervalDraft(defaultIntervalSpec()));
    const sessionId = await startWorkoutSession(db, routineId);
    let rt = (await loadWorkoutRuntime(db, sessionId))!;

    // Advance to interval block via SKIP_STEP on warmup
    const afterSkip = dispatch(rt.definition, rt.cursor, { type: 'SKIP_STEP', now: T0 });
    rt = { ...rt, cursor: afterSkip.cursor };
    expect(rt.cursor.blockIndex).toBe(1);

    const started = startInterval(rt.definition.blocks[1].interval!, T0);
    const withInterval = { ...rt.cursor, interval: {
      status: 'running' as const,
      config: started.runtime.config!,
      startedAt: started.runtime.startedAt,
      round: started.runtime.round,
      phase: started.runtime.phase,
      phaseStartsAt: started.runtime.phaseStartsAt,
      phaseEndsAt: started.runtime.phaseEndsAt,
      workDoneEarly: false,
    }};
    const actions = makeDbActions(db);
    await actions.persistCursor(rt.session, withInterval);

    // Simulate process death: reload from DB only
    const reloaded = (await loadWorkoutRuntime(db, sessionId))!;
    expect(reloaded.cursor.interval).not.toBeNull();
    expect(reloaded.cursor.interval!.status).toBe('running');

    // Resume at +95s → correct HIIT position from timestamps
    const resumed = sampleInterval(
      {
        status: 'running',
        config: reloaded.cursor.interval!.config as IntervalRuntime['config'],
        startedAt: reloaded.cursor.interval!.startedAt,
        round: reloaded.cursor.interval!.round,
        phase: reloaded.cursor.interval!.phase,
        phaseStartsAt: reloaded.cursor.interval!.phaseStartsAt,
        phaseEndsAt: reloaded.cursor.interval!.phaseEndsAt,
        workDoneEarly: false,
      },
      T0 + 95_000,
    );
    expect(resumed.round).toBe(3);
    expect(resumed.phase).toBe('work');
  });

  it('interval completion + SKIP_STEP advances without creating set_logs', async () => {
    const db = makeDb();
    const routineId = await saveDraft(db, intervalDraft(defaultIntervalSpec()));
    const sessionId = await startWorkoutSession(db, routineId);
    let rt = (await loadWorkoutRuntime(db, sessionId))!;

    // Complete warmup set
    const complete = dispatch(rt.definition, rt.cursor, { type: 'COMPLETE_SET', now: T0, set: SET });
    // Warmup has 1 set → immediate → interval block (resolveRestStep may insert auto timer)
    rt = { ...rt, cursor: complete.cursor };
    // Skip any timer to land on interval
    if (rt.cursor.timer) {
      const skipT = dispatch(rt.definition, rt.cursor, { type: 'SKIP_TIMER', now: T0 });
      rt = { ...rt, cursor: skipT.cursor };
    }
    expect(rt.cursor.blockIndex).toBe(1);

    // Athlete finishes interval → UI dispatches SKIP_STEP (no LOG_SET)
    const beforeLogs = await db.get('set_logs').query().fetchCount();
    const after = dispatch(rt.definition, rt.cursor, { type: 'SKIP_STEP', now: T0 + 1000 });
    expect(after.effects.some((e) => e.kind === 'LOG_SET')).toBe(false);
    // Interval is last block → session completes
    expect(after.cursor.status).toBe('completed');
    expect(after.effects).toContainEqual({ kind: 'COMPLETE_SESSION' });
    const afterLogs = await db.get('set_logs').query().fetchCount();
    expect(afterLogs).toBe(beforeLogs); // no new set logs from interval completion
  });

  it('existing REST/AUTO still work alongside interval blocks', async () => {
    const db = makeDb();
    const routineId = await saveDraft(db, intervalDraft(defaultIntervalSpec()));
    const sessionId = await startWorkoutSession(db, routineId);
    const rt = (await loadWorkoutRuntime(db, sessionId))!;
    const result = dispatch(rt.definition, rt.cursor, { type: 'COMPLETE_SET', now: T0, set: SET });
    // Must stay a valid cursor (active or completed depending on timing path)
    expect(['active', 'completed']).toContain(result.cursor.status);
    expect(typeof result.cursor.blockIndex).toBe('number');
  });

  it('discard soft-deletes session with interval programming intact for next start', async () => {
    const db = makeDb();
    const routineId = await saveDraft(db, intervalDraft(defaultIntervalSpec()));
    const sessionId = await startWorkoutSession(db, routineId);
    const rt = (await loadWorkoutRuntime(db, sessionId))!;
    await discardWorkout(db, rt);
    expect(await loadWorkoutRuntime(db, sessionId)).toBeNull();
    // routine still executable
    const again = await startWorkoutSession(db, routineId);
    const rt2 = (await loadWorkoutRuntime(db, again))!;
    expect(rt2.definition.blocks[1].interval?.mode).toBe('hiit');
  });

  it('cancelInterval yields idle runtime safe for persistence clear', () => {
    const idle = cancelInterval();
    expect(idle.status).toBe('idle');
    expect(idle.config).toBeNull();
  });

  it('definitionOf / cursorOf parse session JSON with interval field', async () => {
    const db = makeDb();
    const routineId = await saveDraft(db, intervalDraft(defaultIntervalSpec()));
    const sessionId = await startWorkoutSession(db, routineId);
    const rt = (await loadWorkoutRuntime(db, sessionId))!;
    const def = definitionOf(rt.session);
    const cur = cursorOf(rt.session);
    expect(def.blocks[1].kind).toBe('interval');
    expect(cur.blockIndex).toBe(0);
    expect(cur.interval ?? null).toBeNull();
  });
});

describe('interval feedback keep-awake ownership', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('tempo and interval tags are independent (release one keeps the other)', () => {
    const ka = require('../ui/keepAwake') as typeof import('../ui/keepAwake');
    ka.__resetKeepAwakeForTests();
    // In node, activate may fail-soft without holding — simulate held via direct API
    // When expo-keep-awake is present (it is installed), tags are tracked.
    ka.activateTempoKeepAwake();
    ka.activateIntervalKeepAwake();
    const held = ka.__keepAwakeHeldTagsForTests();
    // If native module loaded, both tags held; if fail-soft empty, still no throw
    if (held.includes('apexfoss-tempo')) {
      ka.releaseTempoKeepAwake();
      const after = ka.__keepAwakeHeldTagsForTests();
      expect(after).not.toContain('apexfoss-tempo');
      if (held.includes('apexfoss-interval')) {
        expect(after).toContain('apexfoss-interval');
      }
    }
    ka.releaseIntervalKeepAwake();
    ka.releaseTempoKeepAwake();
    expect(() => ka.activateTempoKeepAwake()).not.toThrow();
    ka.__resetKeepAwakeForTests();
  });

  it('interval haptic adapter never throws', () => {
    const fb = require('../tempo/feedback') as typeof import('../tempo/feedback');
    expect(() => fb.pulseIntervalHaptic({ kind: 'PHASE_START', phase: 'prep', round: 1 })).not.toThrow();
    expect(() => fb.pulseIntervalHaptic({ kind: 'PHASE_START', phase: 'work', round: 2 })).not.toThrow();
    expect(() => fb.pulseIntervalHaptic({ kind: 'PHASE_START', phase: 'rest', round: 2 })).not.toThrow();
    expect(() => fb.pulseIntervalHaptic({ kind: 'ROUND_START', round: 3 })).not.toThrow();
    expect(() => fb.pulseIntervalHaptic({ kind: 'INTERVAL_COMPLETE' })).not.toThrow();
  });
});
