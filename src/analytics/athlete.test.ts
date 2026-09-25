import {
  rollingSummary,
  weeklySeries,
  descriptiveDelta,
  durationStats,
  setsForExercise,
} from './athlete';
import { currentWindow, previousWindow } from './trends';
import { type DatedSession, type SetLoadInput } from './load';

const set = (partial: Partial<SetLoadInput>): SetLoadInput => ({
  weightGrams: null,
  reps: null,
  durationMs: null,
  isCompleted: true,
  ...partial,
});

function sessionAt(
  timestampMs: number,
  sets: SetLoadInput[],
  wallMs = 60_000,
  exerciseName = 'Bench Press',
): DatedSession {
  return {
    sessionId: `s-${timestampMs}`,
    name: 'Session',
    timestampMs,
    startedAt: timestampMs - wallMs,
    endedAt: wallMs > 0 ? timestampMs : null,
    exercises: [{ exerciseName, sets }],
  };
}

function localNoon(daysAgo: number): number {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d.getTime();
}

const res = (weightGrams: number, reps: number) => set({ weightGrams, reps });

describe('rollingSummary (§11)', () => {
  const now = Date.now();

  it('counts only sessions inside the 7-day window, excluding day 7+8', () => {
    const sessions = [
      sessionAt(localNoon(0), [res(60_000, 5)]),
      sessionAt(localNoon(6), [res(60_000, 5)]),
      sessionAt(localNoon(7), [res(100_000, 5)]), // 7 days ago → outside 7d window
    ];
    const s = rollingSummary(sessions, now, 7);
    expect(s.sessionCount).toBe(2);
    expect(s.resistanceGramReps).toBe(600_000);
    expect(s.completedSetCount).toBe(2);
    expect(s.windowStartMs).toBe(currentWindow(now, 7).startMs);
    expect(s.windowEndMs).toBe(currentWindow(now, 7).endMs);
  });

  it('a 28-day window includes older sessions the 7-day window excludes', () => {
    const sessions = [sessionAt(localNoon(0), [res(60_000, 5)]), sessionAt(localNoon(20), [res(100_000, 5)])];
    expect(rollingSummary(sessions, now, 7).sessionCount).toBe(1);
    expect(rollingSummary(sessions, now, 28).sessionCount).toBe(2);
    expect(rollingSummary(sessions, now, 28).resistanceGramReps).toBe(800_000); // 300k + 500k
  });

  it('returns zeroed nulls for an empty window', () => {
    const s = rollingSummary([], now, 7);
    expect(s.sessionCount).toBe(0);
    expect(s.avgSetsPerSession).toBeNull();
    expect(s.avgLoadPerSetGramReps).toBeNull();
    expect(s.sessionsPerWeek).toBeNull();
    expect(s.densityGramRepsPerMinute).toBeNull();
  });

  it('computes avg sets/session and avg load/set with 1dp / integer rounding', () => {
    const sessions = [
      sessionAt(localNoon(0), [res(60_000, 5), res(60_000, 5), res(60_000, 5)]),
      sessionAt(localNoon(1), [res(60_000, 5), res(60_000, 5)]),
    ];
    const s = rollingSummary(sessions, now, 7);
    expect(s.avgSetsPerSession).toBe(2.5);
    expect(s.avgLoadPerSetGramReps).toBe(300_000); // gram-reps per set (60kg × 5 reps)
    expect(s.sessionsPerWeek).toBe(2);
  });

  it('scales sessionsPerWeek to the window length (28d → ×7/28)', () => {
    const sessions = [localNoon(0), localNoon(9), localNoon(18), localNoon(27)].map((t) =>
      sessionAt(t, [res(60_000, 5)]),
    );
    const s = rollingSummary(sessions, now, 28);
    expect(s.sessionsPerWeek).toBe(1); // 4 sessions × 7/28
  });

  it('computes density per wall-clock minute and nulls it without wall time', () => {
    const withWall = [sessionAt(localNoon(0), [res(60_000, 10)], 120_000)];
    const s = rollingSummary(withWall, now, 7);
    // 600,000 gram-reps over 2 minutes → 300,000 gram-reps/min
    expect(s.wallMs).toBe(120_000);
    expect(s.densityGramRepsPerMinute).toBe(300_000);

    const withoutWall = [sessionAt(localNoon(0), [res(60_000, 10)], 0)];
    expect(rollingSummary(withoutWall, now, 7).densityGramRepsPerMinute).toBeNull();
  });

  it('density is null when there is wall time but no resistance work', () => {
    const s = rollingSummary([sessionAt(localNoon(0), [set({ durationMs: 60_000 })], 60_000)], now, 7);
    expect(s.wallMs).toBe(60_000);
    expect(s.densityGramRepsPerMinute).toBeNull();
  });
});

