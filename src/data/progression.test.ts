import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import { schema } from './schema';
import { migrations } from './migrations';
import { modelClasses } from './models';
import { makeDbActions } from './actions';
import {
  loadProgressionSnapshot,
  summarizeProgression,
  summarizeTrends,
  analyzeStepEvidence,
  progressionInputFor,
} from './progression';
import { resolveAchievableNextWeightGrams } from '../analytics/progressionWiring';

/**
 * Phase 3B integration: stored history → pure engine. Real LokiJS DB (the
 * same pattern as analytics.test.ts) — no engine mocking, no rule duplication.
 */

function makeDb(): Database {
  const adapter = new LokiJSAdapter({
    dbName: `apexfoss-prog-test-${Math.random().toString(36).slice(2)}`,
    schema,
    migrations,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
  });
  return new Database({ adapter, modelClasses: modelClasses as any });
}

const T = 1_700_000_000_000;

/**
 * WatermelonDB assigns row ids itself (client-forced ids are ignored), so
 * fixtures mirror production: create the row first, then write its REAL id
 * into the definition snapshot — exactly what RoutineEditor does.
 */
async function seedExercise(
  db: Database,
  name: string,
  equipment = 'barbell',
): Promise<string> {
  let id = '';
  await db.write(async () => {
    const row = await db.get('exercises').create((rec: any) => {
      rec.name = name;
      rec.category = 'push';
      rec.equipment = equipment;
      rec.metricFlags = 3;
      rec.createdAt = T;
      rec.updatedAt = T;
    });
    id = row.id;
  });
  return id;
}

/** Two-session bench history: 10 reps, then 12 (upper bound of 8–12) at 50kg. */
const BENCH_DEF = (exerciseId: string) => ({
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
          role: 'work',
          exerciseId,
          exerciseName: 'Bench Press',
          prescription: {
            targetSets: 3,
            targetRepsMin: 8,
            targetRepsMax: 12,
            targetWeightGrams: 50000,
            targetDurationMs: null,
            targetRir: 2,
            tempo: { eccentricMs: null, pauseBottomMs: null, concentricMs: null, pauseTopMs: null },
          },
        },
      ],
      transitions: [],
    },
  ],
});

async function createCompletedSession(
  db: Database,
  opts: {
    name?: string;
    endedAt?: number;
    definition: ReturnType<typeof BENCH_DEF>;
    logs: Array<{ weightGrams: number; reps: number }>;
  },
): Promise<string> {
  return db.write(async () => {
    const session = await db.get<any>('workout_sessions').create((rec: any) => {
      rec.routineId = null;
      rec.name = opts.name ?? 'Push day';
      rec.startedAt = (opts.endedAt ?? T) - 3_600_000;
      rec.endedAt = opts.endedAt ?? T;
      rec.sessionStatus = 'completed';
      rec.definitionJson = JSON.stringify(opts.definition);
      rec.cursorJson = '{"status":"completed","blockIndex":0,"stepIndex":0,"round":1,"setIndex":1}';
      rec.currentBlockIndex = 0;
      rec.currentStepId = null;
      rec.currentRound = 1;
      rec.currentSetIndex = 1;
      rec.timerExpiresAt = null;
      rec.createdAt = T;
      rec.updatedAt = T;
    });
    const step = opts.definition.blocks[0].steps[0];
    const se = await db.get('session_exercises').create((rec: any) => {
      rec.sessionId = session.id;
      rec.exerciseId = step.exerciseId;
      rec.exerciseName = step.exerciseName;
      rec.blockIndex = 0;
      rec.orderIndex = 0;
      rec.createdAt = T;
      rec.updatedAt = T;
    });
    for (const [i, log] of opts.logs.entries()) {
      await db.get('set_logs').create((rec: any) => {
        rec.sessionExerciseId = se.id;
        rec.blockIndex = 0;
        rec.stepIndex = 0;
        rec.round = 1;
        rec.setIndex = i + 1;
        rec.weightGrams = log.weightGrams;
        rec.reps = log.reps;
        rec.durationMs = null;
        rec.distanceMm = null;
        rec.rir = null;
        rec.isCompleted = 1;
        rec.completedAt = T;
        rec.createdAt = T;
        rec.updatedAt = T;
      });
    }
    return session.id;
  });
}

