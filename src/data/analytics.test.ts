import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import { schema } from './schema';
import { migrations } from './migrations';
import { modelClasses } from './models';
import { makeDbActions } from './actions';
import { loadAnalyticsSnapshot } from './analytics';
import { MetricFlag } from '../types';

function makeDb(): Database {
  const adapter = new LokiJSAdapter({
    dbName: `apexfoss-analytics-test-${Math.random().toString(36).slice(2)}`,
    schema,
    migrations,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
  });
  return new Database({ adapter, modelClasses: modelClasses as any });
}

const T = 1_700_000_000_000;

const BENCH_DEFINITION = {
  id: 'routine-1',
  name: 'Push day',
  blocks: [
    {
      id: 'block-1',
      name: 'Main',
      kind: 'straight',
      rounds: 1,
      steps: [
        {
          id: 'step-1',
          role: 'primary',
          exerciseId: 'seed_bench_press',
          exerciseName: 'Bench Press',
          prescription: {
            targetSets: 1,
            targetRepsMin: 5,
            targetRepsMax: null,
            targetWeightGrams: null,
            targetDurationMs: null,
            targetRir: null,
            tempo: { eccentricMs: null, pauseBottomMs: null, concentricMs: null, pauseTopMs: null },
          },
        },
      ],
      transitions: [],
    },
  ],
};

async function createCompletedSession(
  db: Database,
  options: {
    status?: string;
    definitionJson?: string;
    stepExerciseId?: string | null;
    stepExerciseName?: string;
    logs?: Array<{
      weightGrams: number | null;
      reps: number | null;
      durationMs: number | null;
      distanceMm?: number | null;
      isCompleted: number;
      blockIndex?: number;
      stepIndex?: number;
    }>;
  } = {},
): Promise<string> {
  return db.write(async () => {
  const session = await db.get<any>('workout_sessions').create((rec: any) => {
    rec.routineId = null;
    rec.name = 'Push day';
    rec.startedAt = T;
    rec.endedAt = T + 3600_000;
    rec.sessionStatus = options.status ?? 'completed';
    rec.definitionJson = options.definitionJson ?? JSON.stringify(BENCH_DEFINITION);
    rec.cursorJson = '{"status":"completed","blockIndex":0,"stepIndex":0,"round":1,"setIndex":1}';
    rec.currentBlockIndex = 0;
    rec.currentStepId = null;
    rec.currentRound = 1;
    rec.currentSetIndex = 1;
    rec.timerExpiresAt = null;
    rec.createdAt = T;
    rec.updatedAt = T;
  });

  let definition: any = null;
  try {
    definition = JSON.parse(options.definitionJson ?? JSON.stringify(BENCH_DEFINITION));
  } catch {
    definition = null;
  }
  const step = definition?.blocks?.[0]?.steps?.[0];
  if (step) {
    if (options.stepExerciseId !== undefined) {
      step.exerciseId = options.stepExerciseId;
    }
    if (options.stepExerciseName) {
      step.exerciseName = options.stepExerciseName;
    }
    if (options.definitionJson === undefined) {
      await session.update((rec: any) => {
        rec.definitionJson = JSON.stringify(definition);
      });
    }
  }

  const logs = options.logs ?? [];
  if (logs.length > 0) {
    const se = await db.get<any>('session_exercises').create((rec: any) => {
      rec.sessionId = session.id;
      rec.exerciseId = null;
      rec.exerciseName = step?.exerciseName ?? 'Bench Press';
      rec.blockIndex = 0;
      rec.orderIndex = 0;
      rec.createdAt = T;
      rec.updatedAt = T;
    });
    for (const [index, log] of logs.entries()) {
      await db.get<any>('set_logs').create((rec: any) => {
        rec.sessionExerciseId = se.id;
        rec.blockIndex = log.blockIndex ?? 0;
        rec.stepIndex = log.stepIndex ?? 0;
        rec.round = 1;
        rec.setIndex = index + 1;
        rec.weightGrams = log.weightGrams;
        rec.reps = log.reps;
        rec.durationMs = log.durationMs;
        rec.distanceMm = log.distanceMm ?? null;
        rec.rir = null;
        rec.isCompleted = log.isCompleted;
        rec.completedAt = T;
        rec.createdAt = T;
        rec.updatedAt = T;
      });
    }
  }
  return session.id;
  });
}

const benchSet = { weightGrams: 60_000, reps: 5, durationMs: null, isCompleted: 1 };

