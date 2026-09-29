/**
 * Mandatory volume audit — docs/VOLUME_AUDIT.md (§18).
 *
 * Audit ground truth: 3 sets × 40 kg × 5 reps = 600 kg·reps external-load
 * volume (600_000 gram-reps in storage units).
 *
 * Proves:
 *  - performed volume is weight × reps only — RIR never enters or inflates it,
 *  - prescribed volume (3 × 40 × 5–8) is never computed or mixed with
 *    performed volume (performed 5+6+8 reps = 760 kg·reps, never 960),
 *  - unit conservation: set sums = exercise sums = session sums =
 *    date-range/window/weekly sums for a multi-exercise, multi-session fixture,
 *  - muscle allocation conserves integer load (parts sum to the source load;
 *    mapped + unmapped = total; region shares sum to exactly 10000 bp),
 *  - edge matrix: one set, variable reps/weight, empty/timed sets, bodyweight
 *    (no equipment → hasResistance false), large values (integer math),
 *    week-boundary windows, month-boundary history, dashboard empty/single,
 *  - display converts gram-reps → kg·reps exactly once (600, never 0.6).
 */
import fs from 'fs';
import path from 'path';
import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import { schema } from '../data/schema';
import { migrations } from '../data/migrations';
import { modelClasses } from '../data/models';
import { loadDashboard } from '../data/dashboard';
import {
  calculateSetLoad,
  calculateExerciseLoad,
  calculateSessionLoad,
  calculateDateRangeLoad,
  dateRange,
  startOfLocalDay,
  gramRepsToKgReps,
  type DateRange,
  type DatedSession,
  type SetLoadInput,
} from './load';
import { currentWindow, previousWindow, calculateWindowTotals } from './trends';
import { rollingSummary, weeklySeries } from './athlete';
import { compareSessions } from './compare';
import {
  calculateMuscleHeatmap,
  distributeBasisPoints,
  TOTAL_BASIS_POINTS,
  type Contributions,
  type MuscleSessionInput,
} from './muscles';

const set = (partial: Partial<SetLoadInput>): SetLoadInput => ({
  weightGrams: null,
  reps: null,
  durationMs: null,
  isCompleted: true,
  ...partial,
});

/** RIR-bearing set row (as persisted in set_logs.rir) — must never affect load. */
type SetWithRir = SetLoadInput & { rir: number | null };
const rirSet = (partial: Partial<SetWithRir>): SetWithRir => ({
  weightGrams: null,
  reps: null,
  durationMs: null,
  isCompleted: true,
  rir: null,
  ...partial,
});

/** Fixed audit clock: 2026-09-24 15:00 local. */
const NOW = new Date(2026, 8, 24, 15, 0, 0).getTime();
const NOON_TODAY = startOfLocalDay(NOW) + 12 * 3_600_000;
const DAY_WINDOW: DateRange = {
  startMs: startOfLocalDay(NOON_TODAY),
  endMs: startOfLocalDay(NOON_TODAY) + 86_400_000,
  kind: 'today',
};

function scenarioSession(sets: SetLoadInput[], timestampMs = NOON_TODAY, id = 'scenario'): DatedSession {
  return {
    sessionId: id,
    name: 'Scenario',
    timestampMs,
    startedAt: timestampMs - 3_600_000,
    endedAt: timestampMs,
    exercises: [{ exerciseName: 'Bench Press', sets }],
  };
}

const scenarioSets = (): SetLoadInput[] => [
  set({ weightGrams: 40_000, reps: 5 }),
  set({ weightGrams: 40_000, reps: 5 }),
  set({ weightGrams: 40_000, reps: 5 }),
];

const scenarioRirSets = (): SetWithRir[] => [
  rirSet({ weightGrams: 40_000, reps: 5, rir: 2 }),
  rirSet({ weightGrams: 40_000, reps: 5, rir: 2 }),
  rirSet({ weightGrams: 40_000, reps: 5, rir: 2 }),
];

const KG_PER_SET = 200_000; // 40 kg × 5 reps in gram-reps
const KG_SCENARIO = 600_000; // 3 × 40 kg × 5 reps in gram-reps
const RIR_INFLATED_BY_ADDING = 840_000; // weight × (reps + RIR) × 3 = 40 × 7 × 3 kg
const RIR_INFLATED_BY_MULTIPLYING = 1_200_000; // weight × reps × RIR × 3 = 40 × 5 × 2 × 3 kg

function localNoon(daysAgo: number): number {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d.getTime();
}

