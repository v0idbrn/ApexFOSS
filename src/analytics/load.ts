/**
 * Pure training load calculations (Phase 2E).
 * Integer units only: resistance volume = gram-reps; duration work = ms.
 * Never fabricate tonnage for interval/timed sets — keep categories separate.
 * No React, no DB, no IO.
 */

export interface SetLoadInput {
  weightGrams: number | null;
  reps: number | null;
  durationMs: number | null;
  /** Optional distance (mm) — carried for records; not part of load math. */
  distanceMm?: number | null;
  isCompleted: boolean;
}

export interface SetLoad {
  /** weightGrams × reps when both present and completed; else 0. */
  resistanceGramReps: number;
  /** durationMs when present and completed; else 0. */
  durationMs: number;
  /** True when this set contributed resistance volume. */
  hasResistance: boolean;
  /** True when this set contributed duration work. */
  hasDuration: boolean;
}

export interface AggregateLoad {
  resistanceGramReps: number;
  durationMs: number;
  resistanceSetCount: number;
  durationSetCount: number;
  completedSetCount: number;
}

export interface ExerciseLoad extends AggregateLoad {
  exerciseName: string;
}

export interface SessionLoad extends AggregateLoad {
  sessionId: string;
  name: string;
  startedAt: number;
  endedAt: number | null;
  exerciseLoads: ExerciseLoad[];
}

export type DateRangeKind = 'today' | '7d' | '28d';

export interface DateRange {
  /** Inclusive start (local midnight semantics). */
  startMs: number;
  /** Exclusive end. */
  endMs: number;
  kind: DateRangeKind;
}

/** Start of local calendar day for timestamp ms. */
export function startOfLocalDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Local-calendar date window ending now.
 * - today: local midnight → now
 * - 7d: local midnight (today-6) → now (7 calendar days incl. today)
 * - 28d: local midnight (today-27) → now
 */
export function dateRange(kind: DateRangeKind, now: number): DateRange {
  const todayStart = startOfLocalDay(now);
  if (kind === 'today') {
    return { startMs: todayStart, endMs: now, kind };
  }
  const days = kind === '7d' ? 7 : 28;
  const d = new Date(todayStart);
  d.setDate(d.getDate() - (days - 1));
  return { startMs: d.getTime(), endMs: now, kind };
}

/** Compute load for a single set. Incomplete sets contribute nothing. */
export function calculateSetLoad(set: SetLoadInput): SetLoad {
  if (!set.isCompleted) {
    return { resistanceGramReps: 0, durationMs: 0, hasResistance: false, hasDuration: false };
  }
  const hasResistance = set.weightGrams !== null && set.reps !== null && set.weightGrams > 0 && set.reps > 0;
  const hasDuration = set.durationMs !== null && set.durationMs > 0;
  return {
    resistanceGramReps: hasResistance ? set.weightGrams! * set.reps! : 0,
    durationMs: hasDuration ? set.durationMs! : 0,
    hasResistance,
    hasDuration,
  };
}

function emptyAggregate(): AggregateLoad {
  return {
    resistanceGramReps: 0,
    durationMs: 0,
    resistanceSetCount: 0,
    durationSetCount: 0,
    completedSetCount: 0,
  };
}

function addToAggregate(agg: AggregateLoad, load: SetLoad, completed: boolean): void {
  if (!completed) return;
  agg.completedSetCount += 1;
  if (load.hasResistance) {
    agg.resistanceGramReps += load.resistanceGramReps;
    agg.resistanceSetCount += 1;
  }
  if (load.hasDuration) {
    agg.durationMs += load.durationMs;
    agg.durationSetCount += 1;
  }
}

/** Aggregate loads for one exercise (sets already keyed to that exercise). */
export function calculateExerciseLoad(exerciseName: string, sets: SetLoadInput[]): ExerciseLoad {
  const agg = emptyAggregate();
  for (const s of sets) {
    const load = calculateSetLoad(s);
    addToAggregate(agg, load, s.isCompleted);
  }
  return { ...agg, exerciseName };
}

export interface SessionLoadInput {
  sessionId: string;
  name: string;
  startedAt: number;
  endedAt: number | null;
  exercises: Array<{ exerciseName: string; sets: SetLoadInput[] }>;
}

/** Aggregate loads across a session's exercises. */
export function calculateSessionLoad(input: SessionLoadInput): SessionLoad {
  const agg = emptyAggregate();
  const exerciseLoads: ExerciseLoad[] = [];
  for (const ex of input.exercises) {
    const el = calculateExerciseLoad(ex.exerciseName, ex.sets);
    exerciseLoads.push(el);
    agg.resistanceGramReps += el.resistanceGramReps;
    agg.durationMs += el.durationMs;
    agg.resistanceSetCount += el.resistanceSetCount;
    agg.durationSetCount += el.durationSetCount;
    agg.completedSetCount += el.completedSetCount;
  }
  return {
    ...agg,
    sessionId: input.sessionId,
    name: input.name,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    exerciseLoads,
  };
}

export interface DatedSession {
  sessionId: string;
  name: string;
  /** Session completion timestamp used for range filter (endedAt preferred, else startedAt). */
  timestampMs: number;
  startedAt: number;
  endedAt: number | null;
  exercises: Array<{ exerciseName: string; sets: SetLoadInput[] }>;
}

/**
 * Aggregate loads across sessions whose completion timestamp falls in [range.startMs, range.endMs).
 * Uses local-calendar window from dateRange().
 */
export function calculateDateRangeLoad(sessions: DatedSession[], range: DateRange): AggregateLoad {
  const agg = emptyAggregate();
  for (const s of sessions) {
    if (s.timestampMs < range.startMs || s.timestampMs >= range.endMs) continue;
    const sl = calculateSessionLoad({
      sessionId: s.sessionId,
      name: s.name,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      exercises: s.exercises,
    });
    agg.resistanceGramReps += sl.resistanceGramReps;
    agg.durationMs += sl.durationMs;
    agg.resistanceSetCount += sl.resistanceSetCount;
    agg.durationSetCount += sl.durationSetCount;
    agg.completedSetCount += sl.completedSetCount;
  }
  return agg;
}

/** Display helper: gram-reps → kg·reps (integer-ish, one decimal via round). */
export function gramRepsToKgReps(gramReps: number): number {
  return Math.round(gramReps / 100) / 10;
}

/** Display helper: ms → seconds (integer). */
export function msToSeconds(ms: number): number {
  return Math.round(ms / 1000);
}
