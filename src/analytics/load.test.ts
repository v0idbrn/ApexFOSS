import {
  calculateSetLoad,
  calculateExerciseLoad,
  calculateSessionLoad,
  calculateDateRangeLoad,
  dateRange,
  startOfLocalDay,
  gramRepsToKgReps,
  msToSeconds,
  type SetLoadInput,
  type DatedSession,
} from './load';

const set = (partial: Partial<SetLoadInput>): SetLoadInput => ({
  weightGrams: null,
  reps: null,
  durationMs: null,
  isCompleted: true,
  ...partial,
});

describe('calculateSetLoad', () => {
  it('computes resistance volume when weight and reps present', () => {
    const load = calculateSetLoad(set({ weightGrams: 100_000, reps: 5 }));
    expect(load.resistanceGramReps).toBe(500_000);
    expect(load.hasResistance).toBe(true);
    expect(load.durationMs).toBe(0);
    expect(load.hasDuration).toBe(false);
  });

  it('computes duration work when duration present', () => {
    const load = calculateSetLoad(set({ durationMs: 30_000 }));
    expect(load.durationMs).toBe(30_000);
    expect(load.hasDuration).toBe(true);
    expect(load.resistanceGramReps).toBe(0);
    expect(load.hasResistance).toBe(false);
  });

  it('keeps resistance and duration separate when both present', () => {
    const load = calculateSetLoad(set({ weightGrams: 50_000, reps: 3, durationMs: 10_000 }));
    expect(load.resistanceGramReps).toBe(150_000);
    expect(load.durationMs).toBe(10_000);
    expect(load.hasResistance).toBe(true);
    expect(load.hasDuration).toBe(true);
  });

  it('returns zero for incomplete sets', () => {
    const load = calculateSetLoad(set({ weightGrams: 100_000, reps: 5, isCompleted: false }));
    expect(load.resistanceGramReps).toBe(0);
    expect(load.durationMs).toBe(0);
    expect(load.hasResistance).toBe(false);
  });

  it('does not fabricate tonnage when weight missing', () => {
    const load = calculateSetLoad(set({ reps: 10 }));
    expect(load.resistanceGramReps).toBe(0);
    expect(load.hasResistance).toBe(false);
  });

  it('does not fabricate tonnage when reps missing', () => {
    const load = calculateSetLoad(set({ weightGrams: 100_000 }));
    expect(load.resistanceGramReps).toBe(0);
    expect(load.hasResistance).toBe(false);
  });

  it('treats zero weight as no resistance', () => {
    const load = calculateSetLoad(set({ weightGrams: 0, reps: 5 }));
    expect(load.hasResistance).toBe(false);
  });
});

describe('calculateExerciseLoad', () => {
  it('sums completed resistance sets', () => {
    const el = calculateExerciseLoad('Squat', [
      set({ weightGrams: 100_000, reps: 5 }),
      set({ weightGrams: 100_000, reps: 5 }),
      set({ weightGrams: 100_000, reps: 5, isCompleted: false }),
    ]);
    expect(el.resistanceGramReps).toBe(1_000_000);
    expect(el.resistanceSetCount).toBe(2);
    expect(el.completedSetCount).toBe(2);
    expect(el.exerciseName).toBe('Squat');
  });

  it('mixes resistance and duration sets without cross-contamination', () => {
    const el = calculateExerciseLoad('Mixed', [
      set({ weightGrams: 80_000, reps: 5 }),
      set({ durationMs: 60_000 }),
    ]);
    expect(el.resistanceGramReps).toBe(400_000);
    expect(el.durationMs).toBe(60_000);
    expect(el.resistanceSetCount).toBe(1);
    expect(el.durationSetCount).toBe(1);
    expect(el.completedSetCount).toBe(2);
  });

  it('returns zeros for empty sets', () => {
    const el = calculateExerciseLoad('Empty', []);
    expect(el.resistanceGramReps).toBe(0);
    expect(el.completedSetCount).toBe(0);
  });
});