describe('ground truth: 3 sets × 40 kg × 5 reps = 600 kg·reps', () => {
  it('one set: weight × reps = 200_000 gram-reps, completed only', () => {
    const load = calculateSetLoad(set({ weightGrams: 40_000, reps: 5 }));
    expect(load.resistanceGramReps).toBe(KG_PER_SET);
    expect(load.hasResistance).toBe(true);
    expect(load.durationMs).toBe(0);
  });

  it('exercise and session aggregation of the 3-set scenario = 600_000 gram-reps → 600 kg·reps', () => {
    const exercise = calculateExerciseLoad('Bench Press', scenarioSets());
    expect(exercise.resistanceGramReps).toBe(KG_SCENARIO);
    expect(exercise.resistanceSetCount).toBe(3);

    const session = calculateSessionLoad({
      sessionId: 'gt',
      name: 'Scenario',
      startedAt: NOON_TODAY - 3_600_000,
      endedAt: NOON_TODAY,
      exercises: [{ exerciseName: 'Bench Press', sets: scenarioSets() }],
    });
    expect(session.resistanceGramReps).toBe(KG_SCENARIO);
    expect(gramRepsToKgReps(session.resistanceGramReps)).toBe(600);
  });

  it('RIR 2 on each set: set/exercise/session volume stays exactly 600_000', () => {
    const sets = scenarioRirSets();
    for (const s of sets) expect(calculateSetLoad(s).resistanceGramReps).toBe(KG_PER_SET);

    const exercise = calculateExerciseLoad('Bench Press', sets);
    expect(exercise.resistanceGramReps).toBe(KG_SCENARIO);

    const session = calculateSessionLoad({
      sessionId: 'gt-rir',
      name: 'Scenario',
      startedAt: NOON_TODAY - 3_600_000,
      endedAt: NOON_TODAY,
      exercises: [{ exerciseName: 'Bench Press', sets }],
    });
    expect(session.resistanceGramReps).toBe(KG_SCENARIO);
    expect(session.resistanceGramReps).not.toBe(RIR_INFLATED_BY_ADDING);
    expect(session.resistanceGramReps).not.toBe(RIR_INFLATED_BY_MULTIPLYING);
  });

  it('RIR 2 on each set: date-range, window and rolling totals stay exactly 600_000', () => {
    const sessions = [scenarioSession(scenarioRirSets())];
    const inRange = calculateDateRangeLoad(sessions, dateRange('today', NOW));
    const inWindow = calculateWindowTotals(sessions, currentWindow(NOW, 7));
    const rolling = rollingSummary(sessions, NOW, 7);
    expect(inRange.resistanceGramReps).toBe(KG_SCENARIO);
    expect(inWindow.resistanceGramReps).toBe(KG_SCENARIO);
    expect(rolling.resistanceGramReps).toBe(KG_SCENARIO);
    for (const value of [
      inRange.resistanceGramReps,
      inWindow.resistanceGramReps,
      rolling.resistanceGramReps,
    ]) {
      expect(value).not.toBe(RIR_INFLATED_BY_ADDING);
      expect(value).not.toBe(RIR_INFLATED_BY_MULTIPLYING);
    }
  });
});

describe('reject patterns: RIR never inflates volume', () => {
  it('no RIR-aware result equals weight×reps×RIR or weight×(reps+RIR) across load/trends/athlete/compare', () => {
    const baseline = scenarioSession(scenarioSets(), NOON_TODAY - 86_400_000, 'baseline');
    const current = scenarioSession(scenarioRirSets(), NOON_TODAY, 'current');

    const rejected = new Set<number>([
      calculateSessionLoad({
        sessionId: 'c',
        name: 'C',
        startedAt: current.startedAt,
        endedAt: current.endedAt,
        exercises: current.exercises.map((e) => ({ exerciseName: e.exerciseName, sets: e.sets })),
      }).resistanceGramReps,
      calculateDateRangeLoad([current], dateRange('7d', NOW)).resistanceGramReps,
      calculateWindowTotals([current], currentWindow(NOW, 7)).resistanceGramReps,
      rollingSummary([current], NOW, 7).resistanceGramReps,
      compareSessions(baseline, current).volume.current,
      calculateExerciseLoad('Bench Press', scenarioRirSets()).resistanceGramReps,
      calculateSetLoad(scenarioRirSets()[0]).resistanceGramReps * 3,
    ]);

    for (const value of rejected) {
      expect(value).toBe(KG_SCENARIO);
      expect(value).not.toBe(RIR_INFLATED_BY_ADDING);
      expect(value).not.toBe(RIR_INFLATED_BY_MULTIPLYING);
    }
    // Per-set basis: neither inflated formula matches a single set either.
    const perSet = calculateSetLoad(scenarioRirSets()[0]).resistanceGramReps;
    expect(perSet).toBe(KG_PER_SET);
    expect(perSet).not.toBe(40_000 * (5 + 2));
    expect(perSet).not.toBe(40_000 * 5 * 2);
  });

  it('muscle heatmap of an RIR-bearing session totals 600_000 gram-reps', () => {
    const session: MuscleSessionInput = {
      sessionId: 'm1',
      name: 'Scenario',
      timestampMs: NOON_TODAY,
      startedAt: NOON_TODAY - 3_600_000,
      endedAt: NOON_TODAY,
      exercises: [
        {
          exerciseName: 'Bench Press',
          contributions: [['chest', 6000], ['triceps', 2500], ['front_delts', 1500]],
          sets: scenarioRirSets(),
        },
      ],
    };
    const heatmap = calculateMuscleHeatmap([session], DAY_WINDOW);
    expect(heatmap.totalResistanceGramReps).toBe(KG_SCENARIO);
    expect(heatmap.mappedResistanceGramReps).toBe(KG_SCENARIO);
    expect(heatmap.totalResistanceGramReps).not.toBe(RIR_INFLATED_BY_ADDING);
    expect(heatmap.totalResistanceGramReps).not.toBe(RIR_INFLATED_BY_MULTIPLYING);
    const regionSum = heatmap.regions.reduce((acc, r) => acc + r.resistanceGramReps, 0);
    expect(regionSum).toBe(KG_SCENARIO);
  });

  it('SetLoadInput rows carry no rir field and load output exposes none', () => {
    const row = set({ weightGrams: 40_000, reps: 5 });
    expect(Object.keys(row)).not.toContain('rir');
    const load = calculateSetLoad(row);
    expect('rir' in load).toBe(false);
    expect(Object.keys(load).sort()).toEqual(
      ['durationMs', 'hasDuration', 'hasResistance', 'resistanceGramReps'].sort(),
    );
  });
});

