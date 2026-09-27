import type { DatedSession } from './load';
import { estimate1rmGrams } from './records';

/**
 * Deterministic performance-trend / plateau signals (Phase 3D).
 * Descriptive interpretation of logged history only — no prediction, no
 * health or fatigue diagnosis, no coaching. A plateau is reported only when
 * the evidence clears the sample gate; otherwise INSUFFICIENT_DATA.
 * No React, no DB, no IO.
 */

/** Comparable sessions required before any trend/plateau signal is emitted. */
export const MIN_TREND_SAMPLES = 4;
/** |Δ%| at or below this counts as stable (plateau candidate). */
export const PLATEAU_TOLERANCE_PCT = 1;

export interface PerformancePoint {
  timestampMs: number;
  /** Best positive estimated 1RM (grams) recorded in one session. */
  estimated1rmGrams: number;
}

export type TrendStatus = 'improving' | 'declining' | 'stable' | 'insufficient_data';

export type TrendReason = 'INSUFFICIENT_HISTORY' | 'E1RM_INCREASED' | 'E1RM_DECREASED' | 'E1RM_STABLE';

export interface TrendEvidence {
  status: TrendStatus;
  reason: TrendReason;
  /** True only when evidence is sufficient AND the best e1RM held steady. */
  plateau: boolean;
  /** Best e1RM of the earlier half; null when unavailable. */
  baselineE1rmGrams: number | null;
  /** Best e1RM of the recent half; null when unavailable. */
  recentE1rmGrams: number | null;
  /** recent − baseline (grams); null when either side is unavailable. */
  deltaGrams: number | null;
  /** Percent change (1 decimal); null when baseline missing or zero. */
  deltaPct: number | null;
  /** Comparable sessions contributing points. */
  sampleCount: number;
  /** Deterministic English explanation (UI localizes by `reason`). */
  explanation: string;
}

/**
 * Exercise identity (strict): two rows with different valid ids are NEVER the
 * same exercise, even when names match. Name fallback applies only when one
 * side lacks a valid id.
 */
export function sameExercise(
  row: { exerciseName: string; exerciseId?: string | null },
  exerciseId: string | null,
  exerciseName: string,
): boolean {
  if (exerciseId !== null && row.exerciseId != null) return row.exerciseId === exerciseId;
  return row.exerciseName === exerciseName;
}

/**
 * Best estimated 1RM per completed session for one exercise, oldest first.
 * Completed positive-resistance sets only; sessions without a valid estimate
 * for the exercise contribute no point.
 */
export function e1rmSeries(
  sessions: DatedSession[],
  exerciseId: string | null,
  exerciseName: string,
): PerformancePoint[] {
  const points: PerformancePoint[] = [];
  for (const session of sessions) {
    let best: number | null = null;
    for (const exercise of session.exercises) {
      if (!sameExercise(exercise, exerciseId, exerciseName)) continue;
      for (const set of exercise.sets) {
        if (!set.isCompleted) continue;
        const weight = set.weightGrams ?? 0;
        const reps = set.reps ?? 0;
        if (weight <= 0 || reps <= 0) continue;
        const est = estimate1rmGrams(weight, reps);
        if (est !== null && est > 0 && (best === null || est > best)) best = est;
      }
    }
    if (best !== null) points.push({ timestampMs: session.timestampMs, estimated1rmGrams: best });
  }
  points.sort((a, b) => a.timestampMs - b.timestampMs);
  return points;
}

function bestOf(points: PerformancePoint[]): number | null {
  let best: number | null = null;
  for (const p of points) {
    if (p.estimated1rmGrams > 0 && (best === null || p.estimated1rmGrams > best)) best = p.estimated1rmGrams;
  }
  return best;
}

/**
 * Split the series into earlier/recent halves (deterministic floor split) and
 * describe the movement of the best estimated 1RM. Status gates at
 * MIN_TREND_SAMPLES; below that the verdict is always insufficient — a
 * plateau is never manufactured from thin evidence.
 */
export function describeE1rmTrend(rawPoints: PerformancePoint[]): TrendEvidence {
  const points = rawPoints
    .filter((p) => Number.isFinite(p.timestampMs) && Number.isFinite(p.estimated1rmGrams) && p.estimated1rmGrams > 0)
    .slice()
    .sort((a, b) => a.timestampMs - b.timestampMs);
  const n = points.length;
  const mid = Math.floor(n / 2);
  const baselineE1rmGrams = bestOf(points.slice(0, mid));
  const recentE1rmGrams = bestOf(points.slice(mid));
  const deltaGrams =
    baselineE1rmGrams !== null && recentE1rmGrams !== null ? recentE1rmGrams - baselineE1rmGrams : null;
  const deltaPct =
    deltaGrams !== null && baselineE1rmGrams !== null && baselineE1rmGrams > 0
      ? Math.round((deltaGrams / baselineE1rmGrams) * 1000) / 10
      : null;

  const base = {
    baselineE1rmGrams,
    recentE1rmGrams,
    deltaGrams,
    deltaPct,
    sampleCount: n,
  };

  if (n < MIN_TREND_SAMPLES || deltaPct === null) {
    return {
      ...base,
      status: 'insufficient_data',
      reason: 'INSUFFICIENT_HISTORY',
      plateau: false,
      explanation: `Found ${n} comparable session(s); at least ${MIN_TREND_SAMPLES} are needed for a trend signal.`,
    };
  }
  if (Math.abs(deltaPct) <= PLATEAU_TOLERANCE_PCT) {
    return {
      ...base,
      status: 'stable',
      reason: 'E1RM_STABLE',
      plateau: true,
      explanation: `Best estimated 1RM is within ${PLATEAU_TOLERANCE_PCT}% of the earlier baseline across ${n} sessions.`,
    };
  }
  if (deltaPct > 0) {
    return {
      ...base,
      status: 'improving',
      reason: 'E1RM_INCREASED',
      plateau: false,
      explanation: `Recent best estimated 1RM is ${deltaPct}% above the earlier baseline across ${n} sessions.`,
    };
  }
  return {
    ...base,
    status: 'declining',
    reason: 'E1RM_DECREASED',
    plateau: false,
    explanation: `Recent best estimated 1RM is ${Math.abs(deltaPct)}% below the earlier baseline across ${n} sessions.`,
  };
}
