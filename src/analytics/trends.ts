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