describe('prescribed vs performed volume', () => {
  const ACTUAL_REPS = [5, 6, 8];
  const PRESCRIBED_MAX_KG = 40_000 * 8 * 3; // 3 × 40 kg × 8 = 960_000 phantom volume

  it('performed volume uses actual reps 5+6+8 → 760_000 gram-reps, never prescribed 960_000', () => {
    const actualSets = ACTUAL_REPS.map((reps) => set({ weightGrams: 40_000, reps }));
    const performed = calculateExerciseLoad('Squat', actualSets);
    expect(performed.resistanceGramReps).toBe(40_000 * 19);
    expect(performed.resistanceGramReps).toBe(760_000);
    expect(performed.resistanceGramReps).not.toBe(PRESCRIBED_MAX_KG);
    expect(gramRepsToKgReps(performed.resistanceGramReps)).toBe(760);

    const session = calculateSessionLoad({
      sessionId: 'prescribed',
      name: 'Prescribed vs actual',
      startedAt: NOON_TODAY - 3_600_000,
      endedAt: NOON_TODAY,
      exercises: [{ exerciseName: 'Squat', sets: actualSets }],
    });
    expect(session.resistanceGramReps).toBe(760_000);
    expect(session.resistanceGramReps).not.toBe(PRESCRIBED_MAX_KG);
  });

  it('source scan: volume modules consume no prescription fields and no prescribed-volume function exists', () => {
    const volumeModules = [
      'load.ts',
      'trends.ts',
      'athlete.ts',
      'compare.ts',
      'muscles.ts',
      'records.ts',
    ].map((name) => path.join(__dirname, name));
    volumeModules.push(path.join(__dirname, '..', 'data', 'dashboard.ts'));

    // RIR in comments is documentation (e.g. "actual RIR as logged — null stays
    // null"), not a prescription input; 1.1.0 surfaces actual RIR as an OUTPUT.
    const commentFree = (src: string): string => src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
    const prescriptionInputs = /prescri|\brir\b|targetReps|targetSets|targetWeight/i;
    for (const file of volumeModules) {
      const src = commentFree(fs.readFileSync(file, 'utf8'));
      expect(prescriptionInputs.test(src)).toBe(false);
    }

    // Positive control: the scanner does detect prescription language where it exists.
    const autoreg = fs.readFileSync(path.join(__dirname, 'autoregulation.ts'), 'utf8');
    expect(/prescri/i.test(autoreg)).toBe(true);

    // No prescribed/planned volume computation anywhere in src (N/A — does not exist).
    const forbidden = /prescribedVolume|plannedVolume|targetVolume|prescriptionVolume|prescri\w*\s+volume/i;
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.includes('.test.')) {
          if (forbidden.test(fs.readFileSync(full, 'utf8'))) offenders.push(full);
        }
      }
    };
    walk(path.join(__dirname, '..'));
    expect(offenders).toEqual([]);
  });
});