describe('loadAnalyticsSnapshot', () => {
  it('returns an empty snapshot for an empty database', async () => {
    const db = makeDb();
    const snapshot = await loadAnalyticsSnapshot(db);
    expect(snapshot.sessions).toEqual([]);
    expect(snapshot.exercises).toEqual([]);
  });

  it('resolves built-in muscle mapping through the deterministic seed id', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    await actions.seedExercisesIfEmpty();
    await createCompletedSession(db, { logs: [benchSet] });

    const snapshot = await loadAnalyticsSnapshot(db);
    expect(snapshot.sessions).toHaveLength(1);
    const stepEx = snapshot.sessions[0].exercises[0];
    expect(stepEx.exerciseName).toBe('Bench Press');
    expect(stepEx.contributions).toEqual([['chest', 6000], ['triceps', 2500], ['front_delts', 1500]]);
    expect(stepEx.sets).toEqual([
      { weightGrams: 60_000, reps: 5, durationMs: null, distanceMm: null, isCompleted: true },
    ]);
    expect(stepEx.exerciseId).toBe('seed_bench_press');
    expect(snapshot.exercises.map((e) => e.id)).toContain('seed_bench_press');
  });

  it('excludes sessions that are not completed', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    await actions.seedExercisesIfEmpty();
    await createCompletedSession(db, { status: 'active', logs: [benchSet] });

    const snapshot = await loadAnalyticsSnapshot(db);
    expect(snapshot.sessions).toEqual([]);
    expect(snapshot.exercises.length).toBeGreaterThan(0);
  });

  it('skips sessions with a corrupt snapshot instead of crashing', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    await actions.seedExercisesIfEmpty();
    await createCompletedSession(db, { definitionJson: 'not-json-at-all', logs: [benchSet] });
    await createCompletedSession(db, { logs: [benchSet] });

    const snapshot = await loadAnalyticsSnapshot(db);
    expect(snapshot.sessions).toHaveLength(1);
    expect(snapshot.sessions[0].exercises[0].exerciseName).toBe('Bench Press');
  });

  it('falls back to the portable record key for legacy (pre-deterministic) ids', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    await actions.seedExercisesIfEmpty();
    // Simulate an install seeded before deterministic ids existed: random id,
    // but the exact built-in record fields.
    const legacy = db.get('exercises').prepareCreateFromDirtyRaw({
      id: 'legacy-random-bench-id',
      name: 'Bench Press',
      category: 'push',
      equipment: 'barbell',
      metric_flags: MetricFlag.WEIGHT | MetricFlag.REPS,
      created_at: T,
      updated_at: T,
    });
    await db.write(async () => {
      await db.batch(legacy);
    });

    await createCompletedSession(db, {
      stepExerciseId: 'legacy-random-bench-id',
      logs: [benchSet],
    });

    const snapshot = await loadAnalyticsSnapshot(db);
    expect(snapshot.sessions).toHaveLength(1);
    expect(snapshot.sessions[0].exercises[0].contributions).toEqual([
      ['chest', 6000],
      ['triceps', 2500],
      ['front_delts', 1500],
    ]);
  });

  it('leaves custom exercises unmapped', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    await actions.seedExercisesIfEmpty();
    const customId = await actions.createExercise({
      name: 'Zercher Squat',
      category: 'legs',
      equipment: 'barbell',
      metricFlags: MetricFlag.WEIGHT | MetricFlag.REPS,
    });

    await createCompletedSession(db, {
      stepExerciseId: customId,
      stepExerciseName: 'Zercher Squat',
      logs: [benchSet],
    });

    const snapshot = await loadAnalyticsSnapshot(db);
    expect(snapshot.sessions[0].exercises[0].contributions).toBeNull();
  });

  it('leaves deleted/unknown exercise references unmapped', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    await actions.seedExercisesIfEmpty();
    await createCompletedSession(db, { stepExerciseId: 'deleted-exercise-id', logs: [benchSet] });

    const snapshot = await loadAnalyticsSnapshot(db);
    expect(snapshot.sessions).toHaveLength(1);
    expect(snapshot.sessions[0].exercises[0].contributions).toBeNull();
  });

  it('preserves incomplete set flags and passes duration through untouched', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    await actions.seedExercisesIfEmpty();
    await createCompletedSession(db, {
      logs: [
        { weightGrams: 60_000, reps: 5, durationMs: null, isCompleted: 1 },
        { weightGrams: 60_000, reps: 5, durationMs: null, isCompleted: 0 },
        { weightGrams: null, reps: null, durationMs: 45_000, isCompleted: 1 },
      ],
    });

    const snapshot = await loadAnalyticsSnapshot(db);
    const sets = snapshot.sessions[0].exercises[0].sets;
    expect(sets).toEqual([
      { weightGrams: 60_000, reps: 5, durationMs: null, distanceMm: null, isCompleted: true },
      { weightGrams: 60_000, reps: 5, durationMs: null, distanceMm: null, isCompleted: false },
      { weightGrams: null, reps: null, durationMs: 45_000, distanceMm: null, isCompleted: true },
    ]);
  });

  it('carries distance through the snapshot as a record basis (§12)', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    await actions.seedExercisesIfEmpty();
    await createCompletedSession(db, {
      logs: [{ weightGrams: null, reps: 1, durationMs: null, distanceMm: 2_500, isCompleted: 1 }],
    });
    const snapshot = await loadAnalyticsSnapshot(db);
    expect(snapshot.sessions[0].exercises[0].sets[0].distanceMm).toBe(2_500);
  });

  it('keeps steps without any set logs out of the snapshot', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    await actions.seedExercisesIfEmpty();
    await createCompletedSession(db, { logs: [] });

    const snapshot = await loadAnalyticsSnapshot(db);
    expect(snapshot.sessions).toHaveLength(1);
    expect(snapshot.sessions[0].exercises).toEqual([]);
  });
});