async function seedInventory(
  db: Database,
  items: Array<{ name: string; weightGrams: number; quantity: number; perSide?: boolean }>,
): Promise<void> {
  await db.write(async () => {
    for (const [i, item] of items.entries()) {
      await db.get('equipment_items').create((rec: any) => {
        rec.name = item.name;
        rec.weightGrams = item.weightGrams;
        rec.quantity = item.quantity;
        rec.perSide = item.perSide === true ? 1 : 0;
        rec.createdAt = T + i;
        rec.updatedAt = T + i;
      });
    }
  });
}

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(T + 7 * 86_400_000);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('resolveAchievableNextWeightGrams (inventory → engine input)', () => {
  it('returns the closest reachable load above the target', () => {
    // Bar as fixed piece + paired 2.5kg plates: 60kg bar + 2×2.5 = 65kg.
    const items = [
      { name: 'Bar', weightGrams: 60_000, quantity: 1, perSide: false },
      { name: '2.5kg plates', weightGrams: 2_500, quantity: 2, perSide: true },
    ];
    expect(resolveAchievableNextWeightGrams(items, 60_000)).toBe(65_000);
  });

  it('skips intermediate pairs and lands on the closest above-target total', () => {
    const items = [
      { name: 'Bar', weightGrams: 20_000, quantity: 1, perSide: false },
      { name: '10kg plates', weightGrams: 10_000, quantity: 6, perSide: true },
    ];
    // reachable: 20..100 (10s); above 50 → 60
    expect(resolveAchievableNextWeightGrams(items, 50_000)).toBe(60_000);
  });

  it('returns undefined with no inventory (never invents an increment)', () => {
    expect(resolveAchievableNextWeightGrams([], 50_000)).toBeUndefined();
  });

  it('returns undefined when nothing exceeds the target (plates-only, no bar)', () => {
    const items = [{ name: '10kg plates', weightGrams: 10_000, quantity: 4, perSide: true }];
    expect(resolveAchievableNextWeightGrams(items, 80_000)).toBeUndefined();
  });

  it('returns undefined for a null/invalid target', () => {
    expect(resolveAchievableNextWeightGrams([{ name: 'x', weightGrams: 1_000, quantity: 1 }], null)).toBeUndefined();
    expect(resolveAchievableNextWeightGrams([{ name: 'x', weightGrams: 1_000, quantity: 1 }], 0)).toBeUndefined();
  });
});

describe('loadProgressionSnapshot + summarizeProgression (DB → engine)', () => {
  it('classifies a completed upper-bound session as progress without inventing weight', async () => {
    const db = makeDb();
    const benchId = await seedExercise(db, 'Bench Press');
    await createCompletedSession(db, {
      endedAt: T,
      definition: BENCH_DEF(benchId),
      logs: [{ weightGrams: 50_000, reps: 10 }],
    });
    await createCompletedSession(db, {
      endedAt: T + 86_400_000,
      definition: BENCH_DEF(benchId),
      logs: [{ weightGrams: 50_000, reps: 12 }],
    });

    const prog = await loadProgressionSnapshot(db);
    expect(prog.historicalPrescriptions.size).toBeGreaterThanOrEqual(2);
    expect(prog.equipmentItems).toEqual([]);

    const overview = summarizeProgression(prog, Date.now());
    const total = overview.progress.length + overview.maintain.length + overview.insufficient.length;
    expect(total).toBe(1);

    const entry = overview.progress[0] ?? overview.maintain[0] ?? overview.insufficient[0];
    expect(entry.evidence.state).toBe('progress');
    expect(entry.evidence.reason).toBe('REPS_RANGE_COMPLETED');
    expect(entry.evidence.atTargetWeight).toBe(true);
    expect(entry.evidence.suggestedWeightGrams).toBeUndefined();
    expect(entry.evidence.weightIncrementSource).toBe('none');
  });

  it('attaches an inventory-backed next weight when the equipment allows it', async () => {
    const db = makeDb();
    const benchId = await seedExercise(db, 'Bench Press');
    await createCompletedSession(db, {
      endedAt: T,
      definition: BENCH_DEF(benchId),
      logs: [{ weightGrams: 50_000, reps: 10 }],
    });
    await createCompletedSession(db, {
      endedAt: T + 86_400_000,
      definition: BENCH_DEF(benchId),
      logs: [{ weightGrams: 50_000, reps: 12 }],
    });
    // Bar 45kg fixed + one 5kg pair → 55kg reachable above the 50kg target.
    await seedInventory(db, [
      { name: 'Bar', weightGrams: 45_000, quantity: 1 },
      { name: '5kg plates', weightGrams: 5_000, quantity: 2, perSide: true },
    ]);

    const prog = await loadProgressionSnapshot(db);
    const overview = summarizeProgression(prog, Date.now());
    const entry = overview.progress[0];
    expect(entry).toBeDefined();
    expect(entry!.evidence.suggestedWeightGrams).toBe(55_000);
    expect(entry!.evidence.weightIncrementSource).toBe('equipment_inventory');
  });

  it('classifies in-range work as maintain and honors identity gates', async () => {
    const db = makeDb();
    const benchId = await seedExercise(db, 'Bench Press');
    await createCompletedSession(db, {
      endedAt: T,
      definition: BENCH_DEF(benchId),
      logs: [{ weightGrams: 50_000, reps: 10 }],
    });
    await createCompletedSession(db, {
      endedAt: T + 86_400_000,
      definition: BENCH_DEF(benchId),
      logs: [{ weightGrams: 50_000, reps: 10 }],
    });
    const prog = await loadProgressionSnapshot(db);
    const overview = summarizeProgression(prog, Date.now());
    expect(overview.maintain).toHaveLength(1);
    expect(overview.maintain[0].evidence.reason).toBe('REPS_IN_RANGE');
  });

  it('returns an empty overview with no completed sessions', async () => {
    const db = makeDb();
    await seedExercise(db, 'Bench Press');
    const prog = await loadProgressionSnapshot(db);
    const overview = summarizeProgression(prog, Date.now());
    expect(overview.analyzedCount).toBe(0);
    expect(overview.progress).toHaveLength(0);
  });
});