describe('unit conservation across aggregation levels', () => {
  // Session A (2026-09-20): Back Squat 100×5, 100×5, 90×6 + 1 incomplete;
  // Bench Press 60×8, 55×10 + one duration-only set.
  const T_A = new Date(2026, 8, 20, 12, 0, 0).getTime();
  const T_B = new Date(2026, 8, 14, 12, 0, 0).getTime();

  const squatA: SetLoadInput[] = [
    set({ weightGrams: 100_000, reps: 5 }),
    set({ weightGrams: 100_000, reps: 5 }),
    set({ weightGrams: 90_000, reps: 6 }),
    set({ weightGrams: 100_000, reps: 5, isCompleted: false }),
  ];
  const benchA: SetLoadInput[] = [
    set({ weightGrams: 60_000, reps: 8 }),
    set({ weightGrams: 55_000, reps: 10 }),
    set({ durationMs: 60_000 }),
  ];
  const squatB: SetLoadInput[] = [set({ weightGrams: 100_000, reps: 8 }), set({ weightGrams: 80_000, reps: 8 })];
  const rowB: SetLoadInput[] = [
    set({ weightGrams: 40_000, reps: 10 }),
    set({ weightGrams: 45_000, reps: 8 }),
    set({ weightGrams: 45_000, reps: 10 }),
  ];

  const sessionA: DatedSession = {
    sessionId: 'sess-a',
    name: 'Day A',
    timestampMs: T_A,
    startedAt: T_A - 3_600_000,
    endedAt: T_A,
    exercises: [
      { exerciseName: 'Back Squat', sets: squatA },
      { exerciseName: 'Bench Press', sets: benchA },
    ],
  };
  const sessionB: DatedSession = {
    sessionId: 'sess-b',
    name: 'Day B',
    timestampMs: T_B,
    startedAt: T_B - 3_600_000,
    endedAt: T_B,
    exercises: [
      { exerciseName: 'Back Squat', sets: squatB },
      { exerciseName: 'Bench Row', sets: rowB },
    ],
  };
  const sessions = [sessionA, sessionB];

  const A_RESISTANCE = 500_000 + 500_000 + 540_000 + 480_000 + 550_000; // 2_570_000
  const B_RESISTANCE = 800_000 + 640_000 + 400_000 + 360_000 + 450_000; // 2_650_000
  const TOTAL = A_RESISTANCE + B_RESISTANCE; // 5_220_000

  const toSessionLoad = (s: DatedSession) =>
    calculateSessionLoad({
      sessionId: s.sessionId,
      name: s.name,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      exercises: s.exercises.map((e) => ({ exerciseName: e.exerciseName, sets: e.sets })),
    });

  it('session A: set sums = exercise sums = session sum, categories stay separate', () => {
    const setSum = sessionA.exercises
      .flatMap((e) => e.sets)
      .reduce((acc, s) => acc + calculateSetLoad(s).resistanceGramReps, 0);
    expect(setSum).toBe(A_RESISTANCE);

    const load = toSessionLoad(sessionA);
    expect(load.resistanceGramReps).toBe(A_RESISTANCE);
    expect(load.exerciseLoads.reduce((acc, e) => acc + e.resistanceGramReps, 0)).toBe(
      load.resistanceGramReps,
    );
    expect(load.exerciseLoads.find((e) => e.exerciseName === 'Back Squat')?.resistanceGramReps).toBe(
      1_540_000,
    );
    expect(load.exerciseLoads.find((e) => e.exerciseName === 'Bench Press')?.resistanceGramReps).toBe(
      1_030_000,
    );
    // Duration and set categories conserved separately; incomplete set excluded.
    expect(load.durationMs).toBe(60_000);
    expect(load.resistanceSetCount).toBe(5);
    expect(load.durationSetCount).toBe(1);
    expect(load.completedSetCount).toBe(6);
  });

  it('session B: set sums = exercise sums = session sum', () => {
    const setSum = sessionB.exercises
      .flatMap((e) => e.sets)
      .reduce((acc, s) => acc + calculateSetLoad(s).resistanceGramReps, 0);
    expect(setSum).toBe(B_RESISTANCE);

    const load = toSessionLoad(sessionB);
    expect(load.resistanceGramReps).toBe(B_RESISTANCE);
    expect(load.exerciseLoads.reduce((acc, e) => acc + e.resistanceGramReps, 0)).toBe(
      load.resistanceGramReps,
    );
    expect(load.completedSetCount).toBe(5);
    expect(load.durationMs).toBe(0);
  });

  it('Σ sessions = date-range sum = 28d window sum = rollingSummary sum', () => {
    const sessionSum = sessions.reduce((acc, s) => acc + toSessionLoad(s).resistanceGramReps, 0);
    expect(sessionSum).toBe(TOTAL);

    const inRange = calculateDateRangeLoad(sessions, dateRange('28d', NOW));
    const inWindow = calculateWindowTotals(sessions, currentWindow(NOW, 28));
    const rolling = rollingSummary(sessions, NOW, 28);
    expect(inRange.resistanceGramReps).toBe(TOTAL);
    expect(inWindow.resistanceGramReps).toBe(TOTAL);
    expect(rolling.resistanceGramReps).toBe(TOTAL);
    expect(inRange.resistanceSetCount).toBe(10);
    expect(inRange.durationMs).toBe(60_000);
  });

  it('adjacent 7d windows split the sessions with no overlap and no loss; weeklySeries buckets sum to the total', () => {
    const current7 = calculateWindowTotals(sessions, currentWindow(NOW, 7));
    const previous7 = calculateWindowTotals(sessions, previousWindow(NOW, 7));
    expect(current7.sessionCount).toBe(1); // A (Sep 20)
    expect(previous7.sessionCount).toBe(1); // B (Sep 14)
    expect(current7.resistanceGramReps).toBe(A_RESISTANCE);
    expect(previous7.resistanceGramReps).toBe(B_RESISTANCE);
    expect(current7.resistanceGramReps + previous7.resistanceGramReps).toBe(TOTAL);
    expect(previousWindow(NOW, 7).endMs).toBe(currentWindow(NOW, 7).startMs);

    const points = weeklySeries(sessions, NOW, 4);
    expect(points).toHaveLength(4);
    expect(points.reduce((acc, p) => acc + p.resistanceGramReps, 0)).toBe(TOTAL);
    expect(points[3].resistanceGramReps).toBe(A_RESISTANCE); // current week bucket (newest)
    expect(points[2].resistanceGramReps).toBe(B_RESISTANCE); // previous week bucket
    expect(points[0].resistanceGramReps + points[1].resistanceGramReps).toBe(0);
  });

  it('compareSessions volume equals the per-session loads and per-exercise sides conserved', () => {
    const comparison = compareSessions(sessionB, sessionA); // baseline older, current newer
    expect(comparison.volume.current).toBe(A_RESISTANCE);
    expect(comparison.volume.previous).toBe(B_RESISTANCE);
    expect(comparison.volume.delta).toBe(A_RESISTANCE - B_RESISTANCE);

    const sumExercises = comparison.exercises.reduce(
      (acc, ex) => acc + ex.current.resistanceGramReps,
      0,
    );
    expect(sumExercises).toBe(A_RESISTANCE);
    const byName = new Map(comparison.exercises.map((ex) => [ex.exerciseName, ex]));
    expect(byName.get('Back Squat')?.present).toBe('both');
    expect(byName.get('Bench Press')?.present).toBe('current');
    expect(byName.get('Bench Row')?.present).toBe('baseline');
    expect(byName.get('Back Squat')?.current.resistanceGramReps).toBe(1_540_000);
    expect(byName.get('Back Squat')?.baseline.resistanceGramReps).toBe(1_440_000);
  });

  it('muscle heatmap total equals window totals; mapped + unmapped = total; region shares sum to exactly 10000 bp', () => {
    const SQUAT: Contributions = [['quads', 6000], ['glutes', 2500], ['lower_back', 1500]];
    const BENCH: Contributions = [['chest', 6000], ['triceps', 2500], ['front_delts', 1500]];
    const muscleSessions: MuscleSessionInput[] = [
      {
        sessionId: 'sess-a',
        name: 'Day A',
        timestampMs: T_A,
        startedAt: sessionA.startedAt,
        endedAt: sessionA.endedAt,
        exercises: [
          { exerciseName: 'Back Squat', contributions: SQUAT, sets: squatA },
          { exerciseName: 'Bench Press', contributions: BENCH, sets: benchA },
        ],
      },
      {
        sessionId: 'sess-b',
        name: 'Day B',
        timestampMs: T_B,
        startedAt: sessionB.startedAt,
        endedAt: sessionB.endedAt,
        exercises: [
          { exerciseName: 'Back Squat', contributions: SQUAT, sets: squatB },
          { exerciseName: 'Mystery Row', contributions: null, sets: rowB },
        ],
      },
    ];
    const range = { startMs: new Date(2026, 7, 1).getTime(), endMs: new Date(2026, 9, 1).getTime() };
    const heatmap = calculateMuscleHeatmap(muscleSessions, range);

    // Cross-module conservation: heatmap sees exactly what windows see.
    expect(heatmap.totalResistanceGramReps).toBe(TOTAL);
    expect(heatmap.totalResistanceGramReps).toBe(
      calculateWindowTotals(sessions, currentWindow(NOW, 28)).resistanceGramReps,
    );

    expect(heatmap.mappedResistanceGramReps + heatmap.unmappedResistanceGramReps).toBe(TOTAL);
    expect(heatmap.mappedResistanceGramReps).toBe(1_540_000 + 1_030_000 + 1_440_000);
    expect(heatmap.unmappedResistanceGramReps).toBe(1_210_000);

    const regionSum = heatmap.regions.reduce((acc, r) => acc + r.resistanceGramReps, 0);
    expect(regionSum).toBe(heatmap.mappedResistanceGramReps);
    const shareSum = heatmap.regions.reduce((acc, r) => acc + r.shareBp, 0);
    expect(shareSum).toBe(TOTAL_BASIS_POINTS);

    // Per-region exercise detail conserves the region load (incl. cross-session merge).
    const quads = heatmap.regions.find((r) => r.muscle === 'quads');
    expect(quads?.resistanceGramReps).toBe(
      Math.round(0.6 * 1_540_000) + Math.round(0.6 * 1_440_000),
    );
    expect(quads?.exercises.reduce((acc, e) => acc + e.resistanceGramReps, 0)).toBe(
      quads?.resistanceGramReps,
    );
    const unmappedSum = heatmap.unmappedExercises.reduce((acc, e) => acc + e.resistanceGramReps, 0);
    expect(unmappedSum).toBe(heatmap.unmappedResistanceGramReps);
  });
});

