import { calculateSetLoad, type DatedSession } from './load';
import { currentWindow, dayWindow, calculateWindowTotals, type DayWindow } from './trends';

/**
 * Rolling training summaries and descriptive statistics (Phase 2J §11).
 * Neutral math only — no risk, health or readiness interpretation of any kind.
 * Every output is explainable from its inputs (§21). No React, no DB, no IO.
 */

export interface RollingSummary {
  days: number;
  windowStartMs: number;
  windowEndMs: number;
  sessionCount: number;
  /** Sum of weight×reps across completed sets in the window. */
  resistanceGramReps: number;
  /** Sum of timed-set work in the window. */
  durationMs: number;
  /** Sum of wall-clock session durations (endedAt − startedAt). */
  wallMs: number;
  completedSetCount: number;
  /** completedSetCount ÷ sessionCount; null when no sessions. */
  avgSetsPerSession: number | null;
  /** resistanceGramReps ÷ completed resistance sets; null when none. */
  avgLoadPerSetGramReps: number | null;
  /** sessionCount scaled to a 7-day rate; null when the window has none. */
  sessionsPerWeek: number | null;
  /** resistanceGramReps per wall-clock minute; null without wall time. */
  densityGramRepsPerMinute: number | null;
}

function wallDurationOf(session: DatedSession): number {
  if (session.endedAt === null || session.endedAt < session.startedAt) return 0;
  return session.endedAt - session.startedAt;
}

/** Rolling `days`-day descriptive summary (local-calendar window, current window). */
export function rollingSummary(sessions: DatedSession[], now: number, days: number): RollingSummary {
  const window = currentWindow(now, days);
  const totals = calculateWindowTotals(sessions, window);
  let wallMs = 0;
  for (const s of sessions) {
    if (s.timestampMs < window.startMs || s.timestampMs >= window.endMs) continue;
    wallMs += wallDurationOf(s);
  }
  return summarize(days, window, totals.sessionCount, totals.resistanceGramReps, totals.durationMs, wallMs, totals.completedSetCount);
}

function summarize(
  days: number,
  window: DayWindow,
  sessionCount: number,
  resistanceGramReps: number,
  durationMs: number,
  wallMs: number,
  completedSetCount: number,
): RollingSummary {
  const avgSetsPerSession = sessionCount > 0 ? Math.round((completedSetCount / sessionCount) * 10) / 10 : null;
  const avgLoadPerSetGramReps = completedSetCount > 0 ? Math.round(resistanceGramReps / completedSetCount) : null;
  const sessionsPerWeek = sessionCount > 0 ? Math.round((sessionCount * (7 / days)) * 10) / 10 : null;
  const densityGramRepsPerMinute =
    wallMs > 0 && resistanceGramReps > 0 ? Math.round(resistanceGramReps / (wallMs / 60_000)) : null;
  return {
    days,
    windowStartMs: window.startMs,
    windowEndMs: window.endMs,
    sessionCount,
    resistanceGramReps,
    durationMs,
    wallMs,
    completedSetCount,
    avgSetsPerSession,
    avgLoadPerSetGramReps,
    sessionsPerWeek,
    densityGramRepsPerMinute,
  };
}

export interface WeeklyPoint {
  /** Local midnight of the first day of the week bucket. */
  weekStartMs: number;
  sessionCount: number;
  resistanceGramReps: number;
  wallMs: number;
}

/**
 * Weekly buckets oldest → newest. Bucket i is the 7-day local window ending
 * `7 × i` days ago (same window math as trends.ts — no overlapping windows).
 */
export function weeklySeries(sessions: DatedSession[], now: number, weeks: number): WeeklyPoint[] {
  const points: WeeklyPoint[] = [];
  const count = Math.max(1, Math.floor(weeks));
  for (let i = count - 1; i >= 0; i--) {
    const window = dayWindow(now, 7, 7 * i); // i=0 → current 7 days, i=1 → the 7 before, …
    const totals = calculateWindowTotals(sessions, window);
    let wallMs = 0;
    for (const s of sessions) {
      if (s.timestampMs < window.startMs || s.timestampMs >= window.endMs) continue;
      wallMs += wallDurationOf(s);
    }
    points.push({
      weekStartMs: window.startMs,
      sessionCount: totals.sessionCount,
      resistanceGramReps: totals.resistanceGramReps,
      wallMs,
    });
  }
  return points;
}

export interface DescriptiveDelta {
  current: number;
  previous: number;
  /** current − previous. */
  delta: number;
  /** Percent change; null when previous is 0 (never Infinity/NaN). */
  percentChange: number | null;
}

/** Descriptive percent/absolute change between two same-kind metrics. */
export function descriptiveDelta(current: number, previous: number): DescriptiveDelta {
  const safeCurrent = Number.isFinite(current) ? current : 0;
  const safePrevious = Number.isFinite(previous) ? previous : 0;
  const delta = safeCurrent - safePrevious;
  const percentChange = safePrevious > 0 ? Math.round((delta / safePrevious) * 1000) / 10 : null;
  return { current: safeCurrent, previous: safePrevious, delta, percentChange };
}

export interface DurationStats {
  sessionCount: number;
  /** Average wall-clock session duration in ms; null without sessions. */
  avgMs: number | null;
  minMs: number | null;
  maxMs: number | null;
}

/** Wall-clock session duration stats within a window (local calendar). */
export function durationStats(sessions: DatedSession[], window: DayWindow): DurationStats {
  const durations: number[] = [];
  for (const s of sessions) {
    if (s.timestampMs < window.startMs || s.timestampMs >= window.endMs) continue;
    if (s.endedAt === null || s.endedAt < s.startedAt) continue;
    durations.push(s.endedAt - s.startedAt);
  }
  if (durations.length === 0) return { sessionCount: 0, avgMs: null, minMs: null, maxMs: null };
  let min = durations[0];
  let max = durations[0];
  let sum = 0;
  for (const d of durations) {
    if (d < min) min = d;
    if (d > max) max = d;
    sum += d;
  }
  return { sessionCount: durations.length, avgMs: Math.round(sum / durations.length), minMs: min, maxMs: max };
}

/** Per-exercise completed-set history sorted oldest → newest (basis for PR scans). */
export interface ExerciseHistoryEntry {
  timestampMs: number;
  sessionId: string;
  weightGrams: number | null;
  reps: number | null;
  durationMs: number | null;
  distanceMm: number | null;
  isCompleted: boolean;
}

/** Flatten one session's sets for a named exercise into history entries. */
export function setsForExercise(
  session: DatedSession,
  exerciseName: string,
): ExerciseHistoryEntry[] {
  const out: ExerciseHistoryEntry[] = [];
  for (const ex of session.exercises) {
    if (ex.exerciseName !== exerciseName) continue;
    for (const set of ex.sets) {
      const load = calculateSetLoad(set);
      out.push({
        timestampMs: session.timestampMs,
        sessionId: session.sessionId,
        weightGrams: set.weightGrams,
        reps: set.reps,
        durationMs: set.durationMs,
        distanceMm: (set as typeof set & { distanceMm?: number | null }).distanceMm ?? null,
        isCompleted: load.hasResistance || load.hasDuration,
      });
    }
  }
  return out;
}
