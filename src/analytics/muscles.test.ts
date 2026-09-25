import {
  MUSCLE_GROUPS,
  TOTAL_BASIS_POINTS,
  buildMuscleCatalog,
  calculateMuscleHeatmap,
  distributeBasisPoints,
  isValidContributions,
  muscleRecordKey,
  resolveContributions,
  type Contributions,
  type MuscleSessionInput,
  type MuscleStepInput,
} from './muscles';
import { SEED_EXERCISES } from '../../scripts/seed-exercises';
import { MetricFlag } from '../types';

const BENCH: Contributions = [['chest', 6000], ['triceps', 2500], ['front_delts', 1500]];

function seedCatalog() {
  return buildMuscleCatalog(
    SEED_EXERCISES.map((seed) => ({
      seedId: seed.id,
      name: seed.name,
      category: seed.category,
      equipment: seed.equipment,
      metricFlags: seed.metricFlags,
      contributions: seed.contributions,
    })),
  );
}

const BASE = 1_700_000_000_000;
const RANGE = { startMs: BASE, endMs: BASE + 1000 };

const resSet = (weightGrams: number, reps: number) => ({
  weightGrams,
  reps,
  durationMs: null,
  isCompleted: true,
});

function step(
  exerciseName: string,
  contributions: Contributions | null,
  sets: MuscleStepInput['sets'],
): MuscleStepInput {
  return { exerciseName, contributions, sets };
}

function session(
  sessionId: string,
  timestampMs: number,
  exercises: MuscleStepInput[],
): MuscleSessionInput {
  return {
    sessionId,
    name: `Session ${sessionId}`,
    timestampMs,
    startedAt: timestampMs - 60_000,
    endedAt: timestampMs,
    exercises,
  };
}

describe('muscle vocabulary and mapping tables', () => {
  it('exposes exactly 17 unique muscle groups', () => {
    expect(MUSCLE_GROUPS).toHaveLength(17);
    expect(new Set(MUSCLE_GROUPS).size).toBe(17);
  });

  it('every seeded exercise has a valid contribution map summing to 10000', () => {
    expect(SEED_EXERCISES.length).toBeGreaterThanOrEqual(20);
    for (const seed of SEED_EXERCISES) {
      expect(isValidContributions(seed.contributions)).toBe(true);
      const sum = seed.contributions.reduce((acc, [, bp]) => acc + bp, 0);
      expect(sum).toBe(TOTAL_BASIS_POINTS);
    }
  });

  it('seed exercise ids are unique and deterministic', () => {
    const ids = SEED_EXERCISES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('seed_bench_press');
  });

  it('rejects invalid contribution maps', () => {
    expect(isValidContributions([])).toBe(false);
    expect(isValidContributions([['chest', 5000]])).toBe(false); // does not sum to 10000
    expect(isValidContributions([['chest', 6000], ['triceps', 4000], ['biceps', 1]])).toBe(false);
    expect(isValidContributions([['chest', 6000], ['chest', 4000]])).toBe(false); // duplicate
    expect(isValidContributions([['delts', 10000] as never])).toBe(false); // unknown muscle
    expect(isValidContributions([['chest', 0], ['triceps', 10000]])).toBe(false); // non-positive
  });
});