describe('muscle allocation conservation', () => {
  const BENCH: Contributions = [['chest', 6000], ['triceps', 2500], ['front_delts', 1500]];

  it('distributeBasisPoints parts sum exactly to the source load (scenario: 600_000)', () => {
    const parts = distributeBasisPoints(KG_SCENARIO, BENCH);
    const sum = Object.values(parts).reduce((a, b) => a + b, 0);
    expect(sum).toBe(KG_SCENARIO);
    expect(parts.chest).toBe(360_000);
    expect(parts.triceps).toBe(150_000);
    expect(parts.front_delts).toBe(90_000);
  });

  it('distributeBasisPoints conserves awkward integer remainders', () => {
    for (const total of [1, 599_999, 600_001, 100_000_003]) {
      const parts = distributeBasisPoints(total, BENCH);
      const sum = Object.values(parts).reduce((a, b) => a + b, 0);
      expect(sum).toBe(total);
    }
  });

  it('timed-only and bodyweight-only steps contribute zero volume to the heatmap', () => {
    const session: MuscleSessionInput = {
      sessionId: 'edge',
      name: 'Edge',
      timestampMs: NOON_TODAY,
      startedAt: NOON_TODAY - 3_600_000,
      endedAt: NOON_TODAY,
      exercises: [
        {
          exerciseName: 'Plank',
          contributions: [['abs', 10_000]],
          sets: [set({ durationMs: 60_000 })],
        },
        {
          exerciseName: 'Push-up',
          contributions: [['chest', 10_000]],
          sets: [set({ weightGrams: null, reps: 15 })],
        },
      ],
    };
    const heatmap = calculateMuscleHeatmap([session], DAY_WINDOW);
    expect(heatmap.totalResistanceGramReps).toBe(0);
    expect(heatmap.totalExerciseCount).toBe(0);
    expect(heatmap.regions).toHaveLength(0);
    expect(heatmap.unmappedExercises).toHaveLength(0);
  });
});

