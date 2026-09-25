import { prEvents, exercisePrs, prHistory, estimate1rmGrams } from './records';
import type { DatedSession, SetLoadInput } from './load';

const set = (partial: Partial<SetLoadInput>): SetLoadInput => ({
  weightGrams: null,
  reps: null,
  durationMs: null,
  isCompleted: true,
  ...partial,
});

function sessionAt(
  timestampMs: number,
  exercises: Array<{ name: string; sets: SetLoadInput[] }>,
  sessionId = `s-${timestampMs}`,
): DatedSession {
  return {
    sessionId,
    name: 'Session',
    timestampMs,
    startedAt: timestampMs - 60_000,
    endedAt: timestampMs,
    exercises: exercises.map((e) => ({ exerciseName: e.name, sets: e.sets })),
  };
}

describe('estimate1rmGrams (Epley, §12)', () => {
  it('applies weight × (1 + reps ÷ 30) with rounding', () => {
    expect(estimate1rmGrams(100_000, 5)).toBe(116_667);
    expect(estimate1rmGrams(100_000, 1)).toBe(103_333);
    expect(estimate1rmGrams(60_000, 8)).toBe(76_000); // 60000 × 1.2666… = 76000
  });

  it('is null for non-positive or non-finite inputs', () => {
    expect(estimate1rmGrams(0, 5)).toBeNull();
    expect(estimate1rmGrams(100_000, 0)).toBeNull();
    expect(estimate1rmGrams(-1, 5)).toBeNull();
    expect(estimate1rmGrams(100_000, -5)).toBeNull();
    expect(estimate1rmGrams(Number.NaN, 5)).toBeNull();
    expect(estimate1rmGrams(100_000, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('prEvents (§12)', () => {
  it('first achievement has previousValue null', () => {
    const sessions = [sessionAt(1000, [{ name: 'Bench', sets: [set({ weightGrams: 60_000, reps: 5 })] }])];
    const events = prEvents(sessions);
    const weight = events.find((e) => e.metric === 'weight');
    expect(weight).toMatchObject({ exerciseName: 'Bench', value: 60_000, previousValue: null, sessionId: 's-1000' });
  });

  it('emits only on strict improvement — equal and worse are silent', () => {
    const sessions = [
      sessionAt(1000, [{ name: 'Bench', sets: [set({ weightGrams: 60_000, reps: 5 })] }]),
      sessionAt(2000, [{ name: 'Bench', sets: [set({ weightGrams: 60_000, reps: 5 })] }]),
      sessionAt(3000, [{ name: 'Bench', sets: [set({ weightGrams: 55_000, reps: 5 })] }]),
      sessionAt(4000, [{ name: 'Bench', sets: [set({ weightGrams: 65_000, reps: 5 })] }]),
    ];
    const weightEvents = prEvents(sessions).filter((e) => e.metric === 'weight');
    expect(weightEvents.map((e) => e.value)).toEqual([60_000, 65_000]);
    expect(weightEvents[1].previousValue).toBe(60_000);
    expect(weightEvents[1].timestampMs).toBe(4000);
  });

  it('orders events chronologically even when sessions arrive unsorted', () => {
    const older = sessionAt(1000, [{ name: 'Bench', sets: [set({ weightGrams: 50_000, reps: 5 })] }]);
    const newer = sessionAt(2000, [{ name: 'Bench', sets: [set({ weightGrams: 70_000, reps: 5 })] }]);
    const events = prEvents([newer, older]).filter((e) => e.metric === 'weight');
    expect(events.map((e) => e.timestampMs)).toEqual([1000, 2000]);
    expect(events[1].previousValue).toBe(50_000);
  });

  it('weight PR requires weight and reps; weight-only set never counts', () => {
    const sessions = [sessionAt(1000, [{ name: 'Bench', sets: [set({ weightGrams: 100_000, reps: null })] }])];
    expect(prEvents(sessions).some((e) => e.metric === 'weight')).toBe(false);
    expect(prEvents(sessions)).toEqual([]);
  });

  it('reps PR counts bodyweight sets (no weight logged)', () => {
    const sessions = [
      sessionAt(1000, [{ name: 'Dip', sets: [set({ weightGrams: null, reps: 12 })] }]),
      sessionAt(2000, [{ name: 'Dip', sets: [set({ weightGrams: null, reps: 9 })] }]),
      sessionAt(3000, [{ name: 'Dip', sets: [set({ weightGrams: null, reps: 15 })] }]),
    ];
    const reps = prEvents(sessions).filter((e) => e.metric === 'reps');
    expect(reps.map((e) => e.value)).toEqual([12, 15]);
    expect(prEvents(sessions).some((e) => e.metric === 'weight')).toBe(false);
  });

  it('tracks duration and distance records with their own history', () => {
    const sessions = [
      sessionAt(1000, [{ name: 'Row', sets: [set({ durationMs: 60_000, distanceMm: 2_000 })] }]),
      sessionAt(2000, [{ name: 'Row', sets: [set({ durationMs: 45_000, distanceMm: 3_000 })] }]),
      sessionAt(3000, [{ name: 'Row', sets: [set({ durationMs: 90_000, distanceMm: 1_000 })] }]),
    ];
    const events = prEvents(sessions);
    expect(events.filter((e) => e.metric === 'duration').map((e) => e.value)).toEqual([60_000, 90_000]);
    expect(events.filter((e) => e.metric === 'distance').map((e) => e.value)).toEqual([2_000, 3_000]);
  });

  it('ignores incomplete sets entirely', () => {
    const sessions = [
      sessionAt(1000, [{ name: 'Bench', sets: [set({ weightGrams: 90_000, reps: 5, isCompleted: false })] }]),
    ];
    expect(prEvents(sessions)).toEqual([]);
  });

  it('keeps records separate per exercise', () => {
    const sessions = [
      sessionAt(1000, [
        { name: 'Bench', sets: [set({ weightGrams: 60_000, reps: 5 })] },
        { name: 'Squat', sets: [set({ weightGrams: 60_000, reps: 5 })] },
      ]),
      sessionAt(2000, [
        { name: 'Bench', sets: [set({ weightGrams: 70_000, reps: 5 })] },
        { name: 'Squat', sets: [set({ weightGrams: 100_000, reps: 5 })] },
      ]),
    ];
    const byExercise = prEvents(sessions).reduce<Record<string, number[]>>((acc, e) => {
      if (e.metric === 'weight') (acc[e.exerciseName] ??= []).push(e.value);
      return acc;
    }, {});
    expect(byExercise.Bench).toEqual([60_000, 70_000]);
    expect(byExercise.Squat).toEqual([60_000, 100_000]);
  });

  it('estimated 1RM improves even when weight does not (higher reps)', () => {
    const sessions = [
      sessionAt(1000, [{ name: 'Bench', sets: [set({ weightGrams: 100_000, reps: 5 })] }]), // est 116,667
      sessionAt(2000, [{ name: 'Bench', sets: [set({ weightGrams: 90_000, reps: 10 })] }]), // est 120,000
    ];
    const est = prEvents(sessions).filter((e) => e.metric === 'estimated1rm');
    expect(est.map((e) => e.value)).toEqual([116_667, 120_000]);
    // weight PR did not improve in the second session
    expect(prEvents(sessions).filter((e) => e.metric === 'weight')).toHaveLength(1);
  });

  it('is empty with no data', () => {
    expect(prEvents([])).toEqual([]);
  });
});

describe('exercisePrs (§12)', () => {
  const sessions = [
    sessionAt(1000, [{ name: 'Bench', sets: [set({ weightGrams: 60_000, reps: 5, durationMs: 30_000 })] }]),
    sessionAt(2000, [{ name: 'Bench', sets: [set({ weightGrams: 80_000, reps: 3 })] }]),
    sessionAt(1500, [{ name: 'Zed Lift', sets: [set({ reps: 20 })] }]),
  ];

  it('aggregates final bests with the achieving timestamp', () => {
    const prs = exercisePrs(sessions);
    expect(prs).toHaveLength(2);
    const bench = prs.find((p) => p.exerciseName === 'Bench');
    expect(bench).toMatchObject({
      bestWeightGrams: 80_000,
      bestWeightAtMs: 2000,
      bestReps: 5,
      bestRepsAtMs: 1000,
      bestDurationMs: 30_000,
      bestDurationAtMs: 1000,
      estimated1rmGrams: 88_000, // 80000 × (1 + 3/30)
      estimated1rmAtMs: 2000,
      bestDistanceMm: null,
      bestDistanceAtMs: null,
    });
  });

  it('sorts alphabetically and leaves unhit metrics null', () => {
    const prs = exercisePrs(sessions);
    expect(prs.map((p) => p.exerciseName)).toEqual(['Bench', 'Zed Lift']);
    const zed = prs.find((p) => p.exerciseName === 'Zed Lift');
    expect(zed?.bestWeightGrams).toBeNull();
    expect(zed?.bestReps).toBe(20);
    expect(zed?.estimated1rmGrams).toBeNull();
  });

  it('returns an empty list without data', () => {
    expect(exercisePrs([])).toEqual([]);
  });
});

describe('prHistory (§12)', () => {
  const sessions = [
    sessionAt(1000, [{ name: 'Bench', sets: [set({ weightGrams: 60_000, reps: 5 })] }]),
    sessionAt(2000, [{ name: 'Bench', sets: [set({ weightGrams: 70_000, reps: 5, durationMs: 50_000 })] }]),
    sessionAt(3000, [{ name: 'Squat', sets: [set({ weightGrams: 100_000, reps: 5 })] }]),
  ];

  it('filters by exercise', () => {
    expect(prHistory(sessions, 'Bench').every((e) => e.exerciseName === 'Bench')).toBe(true);
    expect(prHistory(sessions, 'Bench').length).toBeGreaterThan(0);
    expect(prHistory(sessions, 'Squat')).toHaveLength(3); // weight, reps, estimated1rm
  });

  it('filters by metric and stays chronological', () => {
    const weight = prHistory(sessions, 'Bench', 'weight');
    expect(weight.map((e) => e.value)).toEqual([60_000, 70_000]);
    expect(weight.map((e) => e.timestampMs)).toEqual([1000, 2000]);
    expect(weight.every((e) => e.metric === 'weight')).toBe(true);
  });

  it('is empty for unknown exercises', () => {
    expect(prHistory(sessions, 'Row')).toEqual([]);
  });
});