describe('resolveContributions', () => {
  const catalog = seedCatalog();

  it('resolves by deterministic seed id', () => {
    const result = resolveContributions(catalog, {
      id: 'seed_bench_press',
      name: 'Bench Press',
      category: 'push',
      equipment: 'barbell',
      metricFlags: MetricFlag.WEIGHT | MetricFlag.REPS,
    });
    expect(result).toEqual(BENCH);
  });

  it('keeps identity after a rename when the stable id is present', () => {
    const result = resolveContributions(catalog, {
      id: 'seed_bench_press',
      name: 'Bench Press v2 (renamed)',
      category: 'push',
      equipment: 'barbell',
      metricFlags: MetricFlag.WEIGHT | MetricFlag.REPS,
    });
    expect(result).toEqual(BENCH);
  });

  it('falls back to the exact portable record key for legacy (non-deterministic) ids', () => {
    const result = resolveContributions(catalog, {
      id: 'legacy-random-id-42',
      name: 'Bench Press',
      category: 'push',
      equipment: 'barbell',
      metricFlags: MetricFlag.WEIGHT | MetricFlag.REPS,
    });
    expect(result).toEqual(BENCH);
  });

  it('leaves custom exercises unmapped', () => {
    const result = resolveContributions(catalog, {
      id: 'custom-1',
      name: 'Zercher Squat',
      category: 'legs',
      equipment: 'barbell',
      metricFlags: MetricFlag.WEIGHT | MetricFlag.REPS,
    });
    expect(result).toBeNull();
  });

  it('leaves deleted/unknown exercises unmapped (snapshot name only, no guessing)', () => {
    const result = resolveContributions(catalog, {
      id: null,
      name: 'Bench Press',
      category: '',
      equipment: '',
      metricFlags: 0,
    });
    expect(result).toBeNull();
  });

  it('degrades safely when a legacy row was renamed (no display-name matching)', () => {
    const result = resolveContributions(catalog, {
      id: 'legacy-random-id-42',
      name: 'My Custom Bench Thing',
      category: 'push',
      equipment: 'barbell',
      metricFlags: MetricFlag.WEIGHT | MetricFlag.REPS,
    });
    expect(result).toBeNull();
  });

  it('skips invalid entries when building the catalog', () => {
    const broken = buildMuscleCatalog([
      {
        seedId: 'broken',
        name: 'Broken',
        category: 'x',
        equipment: 'y',
        metricFlags: 1,
        contributions: [['chest', 5000]],
      },
    ]);
    expect(broken.bySeedId.size).toBe(0);
    expect(broken.byRecordKey.size).toBe(0);
  });

  it('record keys are normalized (trim/lowercase/spacing) but exact otherwise', () => {
    expect(muscleRecordKey('  Bench   Press ', 'Push', 'Barbell', 3)).toBe(
      muscleRecordKey('bench press', 'push', 'barbell', 3),
    );
    expect(muscleRecordKey('bench press', 'push', 'barbell', 3)).not.toBe(
      muscleRecordKey('bench press', 'pull', 'barbell', 3),
    );
  });
});

describe('distributeBasisPoints (integer conservation)', () => {
  it('splits bench load exactly by contribution weights', () => {
    const parts = distributeBasisPoints(300_000, BENCH);
    expect(parts.chest).toBe(180_000);
    expect(parts.triceps).toBe(75_000);
    expect(parts.front_delts).toBe(45_000);
    const sum = Object.values(parts).reduce((a, b) => a + b, 0);
    expect(sum).toBe(300_000);
  });

  it('conserves the total for awkward remainders (largest-remainder allocation)', () => {
    const value = 999_997;
    const parts = distributeBasisPoints(value, BENCH);
    const sum = MUSCLE_GROUPS.reduce((acc, muscle) => acc + parts[muscle], 0);
    expect(sum).toBe(value);
    expect(parts.chest).toBeGreaterThanOrEqual(parts.triceps);
  });

  it('conserves totals across a range of loads', () => {
    for (const total of [1, 2, 3, 7, 999, 10_007, 123_457, 1_000_003]) {
      const parts = distributeBasisPoints(total, BENCH);
      const sum = MUSCLE_GROUPS.reduce((acc, muscle) => acc + parts[muscle], 0);
      expect(sum).toBe(total);
    }
  });

  it('returns zeros for zero, negative, NaN and empty inputs', () => {
    expect(Object.values(distributeBasisPoints(0, BENCH)).every((v) => v === 0)).toBe(true);
    expect(Object.values(distributeBasisPoints(-10, BENCH)).every((v) => v === 0)).toBe(true);
    expect(Object.values(distributeBasisPoints(NaN, BENCH)).every((v) => v === 0)).toBe(true);
    expect(Object.values(distributeBasisPoints(1000, [])).every((v) => v === 0)).toBe(true);
  });

  it('gives the full amount to a single contribution', () => {
    const parts = distributeBasisPoints(12_345, [['abs', 10_000]]);
    expect(parts.abs).toBe(12_345);
    expect(MUSCLE_GROUPS.reduce((a, m) => a + parts[m], 0)).toBe(12_345);
  });
});