describe('edge matrix', () => {
  it('a single set contributes exactly its own load', () => {
    const single = calculateSessionLoad({
      sessionId: 'one',
      name: 'One set',
      startedAt: NOON_TODAY - 60_000,
      endedAt: NOON_TODAY,
      exercises: [{ exerciseName: 'Squat', sets: [set({ weightGrams: 40_000, reps: 5 })] }],
    });
    expect(single.resistanceGramReps).toBe(KG_PER_SET);
    expect(single.resistanceSetCount).toBe(1);
    expect(gramRepsToKgReps(single.resistanceGramReps)).toBe(200);
  });

  it('variable reps and variable weight sum exactly', () => {
    const sets = [
      set({ weightGrams: 40_000, reps: 5 }),
      set({ weightGrams: 42_000, reps: 7 }),
      set({ weightGrams: 38_000, reps: 8 }),
    ];
    const load = calculateExerciseLoad('Variable', sets);
    expect(load.resistanceGramReps).toBe(200_000 + 294_000 + 304_000);
    expect(load.resistanceGramReps).toBe(798_000);
    expect(gramRepsToKgReps(load.resistanceGramReps)).toBe(798);
  });

  it('empty and duration-only inputs never fabricate tonnage', () => {
    const empty = calculateExerciseLoad('Empty', []);
    expect(empty.resistanceGramReps).toBe(0);
    expect(empty.completedSetCount).toBe(0);

    const timed = calculateExerciseLoad('Plank', [
      set({ durationMs: 45_000 }),
      set({ durationMs: 45_000 }),
    ]);
    expect(timed.resistanceGramReps).toBe(0);
    expect(timed.resistanceSetCount).toBe(0);
    expect(timed.durationMs).toBe(90_000);
    expect(timed.durationSetCount).toBe(2);
    expect(timed.completedSetCount).toBe(2);

    const window = calculateWindowTotals(
      [
        {
          sessionId: 'timed',
          name: 'Timed',
          timestampMs: NOON_TODAY,
          startedAt: NOON_TODAY - 60_000,
          endedAt: NOON_TODAY,
          exercises: [{ exerciseName: 'Plank', sets: [set({ durationMs: 60_000 })] }],
        },
      ],
      currentWindow(NOW, 7),
    );
    expect(window.resistanceGramReps).toBe(0);
    expect(window.durationMs).toBe(60_000);
  });

  it('bodyweight / no-equipment sets (weight null or zero) report hasResistance false and zero load', () => {
    expect(calculateSetLoad(set({ weightGrams: null, reps: 12 })).hasResistance).toBe(false);
    expect(calculateSetLoad(set({ weightGrams: null, reps: 12 })).resistanceGramReps).toBe(0);
    expect(calculateSetLoad(set({ weightGrams: 0, reps: 12 })).hasResistance).toBe(false);
    expect(calculateSetLoad(set({ weightGrams: 40_000, reps: null })).hasResistance).toBe(false);
    expect(calculateSetLoad(set({ weightGrams: 40_000, reps: 12, isCompleted: false })).resistanceGramReps).toBe(0);
  });

  it('large values (500 kg × 20 reps × 10 sets) stay exact integers with no overflow', () => {
    const sets = Array.from({ length: 10 }, () => set({ weightGrams: 500_000, reps: 20 }));
    const load = calculateExerciseLoad('Heavy', sets);
    expect(load.resistanceGramReps).toBe(100_000_000);
    expect(Number.isInteger(load.resistanceGramReps)).toBe(true);
    expect(gramRepsToKgReps(load.resistanceGramReps)).toBe(100_000);
    const parts = distributeBasisPoints(100_000_000, [
      ['chest', 5000],
      ['triceps', 3000],
      ['front_delts', 2000],
    ] as Contributions);
    expect(Object.values(parts).reduce((a, b) => a + b, 0)).toBe(100_000_000);
  });

  it('weekly aggregation across the week boundary splits sessions into non-overlapping windows', () => {
    const now = Date.now();
    const sessions = [0, 6, 7, 13].map((daysAgo) => ({
      sessionId: `d${daysAgo}`,
      name: `Session ${daysAgo}`,
      timestampMs: localNoon(daysAgo),
      startedAt: localNoon(daysAgo) - 3_600_000,
      endedAt: localNoon(daysAgo),
      exercises: [{ exerciseName: 'Bench Press', sets: [set({ weightGrams: 40_000, reps: 5 })] }],
    }));

    const current = calculateWindowTotals(sessions, currentWindow(now, 7));
    const previous = calculateWindowTotals(sessions, previousWindow(now, 7));
    expect(previousWindow(now, 7).endMs).toBe(currentWindow(now, 7).startMs);
    expect(current.sessionCount).toBe(2); // today + 6 days ago
    expect(previous.sessionCount).toBe(2); // 7 + 13 days ago
    expect(current.resistanceGramReps).toBe(2 * KG_PER_SET);
    expect(previous.resistanceGramReps).toBe(2 * KG_PER_SET);
    // Every session is counted exactly once across the 14 combined days.
    expect(current.sessionCount + previous.sessionCount).toBe(sessions.length);
  });

  it('historical aggregation across a month boundary: 28d window keeps September, drops August', () => {
    const nowM = new Date(2026, 8, 26, 12, 0, 0).getTime(); // 2026-09-26
    const aug = new Date(2026, 7, 15, 12, 0, 0).getTime(); // 2026-08-15
    const sep = new Date(2026, 8, 20, 12, 0, 0).getTime(); // 2026-09-20
    const sessions = [
      scenarioSession([set({ weightGrams: 100_000, reps: 5 })], aug, 'aug'),
      scenarioSession([set({ weightGrams: 60_000, reps: 5 })], sep, 'sep'),
    ];

    const in28 = calculateDateRangeLoad(sessions, dateRange('28d', nowM));
    expect(in28.resistanceGramReps).toBe(300_000); // September only (window starts Aug 30)

    const wide: DateRange = {
      startMs: new Date(2026, 7, 1).getTime(),
      endMs: new Date(2026, 9, 1).getTime(),
      kind: '28d',
    };
    const inRange = calculateDateRangeLoad(sessions, wide);
    expect(inRange.resistanceGramReps).toBe(800_000);
    expect(inRange.resistanceGramReps).toBe(
      sessions.reduce((acc, s) => acc + calculateSessionLoad({
        sessionId: s.sessionId,
        name: s.name,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        exercises: s.exercises,
      }).resistanceGramReps, 0),
    );

    // 8 weekly buckets span both months and conserve the same total.
    const points = weeklySeries(sessions, nowM, 8);
    expect(points.reduce((acc, p) => acc + p.resistanceGramReps, 0)).toBe(800_000);
  });

  it('dashboard with zero data: seven empty buckets, no fabricated volume', async () => {
    const db = makeDb();
    const d = await loadDashboard(db, NOON);
    expect(d.recent).toEqual([]);
    expect(d.week.resistanceGramReps).toBe(0);
    expect(d.week.sessionCount).toBe(0);
    expect(d.week.completedSetCount).toBe(0);
    expect(d.daily).toHaveLength(7);
    expect(d.daily.every((b) => b.resistanceGramReps === 0 && b.sessionCount === 0)).toBe(true);
  });

  it('dashboard single data point: one session lands in week total and today bucket only', async () => {
    const db = makeDb();
    await createDbSession(db, {
      startedAt: NOON - 3_600_000,
      endedAt: NOON,
      logs: [
        { weightGrams: 40_000, reps: 5 },
        { weightGrams: 40_000, reps: 5 },
        { weightGrams: 40_000, reps: 5 },
      ],
    });

    const d = await loadDashboard(db, NOON);
    expect(d.week.sessionCount).toBe(1);
    expect(d.week.completedSetCount).toBe(3);
    expect(d.week.resistanceGramReps).toBe(KG_SCENARIO);
    expect(d.recent).toHaveLength(1);
    expect(d.recent[0].resistanceGramReps).toBe(KG_SCENARIO);
    expect(d.daily[6].resistanceGramReps).toBe(KG_SCENARIO); // today bucket
    expect(d.daily.slice(0, 6).every((b) => b.resistanceGramReps === 0)).toBe(true);
    expect(d.daily.reduce((acc, b) => acc + b.resistanceGramReps, 0)).toBe(d.week.resistanceGramReps);
  });
});

