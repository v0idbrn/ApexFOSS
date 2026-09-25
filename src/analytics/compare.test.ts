import { compareSessions, previousSessionBefore, EMPTY_SIDE } from './compare';
import type { DatedSession, SetLoadInput } from './load';

const set = (partial: Partial<SetLoadInput>): SetLoadInput => ({
  weightGrams: null,
  reps: null,
  durationMs: null,
  isCompleted: true,
  ...partial,
});

function session(
  timestampMs: number,
  exercises: Array<{ name: string; sets: SetLoadInput[] }>,
  sessionId = `s-${timestampMs}`,
  wallMs = 3_600_000,
): DatedSession {
  return {
    sessionId,
    name: 'Session',
    timestampMs,
    startedAt: timestampMs - wallMs,
    endedAt: wallMs > 0 ? timestampMs : null,
    exercises: exercises.map((e) => ({ exerciseName: e.name, sets: e.sets })),
  };
}

describe('compareSessions (§13)', () => {
  it('computes total volume delta and percent change', () => {
    const baseline = session(1000, [{ name: 'Bench', sets: [set({ weightGrams: 60_000, reps: 5 })] }]); // 300k
    const current = session(2000, [{ name: 'Bench', sets: [set({ weightGrams: 80_000, reps: 5 })] }]); // 400k
    const c = compareSessions(baseline, current);
    expect(c.volume.current).toBe(400_000);
    expect(c.volume.previous).toBe(300_000);
    expect(c.volume.delta).toBe(100_000);
    expect(c.volume.percentChange).toBe(33.3);
  });

  it('percent change is null when the baseline volume is zero', () => {
    const baseline = session(1000, [{ name: 'Bench', sets: [set({ durationMs: 60_000 })] }]);
    const current = session(2000, [{ name: 'Bench', sets: [set({ weightGrams: 60_000, reps: 5 })] }]);
    const c = compareSessions(baseline, current);
    expect(c.volume.percentChange).toBeNull();
    expect(c.volume.delta).toBe(300_000);
    expect(Number.isFinite(c.volume.delta)).toBe(true);
  });

  it('compares completed set counts and wall duration', () => {
    const baseline = session(
      1000,
      [{ name: 'Bench', sets: [set({ reps: 5 }), set({ reps: 5, isCompleted: false })] }],
      'a',
      3_600_000,
    );
    const current = session(2000, [{ name: 'Bench', sets: [set({ reps: 5 }), set({ reps: 5 })] }], 'b', 5_400_000);
    const c = compareSessions(baseline, current);
    expect(c.sets.current).toBe(2);
    expect(c.sets.previous).toBe(1);
    expect(c.duration.delta).toBe(1_800_000);
  });

  it('produces per-exercise sides with bests for both sessions', () => {
    const baseline = session(1000, [
      {
        name: 'Bench',
        sets: [set({ weightGrams: 60_000, reps: 5 }), set({ weightGrams: 70_000, reps: 3 })],
      },
    ]);
    const current = session(2000, [
      {
        name: 'Bench',
        sets: [set({ weightGrams: 75_000, reps: 4 }), set({ weightGrams: 50_000, reps: 10 })],
      },
    ]);
    const c = compareSessions(baseline, current);
    expect(c.exercises).toHaveLength(1);
    const ex = c.exercises[0];
    expect(ex.present).toBe('both');
    expect(ex.baseline.bestWeightGrams).toBe(70_000);
    expect(ex.baseline.bestReps).toBe(5);
    expect(ex.baseline.estimated1rmGrams).toBe(77_000); // 70k × 1.1
    expect(ex.current.bestWeightGrams).toBe(75_000);
    expect(ex.current.bestReps).toBe(10);
    expect(ex.current.estimated1rmGrams).toBe(85_000); // 75k × (1 + 4/30)
    expect(ex.baseline.resistanceGramReps).toBe(510_000); // 300k + 210k
    expect(ex.current.resistanceGramReps).toBe(800_000); // 300k + 500k
    expect(ex.volumeDeltaGramReps).toBe(290_000);
  });

  it('keeps exercises missing from one side with null percent change', () => {
    const baseline = session(1000, [{ name: 'Bench', sets: [set({ weightGrams: 60_000, reps: 5 })] }]);
    const current = session(2000, [{ name: 'Row', sets: [set({ durationMs: 60_000 })] }]);
    const c = compareSessions(baseline, current);
    expect(c.exercises.map((e) => e.exerciseName)).toEqual(['Bench', 'Row']);
    const bench = c.exercises.find((e) => e.exerciseName === 'Bench');
    expect(bench?.present).toBe('baseline');
    expect(bench?.current).toEqual({ ...EMPTY_SIDE, wallMs: c.duration.current });
    expect(bench?.volumePercentChange).toBeNull();
    const row = c.exercises.find((e) => e.exerciseName === 'Row');
    expect(row?.present).toBe('current');
    expect(row?.baseline).toEqual({ ...EMPTY_SIDE, wallMs: c.duration.previous });
  });

  it('orders exercises alphabetically as the union of both sessions', () => {
    const baseline = session(1000, [
      { name: 'Squat', sets: [set({ reps: 5 })] },
      { name: 'Bench', sets: [set({ reps: 5 })] },
    ]);
    const current = session(2000, [
      { name: 'Row', sets: [set({ reps: 5 })] },
      { name: 'Bench', sets: [set({ reps: 5 })] },
    ]);
    const c = compareSessions(baseline, current);
    expect(c.exercises.map((e) => e.exerciseName)).toEqual(['Bench', 'Row', 'Squat']);
  });

  it('excludes incomplete sets from completed counts and volume but not setCount', () => {
    const baseline = session(1000, [{ name: 'Bench', sets: [set({ weightGrams: 60_000, reps: 5 })] }]);
    const current = session(2000, [
      { name: 'Bench', sets: [set({ weightGrams: 60_000, reps: 5, isCompleted: false })] },
    ]);
    const c = compareSessions(baseline, current);
    expect(c.sets.current).toBe(0);
    expect(c.volume.current).toBe(0);
    expect(c.exercises[0].current.setCount).toBe(1);
    expect(c.exercises[0].current.completedSetCount).toBe(0);
    expect(c.exercises[0].current.bestWeightGrams).toBeNull();
  });

  it('never yields NaN or Infinity for empty sessions', () => {
    const baseline = session(1000, []);
    const current = session(2000, []);
    const c = compareSessions(baseline, current);
    expect(c.exercises).toEqual([]);
    expect(Number.isFinite(c.volume.delta)).toBe(true);
    expect(c.volume.percentChange).toBeNull();
    expect(c.sets).toMatchObject({ current: 0, previous: 0, delta: 0, percentChange: null });
  });

  it('carries refs for both sessions', () => {
    const baseline = session(1000, [], 'old');
    const current = session(2000, [], 'new');
    const c = compareSessions(baseline, current);
    expect(c.baselineRef).toMatchObject({ sessionId: 'old', timestampMs: 1000 });
    expect(c.currentRef).toMatchObject({ sessionId: 'new', timestampMs: 2000 });
  });
});

describe('previousSessionBefore (§13)', () => {
  const older = session(1000, [], 'older');
  const middle = session(2000, [], 'middle');
  const newer = session(3000, [], 'newer');

  it('picks the most recent session strictly before the reference', () => {
    expect(previousSessionBefore([older, middle, newer], 3000)?.sessionId).toBe('middle');
    expect(previousSessionBefore([older, middle, newer], 2500)?.sessionId).toBe('middle');
    expect(previousSessionBefore([older, middle, newer], 1500)?.sessionId).toBe('older');
    expect(previousSessionBefore([older, middle, newer], 500)?.sessionId).toBeUndefined();
  });

  it('returns null when nothing is older', () => {
    expect(previousSessionBefore([middle, newer], 1000)).toBeNull();
    expect(previousSessionBefore([], 1000)).toBeNull();
  });

  it('ignores sessions at or after the reference timestamp', () => {
    expect(previousSessionBefore([older, middle, newer], 2000)?.sessionId).toBe('older');
    expect(previousSessionBefore([middle, newer], 2000)).toBeNull();
  });
});