describe('calculateMuscleHeatmap', () => {
  it('maps a bench session to muscle regions with shares summing to 10000', () => {
    const heatmap = calculateMuscleHeatmap(
      [session('s1', BASE + 10, [step('Bench Press', BENCH, [resSet(60_000, 5)])])],
      RANGE,
    );
    expect(heatmap.sessionCount).toBe(1);
    expect(heatmap.totalResistanceGramReps).toBe(300_000);
    expect(heatmap.mappedResistanceGramReps).toBe(300_000);
    expect(heatmap.unmappedResistanceGramReps).toBe(0);
    expect(heatmap.regions.map((r) => r.muscle)).toEqual(['chest', 'triceps', 'front_delts']);
    const chest = heatmap.regions[0];
    expect(chest.resistanceGramReps).toBe(180_000);
    expect(chest.shareBp).toBe(6000);
    expect(chest.resistanceSetCount).toBe(1);
    expect(chest.exercises).toEqual([
      { exerciseName: 'Bench Press', resistanceGramReps: 180_000, resistanceSetCount: 1 },
    ]);
    const shareSum = heatmap.regions.reduce((acc, r) => acc + r.shareBp, 0);
    expect(shareSum).toBe(TOTAL_BASIS_POINTS);
  });

  it('keeps mapped + unmapped conservation with mixed workouts', () => {
    const heatmap = calculateMuscleHeatmap(
      [
        session('s1', BASE + 10, [
          step('Bench Press', BENCH, [resSet(60_000, 5)]),
          step('Mystery Lift', null, [resSet(40_000, 5)]),
        ]),
      ],
      RANGE,
    );
    expect(heatmap.mappedResistanceGramReps + heatmap.unmappedResistanceGramReps).toBe(
      heatmap.totalResistanceGramReps,
    );
    expect(heatmap.unmappedResistanceGramReps).toBe(200_000);
    expect(heatmap.unmappedExercises).toEqual([
      { exerciseName: 'Mystery Lift', resistanceGramReps: 200_000, resistanceSetCount: 1 },
    ]);
    expect(heatmap.mappedExerciseCount).toBe(1);
    expect(heatmap.totalExerciseCount).toBe(2);
  });

  it('excludes sessions outside the window', () => {
    const heatmap = calculateMuscleHeatmap(
      [
        session('past', BASE - 1, [step('Bench Press', BENCH, [resSet(60_000, 5)])]),
        session('future', BASE + 1000, [step('Bench Press', BENCH, [resSet(60_000, 5)])]),
      ],
      RANGE,
    );
    expect(heatmap.sessionCount).toBe(0);
    expect(heatmap.totalResistanceGramReps).toBe(0);
    expect(heatmap.regions).toHaveLength(0);
  });

  it('excludes timed-only work without converting duration to fake kg', () => {
    const heatmap = calculateMuscleHeatmap(
      [
        session('s1', BASE + 10, [
          step('Plank', [['abs', 10_000]], [
            { weightGrams: null, reps: null, durationMs: 60_000, isCompleted: true },
          ]),
        ]),
      ],
      RANGE,
    );
    expect(heatmap.sessionCount).toBe(1);
    expect(heatmap.totalResistanceGramReps).toBe(0);
    expect(heatmap.totalExerciseCount).toBe(0);
    expect(heatmap.regions).toHaveLength(0);
  });

  it('excludes incomplete and zero-load sets', () => {
    const heatmap = calculateMuscleHeatmap(
      [
        session('s1', BASE + 10, [
          step('Bench Press', BENCH, [
            { weightGrams: 60_000, reps: 5, durationMs: null, isCompleted: false },
            { weightGrams: null, reps: 5, durationMs: null, isCompleted: true },
          ]),
        ]),
      ],
      RANGE,
    );
    expect(heatmap.totalResistanceGramReps).toBe(0);
    expect(heatmap.mappedSetCount).toBe(0);
    expect(heatmap.regions).toHaveLength(0);
  });

  it('returns a safe empty heatmap for no sessions', () => {
    const heatmap = calculateMuscleHeatmap([], RANGE);
    expect(heatmap).toMatchObject({
      sessionCount: 0,
      totalResistanceGramReps: 0,
      mappedResistanceGramReps: 0,
      unmappedResistanceGramReps: 0,
      mappedSetCount: 0,
      unmappedSetCount: 0,
      totalExerciseCount: 0,
      mappedExerciseCount: 0,
    });
    expect(heatmap.regions).toEqual([]);
    expect(heatmap.unmappedExercises).toEqual([]);
  });

  it('attributes sets to every muscle the exercise engages', () => {
    const heatmap = calculateMuscleHeatmap(
      [session('s1', BASE + 10, [step('Bench Press', BENCH, [resSet(60_000, 5), resSet(60_000, 5)])])],
      RANGE,
    );
    expect(heatmap.mappedSetCount).toBe(2);
    for (const region of heatmap.regions) {
      expect(region.resistanceSetCount).toBe(2);
    }
  });

  it('merges the same exercise across sessions inside one region detail', () => {
    const heatmap = calculateMuscleHeatmap(
      [
        session('s1', BASE + 10, [step('Bench Press', BENCH, [resSet(60_000, 5)])]),
        session('s2', BASE + 20, [step('Bench Press', BENCH, [resSet(60_000, 5)])]),
      ],
      RANGE,
    );
    expect(heatmap.sessionCount).toBe(2);
    const chest = heatmap.regions.find((r) => r.muscle === 'chest')!;
    expect(chest.resistanceGramReps).toBe(360_000);
    expect(chest.resistanceSetCount).toBe(2);
    expect(chest.exercises).toEqual([
      { exerciseName: 'Bench Press', resistanceGramReps: 360_000, resistanceSetCount: 2 },
    ]);
  });

  it('sorts regions by load descending', () => {
    const heatmap = calculateMuscleHeatmap(
      [
        session('s1', BASE + 10, [
          step('Hip Thrust', [['glutes', 10_000]], [resSet(100_000, 5)]),
          step('Bench Press', BENCH, [resSet(60_000, 5)]),
        ]),
      ],
      RANGE,
    );
    expect(heatmap.regions.map((r) => r.muscle)).toEqual(['glutes', 'chest', 'triceps', 'front_delts']);
    expect(heatmap.regions[0].resistanceGramReps).toBeGreaterThanOrEqual(
      heatmap.regions[1].resistanceGramReps,
    );
  });

  it('keeps unmapped load visible when no exercise is mapped', () => {
    const heatmap = calculateMuscleHeatmap(
      [session('s1', BASE + 10, [step('Mystery Lift', null, [resSet(50_000, 5)])])],
      RANGE,
    );
    expect(heatmap.totalResistanceGramReps).toBe(250_000);
    expect(heatmap.mappedResistanceGramReps).toBe(0);
    expect(heatmap.unmappedResistanceGramReps).toBe(250_000);
    expect(heatmap.regions).toHaveLength(0);
    expect(heatmap.unmappedExercises).toHaveLength(1);
    const shareSum = heatmap.regions.reduce((acc, r) => acc + r.shareBp, 0);
    expect(shareSum).toBe(0);
  });
});