describe('unit conversion at the display edge', () => {
  it('40000 g × 5 reps × 3 sets converts once to 600 kg·reps, never 0.6', () => {
    const gramReps = 40_000 * 5 * 3;
    expect(gramReps).toBe(600_000);
    expect(gramRepsToKgReps(gramReps)).toBe(600);
    expect(gramRepsToKgReps(gramReps)).not.toBe(0.6);
    // Applying the conversion twice would collapse 600 → 0.6: UI must convert exactly once.
    expect(gramRepsToKgReps(gramRepsToKgReps(gramReps))).toBe(0.6);
    // Round-trip: display value × 1000 returns storage units exactly for integer results.
    expect(gramRepsToKgReps(gramReps) * 1000).toBe(gramReps);
    // Per-set display is consistent with session display.
    expect(gramRepsToKgReps(40_000 * 5)).toBe(200);
    expect(gramRepsToKgReps(gramReps)).toBe(3 * gramRepsToKgReps(40_000 * 5));
  });

  it('documents rollingSummary.avgLoadPerSet denominator: all completed sets (see VOLUME_AUDIT §18.6)', () => {
    const sessions = [
      {
        sessionId: 'mixed',
        name: 'Mixed',
        timestampMs: NOON_TODAY,
        startedAt: NOON_TODAY - 3_600_000,
        endedAt: NOON_TODAY,
        exercises: [
          {
            exerciseName: 'Bench Press',
            sets: [
              set({ weightGrams: 40_000, reps: 5 }),
              set({ weightGrams: 40_000, reps: 5 }),
              set({ weightGrams: 40_000, reps: 5 }),
              set({ durationMs: 60_000 }), // completed but carries no resistance load
            ],
          },
        ],
      },
    ];
    const summary = rollingSummary(sessions, NOW, 7);
    expect(summary.resistanceGramReps).toBe(KG_SCENARIO);
    expect(summary.completedSetCount).toBe(4);
    // Current behavior: denominator = all completed sets (incl. timed), i.e. 600_000 / 4.
    expect(summary.avgLoadPerSetGramReps).toBe(150_000);
    expect(summary.avgLoadPerSetGramReps).not.toBe(Math.round(KG_SCENARIO / 3));
    expect(summary.avgSetsPerSession).toBe(4);
  });
});

