/**
 * Pure training-load trend windows and descriptive comparisons (Phase 2F).
 * Local-calendar windows (spec §16): current and previous windows never
 * overlap; the chronic baseline window excludes the current acute week.
 * Neutral descriptive math only — no risk interpretation of any kind.
 * No React, no DB, no IO.
 */
import { calculateSetLoad, startOfLocalDay, type DatedSession } from './load';

export interface DayWindow {
  /** Inclusive start (local midnight). */
  startMs: number;
  /** Exclusive end (local midnight one day after the last included day). */
  endMs: number;
  days: number;
}

/**
 * Local-calendar window of `days` days ending `endOffsetDays` days ago.
 * - endOffsetDays = 0 → current window (includes today),
 * - endOffsetDays = days → equally long window immediately before it.
 */
export function dayWindow(now: number, days: number, endOffsetDays = 0): DayWindow {
  const todayStart = startOfLocalDay(now);
  const start = new Date(todayStart);
  start.setDate(start.getDate() - endOffsetDays - (days - 1));
  const end = new Date(todayStart);
  end.setDate(end.getDate() - endOffsetDays + 1);
  return { startMs: start.getTime(), endMs: end.getTime(), days };
}

/** Current window: today + the preceding (days − 1) local calendar days. */
export function currentWindow(now: number, days: number): DayWindow {
  return dayWindow(now, days, 0);
}

/** Previous window: the `days` local calendar days immediately before the current window. */
export function previousWindow(now: number, days: number): DayWindow {
  return dayWindow(now, days, days);
}

export interface WindowTotals {
  resistanceGramReps: number;
  durationMs: number;
  resistanceSetCount: number;
  durationSetCount: number;
  completedSetCount: number;
  sessionCount: number;
}

/** Sum load for sessions whose completion timestamp falls inside the window. */
export function calculateWindowTotals(sessions: DatedSession[], window: DayWindow): WindowTotals {
  const totals: WindowTotals = {
    resistanceGramReps: 0,
    durationMs: 0,
    resistanceSetCount: 0,
    durationSetCount: 0,
    completedSetCount: 0,
    sessionCount: 0,
  };
  for (const session of sessions) {
    if (session.timestampMs < window.startMs || session.timestampMs >= window.endMs) continue;
    totals.sessionCount += 1;
    for (const exercise of session.exercises) {
      for (const set of exercise.sets) {
        if (!set.isCompleted) continue;
        const load = calculateSetLoad(set);
        totals.completedSetCount += 1;
        if (load.hasResistance) {
          totals.resistanceGramReps += load.resistanceGramReps;
          totals.resistanceSetCount += 1;
        }
        if (load.hasDuration) {
          totals.durationMs += load.durationMs;
          totals.durationSetCount += 1;
        }
      }
    }
  }
  return totals;
}

export interface WindowComparison {
  current: WindowTotals;
  previous: WindowTotals;
  /** current − previous resistance load, in gram-reps. */
  absoluteChange: number;
  /** Percent change of resistance load; null when the previous window has none. */
  percentChange: number | null;
}

/** Descriptive comparison of two windows (resistance load basis). */
export function compareWindows(current: WindowTotals, previous: WindowTotals): WindowComparison {
  const absoluteChange = current.resistanceGramReps - previous.resistanceGramReps;
  const percentChange =
    previous.resistanceGramReps > 0
      ? Math.round((absoluteChange / previous.resistanceGramReps) * 1000) / 10
      : null;
  return { current, previous, absoluteChange, percentChange };
}

export type LoadRatioStatus = 'ok' | 'no_baseline' | 'zero_baseline';

export interface LoadRatio {
  status: LoadRatioStatus;
  /** acute (current 7d) ÷ chronic (previous 28d ÷ 4), rounded to 2 decimals; null when unavailable. */
  ratio: number | null;
  /** Total resistance load of the current 7-day window (gram-reps). */
  acuteWeeklyGramReps: number;
  /** Average weekly baseline: previous 28 days ÷ 4 (gram-reps); null without baseline sessions. */
  chronicWeeklyGramReps: number | null;
  acuteDays: number;
  chronicDays: number;
}

/**
 * Descriptive 7d / 28d training-load ratio (ACWR-style arithmetic only —
 * no interpretation, zones, colors or claims of any kind).
 *
 * - Chronic baseline uses ONLY the previous 28 days and never includes the
 *   current acute week.
 * - No completed sessions in the baseline → 'no_baseline' (insufficient baseline).
 * - Baseline sessions without resistance load → 'zero_baseline'.
 * - ratio is always finite or null — never Infinity/NaN.
 */
export function calculateLoadRatio(
  current7GramReps: number,
  previous28GramReps: number,
  previous28SessionCount: number,
): LoadRatio {
  const acuteWeeklyGramReps =
    Number.isFinite(current7GramReps) && current7GramReps > 0 ? Math.round(current7GramReps) : 0;
  const base = { acuteWeeklyGramReps, acuteDays: 7, chronicDays: 28 };

  if (!Number.isFinite(previous28SessionCount) || previous28SessionCount <= 0) {
    return { ...base, status: 'no_baseline', ratio: null, chronicWeeklyGramReps: null };
  }
  const previousTotal = Number.isFinite(previous28GramReps) ? previous28GramReps : 0;
  if (previousTotal <= 0) {
    return { ...base, status: 'zero_baseline', ratio: null, chronicWeeklyGramReps: 0 };
  }

  const chronicWeekly = previousTotal / 4;
  const ratio = acuteWeeklyGramReps / chronicWeekly;
  if (!Number.isFinite(ratio)) {
    return { ...base, status: 'zero_baseline', ratio: null, chronicWeeklyGramReps: Math.round(chronicWeekly) };
  }
  return {
    ...base,
    status: 'ok',
    ratio: Math.round(ratio * 100) / 100,
    chronicWeeklyGramReps: Math.round(chronicWeekly),
  };
}
