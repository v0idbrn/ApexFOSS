import {
  calculateLoadRatio,
  calculateWindowTotals,
  compareWindows,
  currentWindow,
  dayWindow,
  previousWindow,
} from './trends';
import { startOfLocalDay, type DatedSession, type SetLoadInput } from './load';

const set = (partial: Partial<SetLoadInput>): SetLoadInput => ({
  weightGrams: null,
  reps: null,
  durationMs: null,
  isCompleted: true,
  ...partial,
});

function sessionAt(timestampMs: number, sets: SetLoadInput[]): DatedSession {
  return {
    sessionId: `s-${timestampMs}`,
    name: 'Session',
    timestampMs,
    startedAt: timestampMs - 60_000,
    endedAt: timestampMs,
    exercises: [{ exerciseName: 'Bench Press', sets }],
  };
}

/** Local-midnight timestamp `days` ago (positive = past). */
function daysAgoMidnight(days: number): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d.getTime();
}

function localNoon(daysAgo: number): number {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d.getTime();
}

describe('trend windows (local calendar, §16)', () => {
  const now = Date.now();

  it('current window spans today plus the preceding days at local midnight', () => {
    const win = currentWindow(now, 7);
    const expectedStart = new Date(now);
    expectedStart.setHours(0, 0, 0, 0);
    expectedStart.setDate(expectedStart.getDate() - 6);
    const expectedEnd = new Date(now);
    expectedEnd.setHours(0, 0, 0, 0);
    expectedEnd.setDate(expectedEnd.getDate() + 1);
    expect(win.startMs).toBe(expectedStart.getTime());
    expect(win.endMs).toBe(expectedEnd.getTime());
    expect(win.days).toBe(7);
    expect(new Date(win.startMs).getHours()).toBe(0);
    expect(now).toBeGreaterThanOrEqual(win.startMs);
    expect(now).toBeLessThan(win.endMs);
  });

  it('previous 7-day window is adjacent to the current one with no overlap or gap', () => {
    const current = currentWindow(now, 7);
    const previous = previousWindow(now, 7);
    expect(previous.endMs).toBe(current.startMs);
    expect(previous.startMs).toBeLessThan(previous.endMs);
    const expectedStart = new Date(current.startMs);
    expectedStart.setDate(expectedStart.getDate() - 7);
    expect(previous.startMs).toBe(expectedStart.getTime());
    expect(previous.days).toBe(7);
  });

  it('previous 28-day window is adjacent to the current 28-day window', () => {
    const current = currentWindow(now, 28);
    const previous = previousWindow(now, 28);
    expect(previous.endMs).toBe(current.startMs);
    const expectedStart = new Date(current.startMs);
    expectedStart.setDate(expectedStart.getDate() - 28);
    expect(previous.startMs).toBe(expectedStart.getTime());
    expect(previous.days).toBe(28);
  });

  it('windows keep their nominal length (within a DST day)', () => {
    for (const days of [7, 28]) {
      for (const win of [currentWindow(now, days), previousWindow(now, days)]) {
        const drift = Math.abs(win.endMs - win.startMs - days * 86_400_000);
        expect(drift).toBeLessThan(2 * 3_600_000);
      }
    }
  });

  it('dayWindow supports arbitrary end offsets and matches previousWindow', () => {
    expect(dayWindow(now, 7, 7).startMs).toBe(previousWindow(now, 7).startMs);
    expect(dayWindow(now, 7, 7).endMs).toBe(previousWindow(now, 7).endMs);
    expect(dayWindow(now, 28, 0).startMs).toBe(currentWindow(now, 28).startMs);
  });

  it('classifies sessions into the right windows (current week excluded from chronic baseline)', () => {
    const sessions = [
      sessionAt(localNoon(0), []), // today → current 7d + current 28d
      sessionAt(localNoon(8), []), // 8 days ago → previous 7d + current 28d
      sessionAt(localNoon(40), []), // 40 days ago → previous 28d only
    ];
    const current7 = calculateWindowTotals(sessions, currentWindow(now, 7));
    const previous7 = calculateWindowTotals(sessions, previousWindow(now, 7));
    const current28 = calculateWindowTotals(sessions, currentWindow(now, 28));
    const previous28 = calculateWindowTotals(sessions, previousWindow(now, 28));
    expect(current7.sessionCount).toBe(1);
    expect(previous7.sessionCount).toBe(1);
    expect(current28.sessionCount).toBe(2);
    expect(previous28.sessionCount).toBe(1);
    // Chronic baseline never contains the current acute week (today, day 8 stay out).
  });

  it('excludes sessions exactly at window boundaries by half-open semantics', () => {
    const now2 = Date.now();
    const current = currentWindow(now2, 7);
    const atStart = sessionAt(current.startMs, []);
    const justBeforeStart = sessionAt(current.startMs - 1, []);
    const atEnd = sessionAt(current.endMs, []);
    expect(calculateWindowTotals([atStart], current).sessionCount).toBe(1);
    expect(calculateWindowTotals([justBeforeStart], current).sessionCount).toBe(0);
    expect(calculateWindowTotals([atEnd], current).sessionCount).toBe(0);
  });
});

