import {
  MIN_TREND_SAMPLES,
  describeE1rmTrend,
  e1rmSeries,
  sameExercise,
  type PerformancePoint,
} from './plateau';
import type { DatedSession } from './load';

const T0 = 1_700_000_000_000;
const DAY = 86_400_000;

function points(...e1rms: number[]): PerformancePoint[] {
  return e1rms.map((estimated1rmGrams, i) => ({ timestampMs: T0 + i * DAY, estimated1rmGrams }));
}

function session(
  sessionId: string,
  timestampMs: number,
  exercises: DatedSession['exercises'],
): DatedSession {
  return {
    sessionId,
    name: sessionId,
    timestampMs,
    startedAt: timestampMs,
    endedAt: timestampMs + 1000,
    exercises,
  };
}

const bench = (exerciseId: string | null, exerciseName: string, weightGrams: number, reps: number): DatedSession['exercises'][number] => ({
  exerciseName,
  exerciseId,
  sets: [{ weightGrams, reps, durationMs: null, isCompleted: true }],
});

describe('describeE1rmTrend (Phase 3D)', () => {
  it('never manufactures a plateau from fewer than four sessions', () => {
    const e = describeE1rmTrend(points(100_000, 100_000, 100_000));
    expect(e.status).toBe('insufficient_data');
    expect(e.reason).toBe('INSUFFICIENT_HISTORY');
    expect(e.plateau).toBe(false);
    expect(e.sampleCount).toBe(3);
    expect(MIN_TREND_SAMPLES).toBeGreaterThanOrEqual(4);
  });

  it('reports a plateau only when the best e1RM held steady with enough evidence', () => {
    const e = describeE1rmTrend(points(100_000, 101_000, 100_500, 100_800));
    expect(e.status).toBe('stable');
    expect(e.reason).toBe('E1RM_STABLE');
    expect(e.plateau).toBe(true);
    expect(e.sampleCount).toBe(4);
    expect(e.deltaPct).not.toBeNull();
    expect(Math.abs(e.deltaPct!)).toBeLessThanOrEqual(1);
  });

  it('reports improvement when the recent half is above the baseline', () => {
    const e = describeE1rmTrend(points(100_000, 100_000, 120_000, 120_000));
    expect(e.status).toBe('improving');
    expect(e.reason).toBe('E1RM_INCREASED');
    expect(e.plateau).toBe(false);
    expect(e.deltaPct).toBeGreaterThan(1);
    expect(e.deltaGrams).toBe(20_000);
  });

  it('reports decline descriptively when the recent half is below the baseline', () => {
    const e = describeE1rmTrend(points(120_000, 120_000, 100_000, 100_000));
    expect(e.status).toBe('declining');
    expect(e.reason).toBe('E1RM_DECREASED');
    expect(e.plateau).toBe(false);
    expect(e.deltaPct).toBeLessThan(-1);
  });

  it('treats a change exactly at tolerance as stable', () => {
    // baseline 100kg, recent 101kg → +1.0% (within ±1%).
    const e = describeE1rmTrend(points(100_000, 100_000, 101_000, 101_000));
    expect(e.status).toBe('stable');
    expect(e.plateau).toBe(true);
  });

  it('sorts unsorted input and drops non-positive points', () => {
    const e = describeE1rmTrend([
      { timestampMs: T0 + 3 * DAY, estimated1rmGrams: 100_000 },
      { timestampMs: T0, estimated1rmGrams: 0 },
      { timestampMs: T0 + DAY, estimated1rmGrams: Number.NaN },
      { timestampMs: T0 + 2 * DAY, estimated1rmGrams: 100_000 },
      { timestampMs: T0 + 4 * DAY, estimated1rmGrams: 101_000 },
    ]);
    expect(e.sampleCount).toBe(3);
    expect(e.status).toBe('insufficient_data');
  });

  it('handles a single point without dividing by zero', () => {
    const e = describeE1rmTrend(points(100_000));
    expect(e.status).toBe('insufficient_data');
    expect(e.deltaPct).toBeNull();
    expect(e.recentE1rmGrams).toBe(100_000);
    expect(e.baselineE1rmGrams).toBeNull();
  });

  it('always returns a finite deltaPct (never Infinity/NaN)', () => {
    for (const p of [points(100_000, 100_000, 100_000, 100_000), points(1, 1, 2, 2), points(5, 5, 5, 4)]) {
      const e = describeE1rmTrend(p);
      expect(e.deltaPct === null || Number.isFinite(e.deltaPct)).toBe(true);
    }
  });
});

describe('sameExercise identity (Phase 3D)', () => {
  it('never equates different valid ids even when names match', () => {
    expect(sameExercise({ exerciseName: 'Bench Press', exerciseId: 'a' }, 'b', 'Bench Press')).toBe(false);
    expect(sameExercise({ exerciseName: 'Bench Press', exerciseId: 'a' }, 'a', 'Bench Press')).toBe(true);
  });

  it('falls back to name only when one side lacks an id', () => {
    expect(sameExercise({ exerciseName: 'Bench Press', exerciseId: null }, 'a', 'Bench Press')).toBe(true);
    expect(sameExercise({ exerciseName: 'Bench Press', exerciseId: 'a' }, null, 'Bench Press')).toBe(true);
    expect(sameExercise({ exerciseName: 'Bench Press', exerciseId: 'a' }, null, 'Incline Press')).toBe(false);
  });
});

describe('e1rmSeries (Phase 3D)', () => {
  const sessions: DatedSession[] = [
    session('s1', T0, [bench('ex_bench', 'Bench Press', 60_000, 8)]),
    session('s2', T0 + DAY, [bench('ex_bench', 'Bench Press', 60_000, 9)]),
    // Different exercise id, same name — must be excluded.
    session('s3', T0 + 2 * DAY, [bench('ex_other', 'Bench Press', 200_000, 1)]),
    session('s4', T0 + 3 * DAY, [
      bench('ex_bench', 'Bench Press', 50_000, 5),
      { exerciseName: 'Incline Press', exerciseId: 'ex_incline', sets: [{ weightGrams: 90_000, reps: 3, durationMs: null, isCompleted: true }] },
    ]),
    // Incomplete set only — no point.
    session('s5', T0 + 4 * DAY, [
      { exerciseName: 'Bench Press', exerciseId: 'ex_bench', sets: [{ weightGrams: 70_000, reps: 10, durationMs: null, isCompleted: false }] },
    ]),
  ];

  it('collects per-session best e1RM with id-first identity, oldest first', () => {
    const series = e1rmSeries(sessions, 'ex_bench', 'Bench Press');
    expect(series.map((p) => p.timestampMs)).toEqual([T0, T0 + DAY, T0 + 3 * DAY]);
    // Epley w×(1+reps/30): 60kg×8 → 76kg; 60kg×9 → 78kg; 50kg×5 → 58.333kg.
    expect(series.map((p) => p.estimated1rmGrams)).toEqual([76_000, 78_000, 58_333]);
  });

  it('uses name fallback only when the target has no id', () => {
    const series = e1rmSeries(sessions, null, 'Incline Press');
    expect(series).toHaveLength(1);
    expect(series[0].estimated1rmGrams).toBe(99_000);
  });

  it('excludes a same-name row with a different valid id', () => {
    const series = e1rmSeries(
      [session('x', T0, [bench('ex_other', 'Bench Press', 200_000, 1)])],
      'ex_bench',
      'Bench Press',
    );
    expect(series).toEqual([]);
  });

  it('returns an empty series for no history', () => {
    expect(e1rmSeries([], 'ex_bench', 'Bench Press')).toEqual([]);
  });
});