describe('weeklySeries (§11)', () => {
  const now = Date.now();

  it('returns oldest → newest non-overlapping buckets', () => {
    const sessions = [
      sessionAt(localNoon(13), [res(60_000, 5)]), // 2 weeks ago
      sessionAt(localNoon(6), [res(60_000, 5)]), // last week
      sessionAt(localNoon(0), [res(60_000, 5)]), // this week
      sessionAt(localNoon(7), [res(100_000, 5)]), // boundary: first day of previous week
    ];
    const points = weeklySeries(sessions, now, 3);
    expect(points).toHaveLength(3);
    expect(points[0].sessionCount).toBe(0); // days 20..14 → none
    expect(points[1].sessionCount).toBe(2); // days 13..7 → both boundary sessions
    expect(points[2].sessionCount).toBe(2); // days 6..0
    // Ordering: start times strictly increasing, each 7 calendar days apart
    // (rounded — local midnight shifts across DST transitions).
    expect(points[0].weekStartMs).toBeLessThan(points[1].weekStartMs);
    expect(points[1].weekStartMs).toBeLessThan(points[2].weekStartMs);
    expect(Math.round((points[1].weekStartMs - points[0].weekStartMs) / 86_400_000)).toBe(7);
    expect(Math.round((points[2].weekStartMs - points[1].weekStartMs) / 86_400_000)).toBe(7);
  });

  it('bucket start is a local midnight', () => {
    const points = weeklySeries([], now, 4);
    expect(new Date(points[3].weekStartMs).getHours()).toBe(0);
    expect(new Date(points[3].weekStartMs).getMinutes()).toBe(0);
  });

  it('sums resistance per bucket', () => {
    const sessions = [
      sessionAt(localNoon(0), [res(60_000, 5), res(60_000, 5)]),
      sessionAt(localNoon(1), [res(60_000, 5)]),
    ];
    const points = weeklySeries(sessions, now, 1);
    expect(points).toHaveLength(1);
    expect(points[0].resistanceGramReps).toBe(900_000);
  });

  it('requests at least one bucket even for 0 or negative weeks', () => {
    expect(weeklySeries([], now, 0)).toHaveLength(1);
    expect(weeklySeries([], now, -3)).toHaveLength(1);
  });

  it('zero weeks produce zeroed buckets without NaN', () => {
    const points = weeklySeries([], now, 2);
    for (const p of points) {
      expect(p.sessionCount).toBe(0);
      expect(p.resistanceGramReps).toBe(0);
      expect(Number.isNaN(p.weekStartMs)).toBe(false);
    }
  });
});

describe('descriptiveDelta (§11)', () => {
  it('computes absolute and percent change with 1dp', () => {
    expect(descriptiveDelta(150, 100)).toEqual({ current: 150, previous: 100, delta: 50, percentChange: 50 });
    expect(descriptiveDelta(90, 100)).toEqual({ current: 90, previous: 100, delta: -10, percentChange: -10 });
    expect(descriptiveDelta(110, 90).percentChange).toBe(22.2);
  });

  it('percentChange is null when the previous value is zero — never Infinity', () => {
    expect(descriptiveDelta(100, 0)).toEqual({ current: 100, previous: 0, delta: 100, percentChange: null });
    expect(descriptiveDelta(0, 0).percentChange).toBeNull();
  });

  it('treats non-finite inputs as zero', () => {
    expect(descriptiveDelta(Number.NaN, 100)).toEqual({ current: 0, previous: 100, delta: -100, percentChange: -100 });
    expect(descriptiveDelta(Number.POSITIVE_INFINITY, 1).percentChange).toBe(-100);
  });
});