describe('calculateSessionLoad', () => {
  it('aggregates across exercises', () => {
    const sl = calculateSessionLoad({
      sessionId: 's1',
      name: 'Day A',
      startedAt: 1000,
      endedAt: 2000,
      exercises: [
        { exerciseName: 'Squat', sets: [set({ weightGrams: 100_000, reps: 5 })] },
        { exerciseName: 'Press', sets: [set({ weightGrams: 60_000, reps: 5 })] },
      ],
    });
    expect(sl.resistanceGramReps).toBe(800_000);
    expect(sl.exerciseLoads).toHaveLength(2);
    expect(sl.sessionId).toBe('s1');
    expect(sl.completedSetCount).toBe(2);
  });
});

describe('dateRange / startOfLocalDay', () => {
  const now = new Date('2026-09-24T15:30:00').getTime();

  it('today starts at local midnight', () => {
    const r = dateRange('today', now);
    expect(r.startMs).toBe(startOfLocalDay(now));
    expect(r.endMs).toBe(now);
    expect(r.kind).toBe('today');
  });

  it('7d covers 7 calendar days including today', () => {
    const r = dateRange('7d', now);
    const days = (r.endMs - r.startMs) / 86_400_000;
    expect(days).toBeGreaterThanOrEqual(6);
    expect(days).toBeLessThan(7.01);
  });

  it('28d covers 28 calendar days including today', () => {
    const r = dateRange('28d', now);
    const days = (r.endMs - r.startMs) / 86_400_000;
    expect(days).toBeGreaterThanOrEqual(27);
    expect(days).toBeLessThan(28.01);
  });

  it('startOfLocalDay zeroes time components', () => {
    const d = new Date(startOfLocalDay(now));
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
  });
});

describe('calculateDateRangeLoad', () => {
  const now = new Date('2026-09-24T12:00:00').getTime();
  const today = startOfLocalDay(now) + 3_600_000;
  const yesterday = startOfLocalDay(now) - 3_600_000;
  const weekAgo = startOfLocalDay(now) - 8 * 86_400_000;

  const sessions: DatedSession[] = [
    {
      sessionId: 'a',
      name: 'Today',
      timestampMs: today,
      startedAt: today,
      endedAt: today,
      exercises: [{ exerciseName: 'Squat', sets: [set({ weightGrams: 100_000, reps: 5 })] }],
    },
    {
      sessionId: 'b',
      name: 'Yesterday',
      timestampMs: yesterday,
      startedAt: yesterday,
      endedAt: yesterday,
      exercises: [{ exerciseName: 'Squat', sets: [set({ weightGrams: 80_000, reps: 5 })] }],
    },
    {
      sessionId: 'c',
      name: 'Week+',
      timestampMs: weekAgo,
      startedAt: weekAgo,
      endedAt: weekAgo,
      exercises: [{ exerciseName: 'Squat', sets: [set({ weightGrams: 60_000, reps: 5 })] }],
    },
  ];

  it('today window includes only today', () => {
    const agg = calculateDateRangeLoad(sessions, dateRange('today', now));
    expect(agg.resistanceGramReps).toBe(500_000);
  });

  it('7d window includes today and yesterday, excludes week+', () => {
    const agg = calculateDateRangeLoad(sessions, dateRange('7d', now));
    expect(agg.resistanceGramReps).toBe(900_000);
  });

  it('28d window includes all three', () => {
    const agg = calculateDateRangeLoad(sessions, dateRange('28d', now));
    expect(agg.resistanceGramReps).toBe(1_200_000);
  });

  it('excludes sessions outside window', () => {
    const onlyToday = sessions.filter((s) => s.timestampMs >= dateRange('today', now).startMs);
    expect(onlyToday).toHaveLength(1);
  });
});

describe('display helpers', () => {
  it('converts gram-reps to kg·reps with one decimal', () => {
    expect(gramRepsToKgReps(500_000)).toBe(500);
    expect(gramRepsToKgReps(125_000)).toBe(125);
    expect(gramRepsToKgReps(100_500)).toBe(100.5);
  });

  it('converts ms to seconds', () => {
    expect(msToSeconds(30_000)).toBe(30);
    expect(msToSeconds(1500)).toBe(2);
  });
});