describe('analyzeStepEvidence (HistoryDetail / post-workout path)', () => {
  it('returns null for steps without an analyzable prescription', async () => {
    const db = makeDb();
    const prog = await loadProgressionSnapshot(db);
    expect(
      analyzeStepEvidence(prog, {
        exerciseName: 'Bench Press',
        exerciseId: 'any-exercise-id',
        prescription: {
          targetRepsMin: null,
          targetRepsMax: null,
          targetWeightGrams: null,
          targetRir: null,
          tempo: null,
        },
      }, Date.now()),
    ).toBeNull();
  });

  it('compares the step prescription against comparable history', async () => {
    const db = makeDb();
    const benchId = await seedExercise(db, 'Bench Press');
    await createCompletedSession(db, {
      endedAt: T,
      definition: BENCH_DEF(benchId),
      logs: [{ weightGrams: 50_000, reps: 10 }],
    });
    await createCompletedSession(db, {
      endedAt: T + 86_400_000,
      definition: BENCH_DEF(benchId),
      logs: [{ weightGrams: 50_000, reps: 12 }],
    });
    const prog = await loadProgressionSnapshot(db);
    const stepPresc = [...prog.historicalPrescriptions.values()][0].prescription;
    const evidence = analyzeStepEvidence(
      prog,
      {
        exerciseName: 'Bench Press',
        exerciseId: benchId,
        prescription: stepPresc,
      },
      Date.now(),
    );
    expect(evidence).not.toBeNull();
    expect(evidence!.state).toBe('progress');
    expect(evidence!.comparability?.identityMatch).toBe('seed_id');
  });
});

describe('progressionInputFor (contract hygiene)', () => {
  it('keeps engine input pure: no model rows, integer units only', async () => {
    const db = makeDb();
    const benchId = await seedExercise(db, 'Bench Press');
    const prog = await loadProgressionSnapshot(db);
    const input = progressionInputFor(
      prog,
      'Bench Press',
      benchId,
      {
        targetRepsMin: 8,
        targetRepsMax: 12,
        targetWeightGrams: 50_000,
        targetRir: 2,
        tempo: null,
      },
      'barbell',
      Date.now(),
    );
    expect(input.historicalPrescriptions).toBe(prog.historicalPrescriptions);
    expect(input.achievableNextWeightGrams).toBeUndefined();
    expect(Number.isSafeInteger(input.now)).toBe(true);
  });
});

describe('summarizeTrends (DB → trend/plateau signals, Phase 3D)', () => {
  it('keeps evidence below the sample gate out of the signals list', async () => {
    const db = makeDb();
    const benchId = await seedExercise(db, 'Bench Press');
    await createCompletedSession(db, {
      endedAt: T,
      definition: BENCH_DEF(benchId),
      logs: [{ weightGrams: 50_000, reps: 10 }],
    });
    await createCompletedSession(db, {
      endedAt: T + 86_400_000,
      definition: BENCH_DEF(benchId),
      logs: [{ weightGrams: 50_000, reps: 10 }],
    });
    const overview = summarizeTrends(await loadProgressionSnapshot(db));
    expect(overview.analyzedCount).toBe(1);
    expect(overview.entries).toHaveLength(1);
    expect(overview.entries[0].evidence.status).toBe('insufficient_data');
    expect(overview.entries[0].evidence.plateau).toBe(false);
    expect(overview.signals).toHaveLength(0);
  });

  it('emits a plateau signal only after four comparable sessions', async () => {
    const db = makeDb();
    const benchId = await seedExercise(db, 'Bench Press');
    for (let i = 0; i < 4; i += 1) {
      await createCompletedSession(db, {
        endedAt: T + i * 86_400_000,
        definition: BENCH_DEF(benchId),
        logs: [{ weightGrams: 50_000, reps: 10 }],
      });
    }
    const overview = summarizeTrends(await loadProgressionSnapshot(db));
    expect(overview.signals).toHaveLength(1);
    expect(overview.signals[0].exercise.name).toBe('Bench Press');
    expect(overview.signals[0].evidence.status).toBe('stable');
    expect(overview.signals[0].evidence.plateau).toBe(true);
    expect(overview.signals[0].evidence.sampleCount).toBe(4);
  });

  it('returns an empty overview with no completed sessions', async () => {
    const db = makeDb();
    await seedExercise(db, 'Bench Press');
    const overview = summarizeTrends(await loadProgressionSnapshot(db));
    expect(overview.analyzedCount).toBe(0);
    expect(overview.signals).toHaveLength(0);
  });
});