describe('durationStats (§11)', () => {
  const now = Date.now();

  it('nulls when the window has no timed sessions', () => {
    const win = currentWindow(now, 7);
    expect(durationStats([], win)).toEqual({ sessionCount: 0, avgMs: null, minMs: null, maxMs: null });
  });

  it('avg/min/max over ended sessions only', () => {
    const win = currentWindow(now, 7);
    const sessions = [
      sessionAt(localNoon(0), [], 60_000),
      sessionAt(localNoon(1), [], 180_000),
      sessionAt(localNoon(2), [], 120_000),
      sessionAt(localNoon(3), [], 0), // endedAt === null → excluded
    ];
    const s = durationStats(sessions, win);
    expect(s.sessionCount).toBe(3);
    expect(s.avgMs).toBe(120_000);
    expect(s.minMs).toBe(60_000);
    expect(s.maxMs).toBe(180_000);
  });

  it('ignores sessions whose end precedes their start', () => {
    const win = currentWindow(now, 7);
    const bad: DatedSession = {
      ...sessionAt(localNoon(0), [], 60_000),
      startedAt: localNoon(0),
      endedAt: localNoon(0) - 10_000,
    };
    expect(durationStats([bad], win).sessionCount).toBe(0);
  });

  it('excludes sessions outside the window', () => {
    const win = previousWindow(now, 7); // last week only
    expect(durationStats([sessionAt(localNoon(0), [], 60_000)], win).sessionCount).toBe(0);
  });
});

describe('setsForExercise (§11 → §12 basis)', () => {
  it('collects only the named exercise, oldest → newest, across sessions', () => {
    const a = sessionAt(localNoon(2), [res(60_000, 5), res(70_000, 3)]);
    const b = sessionAt(localNoon(1), [{ ...res(80_000, 5), isCompleted: false }]);
    const c = sessionAt(localNoon(0), [{ ...res(90_000, 5) }], 60_000, 'Overhead Press');
    const entries = [a, b, c].flatMap((s) => setsForExercise(s, 'Bench Press'));
    expect(entries).toHaveLength(3);
    expect(entries[0].weightGrams).toBe(60_000);
    expect(entries[1].weightGrams).toBe(70_000);
    expect(entries[2].weightGrams).toBe(80_000);
    expect(entries.map((e) => e.timestampMs)).toEqual(
      [...entries.map((e) => e.timestampMs)].sort((x, y) => x - y),
    );
    expect(entries[2].isCompleted).toBe(false);
  });

  it('marks completed only when the set carries resistance or duration', () => {
    const s = sessionAt(localNoon(0), [
      res(60_000, 5),
      set({ weightGrams: null, reps: null, durationMs: 60_000 }),
      set({ weightGrams: 60_000, reps: null, durationMs: null }),
    ]);
    const entries = setsForExercise(s, 'Bench Press');
    expect(entries.map((e) => e.isCompleted)).toEqual([true, true, false]);
  });

  it('captures distance when present and null when absent', () => {
    const withDistance = sessionAt(localNoon(1), [
      { ...res(0, 0), weightGrams: 0, reps: 1, distanceMm: 2_000 } as SetLoadInput & { distanceMm: number },
    ]);
    const plain = sessionAt(localNoon(0), [res(60_000, 5)]);
    expect(setsForExercise(withDistance, 'Bench Press')[0].distanceMm).toBe(2_000);
    expect(setsForExercise(plain, 'Bench Press')[0].distanceMm).toBeNull();
  });

  it('returns an empty array for an exercise absent from the session', () => {
    expect(setsForExercise(sessionAt(localNoon(0), [res(60_000, 5)]), 'Squat')).toEqual([]);
  });
});