describe('calculateWindowTotals', () => {
  const now = Date.now();

  it('sums resistance, duration and set counts for sessions inside the window', () => {
    const sessions = [
      sessionAt(localNoon(1), [
        set({ weightGrams: 60_000, reps: 5 }),
        set({ weightGrams: 60_000, reps: 5 }),
        set({ durationMs: 30_000 }),
        set({ weightGrams: 50_000, reps: 5, isCompleted: false }),
      ]),
    ];
    const totals = calculateWindowTotals(sessions, currentWindow(now, 7));
    expect(totals.sessionCount).toBe(1);
    expect(totals.resistanceGramReps).toBe(600_000);
    expect(totals.durationMs).toBe(30_000);
    expect(totals.resistanceSetCount).toBe(2);
    expect(totals.durationSetCount).toBe(1);
    expect(totals.completedSetCount).toBe(3);
  });

  it('ignores sessions outside the window and tolerates empty sessions', () => {
    const sessions = [sessionAt(localNoon(30), []), sessionAt(localNoon(1), [])];
    const totals = calculateWindowTotals(sessions, currentWindow(now, 7));
    expect(totals.sessionCount).toBe(1);
    expect(totals.completedSetCount).toBe(0);
    expect(totals.resistanceGramReps).toBe(0);
  });
});

describe('compareWindows', () => {
  const totals = (resistanceGramReps: number) => ({
    resistanceGramReps,
    durationMs: 0,
    resistanceSetCount: 0,
    durationSetCount: 0,
    completedSetCount: 0,
    sessionCount: resistanceGramReps > 0 ? 1 : 0,
  });

  it('reports positive percent change', () => {
    const cmp = compareWindows(totals(300_000), totals(150_000));
    expect(cmp.absoluteChange).toBe(150_000);
    expect(cmp.percentChange).toBe(100);
  });

  it('reports negative percent change', () => {
    const cmp = compareWindows(totals(50_000), totals(100_000));
    expect(cmp.absoluteChange).toBe(-50_000);
    expect(cmp.percentChange).toBe(-50);
  });

  it('reports zero change when both windows match', () => {
    const cmp = compareWindows(totals(100_000), totals(100_000));
    expect(cmp.absoluteChange).toBe(0);
    expect(cmp.percentChange).toBe(0);
  });

  it('returns null percent change instead of dividing by zero', () => {
    const cmp = compareWindows(totals(300_000), totals(0));
    expect(cmp.absoluteChange).toBe(300_000);
    expect(cmp.percentChange).toBeNull();
  });
});

describe('calculateLoadRatio (descriptive 7d / 28d)', () => {
  it('computes acute ÷ weekly baseline when data exists', () => {
    const ratio = calculateLoadRatio(300_000, 800_000, 1);
    expect(ratio.status).toBe('ok');
    expect(ratio.ratio).toBe(1.5);
    expect(ratio.acuteWeeklyGramReps).toBe(300_000);
    expect(ratio.chronicWeeklyGramReps).toBe(200_000); // 800000 ÷ 4
    expect(ratio.acuteDays).toBe(7);
    expect(ratio.chronicDays).toBe(28);
  });

  it('rounds the ratio to two decimals', () => {
    const ratio = calculateLoadRatio(100_000, 300_000, 1);
    expect(ratio.ratio).toBe(1.33);
  });

  it('returns 0 when the acute window has no load but a baseline exists', () => {
    const ratio = calculateLoadRatio(0, 800_000, 2);
    expect(ratio.status).toBe('ok');
    expect(ratio.ratio).toBe(0);
  });

  it('marks missing baseline sessions as insufficient (no invented ratio)', () => {
    const ratio = calculateLoadRatio(300_000, 0, 0);
    expect(ratio.status).toBe('no_baseline');
    expect(ratio.ratio).toBeNull();
    expect(ratio.chronicWeeklyGramReps).toBeNull();
  });

  it('marks a baseline without resistance load as zero baseline', () => {
    const ratio = calculateLoadRatio(300_000, 0, 3);
    expect(ratio.status).toBe('zero_baseline');
    expect(ratio.ratio).toBeNull();
    expect(ratio.chronicWeeklyGramReps).toBe(0);
  });

  it('never returns Infinity or NaN for hostile inputs', () => {
    const hostile: Array<[number, number, number]> = [
      [0, 0, 0],
      [0, 0, 5],
      [300_000, -800_000, 1],
      [NaN, NaN, NaN],
      [Infinity, Infinity, 1],
      [-Infinity, 800_000, 1],
      [NaN, 800_000, 1],
    ];
    for (const [acute, previous, count] of hostile) {
      const result = calculateLoadRatio(acute, previous, count);
      expect(result.ratio === null || Number.isFinite(result.ratio)).toBe(true);
      expect(Number.isFinite(result.acuteWeeklyGramReps)).toBe(true);
    }
  });

  it('does not include the current acute week in the chronic baseline', () => {
    const now = Date.now();
    // Load exists only inside the current week → previous-28d totals are zero.
    const sessions = [
      sessionAt(localNoon(0), [set({ weightGrams: 60_000, reps: 5 })]),
      sessionAt(localNoon(1), [set({ weightGrams: 60_000, reps: 5 })]),
    ];
    const previous28 = calculateWindowTotals(sessions, previousWindow(now, 28));
    expect(previous28.sessionCount).toBe(0);
    const ratio = calculateLoadRatio(
      calculateWindowTotals(sessions, currentWindow(now, 7)).resistanceGramReps,
      previous28.resistanceGramReps,
      previous28.sessionCount,
    );
    expect(ratio.status).toBe('no_baseline');
    expect(ratio.ratio).toBeNull();
  });

  it('uses start-of-local-day boundaries for week windows', () => {
    const now = Date.now();
    expect(currentWindow(now, 7).startMs).toBe(daysAgoMidnight(6));
    expect(previousWindow(now, 7).startMs).toBe(daysAgoMidnight(13));
    expect(startOfLocalDay(currentWindow(now, 7).startMs)).toBe(currentWindow(now, 7).startMs);
  });
});