/** DB fixture mirroring src/data/dashboard.test.ts (workout_sessions + set_logs rows). */
const DAY = startOfLocalDay(1_700_000_000_000);
const NOON = DAY + 12 * 3_600_000;

function makeDb(): Database {
  const adapter = new LokiJSAdapter({
    dbName: `apexfoss-volume-audit-${Math.random().toString(36).slice(2)}`,
    schema,
    migrations,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
  });
  return new Database({ adapter, modelClasses: modelClasses as any });
}

interface DbSessionOpts {
  startedAt: number;
  endedAt: number | null;
  logs?: Array<{ weightGrams: number | null; reps: number | null; durationMs?: number | null; isCompleted?: number }>;
}

async function createDbSession(db: Database, opts: DbSessionOpts): Promise<string> {
  return db.write(async () => {
    const session = await db.get<any>('workout_sessions').create((rec: any) => {
      rec.routineId = null;
      rec.name = 'Volume audit';
      rec.startedAt = opts.startedAt;
      rec.endedAt = opts.endedAt;
      rec.sessionStatus = 'completed';
      rec.definitionJson = '{"id":"r","name":"Volume audit","blocks":[]}';
      rec.cursorJson = '{"status":"completed","blockIndex":0,"stepIndex":0,"round":1,"setIndex":1}';
      rec.currentBlockIndex = 0;
      rec.currentStepId = null;
      rec.currentRound = 1;
      rec.currentSetIndex = 1;
      rec.timerExpiresAt = null;
      rec.createdAt = opts.startedAt;
      rec.updatedAt = opts.startedAt;
    });
    if (opts.logs && opts.logs.length > 0) {
      const se = await db.get<any>('session_exercises').create((rec: any) => {
        rec.sessionId = session.id;
        rec.exerciseId = null;
        rec.exerciseName = 'Bench Press';
        rec.blockIndex = 0;
        rec.orderIndex = 0;
        rec.createdAt = opts.startedAt;
        rec.updatedAt = opts.startedAt;
      });
      for (const [i, log] of opts.logs.entries()) {
        await db.get<any>('set_logs').create((rec: any) => {
          rec.sessionExerciseId = se.id;
          rec.blockIndex = 0;
          rec.stepIndex = 0;
          rec.round = 1;
          rec.setIndex = i + 1;
          rec.weightGrams = log.weightGrams;
          rec.reps = log.reps;
          rec.durationMs = log.durationMs ?? null;
          rec.distanceMm = null;
          rec.rir = 2;
          rec.isCompleted = log.isCompleted ?? 1;
          rec.completedAt = opts.startedAt;
          rec.createdAt = opts.startedAt;
          rec.updatedAt = opts.startedAt;
        });
      }
    }
    return session.id;
  });
}
