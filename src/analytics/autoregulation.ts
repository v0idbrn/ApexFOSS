/**
 * Deterministic RIR-based autoregulation (Phase 2E).
 * Pure policy: given prescription target RIR and last set actual RIR,
 * recommend next-set load adjustment. Never mutates routine definition
 * or session snapshots — runtime ephemeral prescription state only.
 * No React, no DB, no IO.
 */

export interface AutoregConfig {
  /** Master enable. When false, always returns recommendation with delta 0. */
  enabled: boolean;
  /** Prescription target RIR (null = no target → no adjustment). */
  targetRir: number | null;
  /** Max absolute adjustment per set (grams). Default 2500 (2.5 kg). */
  stepGrams: number;
  /** Clamp lower bound for recommended weight (grams). */
  minWeightGrams: number;
  /** Clamp upper bound (grams). */
  maxWeightGrams: number;
}

export const DEFAULT_AUTOREG_CONFIG: AutoregConfig = {
  enabled: false,
  targetRir: null,
  stepGrams: 2500,
  minWeightGrams: 0,
  maxWeightGrams: 500_000,
};

export type AutoregDirection = 'hold' | 'increase' | 'decrease';

export interface AutoregRecommendation {
  direction: AutoregDirection;
  /** Signed adjustment to apply to current prescription weight (grams). */
  deltaGrams: number;
  /** Recommended next-set weight after clamp (grams). */
  recommendedWeightGrams: number;
  /** Current prescription weight before adjustment (grams). */
  currentWeightGrams: number;
  /** Reason code for UI/debug. */
  reason:
    | 'disabled'
    | 'no_target_rir'
    | 'no_current_weight'
    | 'invalid_actual_rir'
    | 'at_target'
    | 'below_target'
    | 'above_target'
    | 'clamped_min'
    | 'clamped_max';
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Recommend next-set load from last set's actual RIR vs target.
 *
 * Rules (deterministic, documented):
 * - disabled / no targetRir / no current weight / invalid actualRir → hold (delta 0).
 * - actualRir === targetRir → hold.
 * - actualRir < targetRir (hit harder than target, fewer reps in reserve) → increase by stepGrams.
 * - actualRir > targetRir (more reserve than target) → decrease by stepGrams.
 * - Result clamped to [minWeightGrams, maxWeightGrams]; clamp reason overrides.
 */
export function recommendNextLoad(
  currentWeightGrams: number | null,
  actualRir: number | null,
  config: AutoregConfig,
): AutoregRecommendation {
  const base: AutoregRecommendation = {
    direction: 'hold',
    deltaGrams: 0,
    recommendedWeightGrams: currentWeightGrams ?? 0,
    currentWeightGrams: currentWeightGrams ?? 0,
    reason: 'disabled',
  };

  if (!config.enabled) return { ...base, reason: 'disabled' };
  if (config.targetRir === null) return { ...base, reason: 'no_target_rir' };
  if (currentWeightGrams === null || currentWeightGrams <= 0) return { ...base, reason: 'no_current_weight' };
  if (actualRir === null || !Number.isFinite(actualRir) || actualRir < 0) {
    return { ...base, currentWeightGrams, recommendedWeightGrams: currentWeightGrams, reason: 'invalid_actual_rir' };
  }

  const target = config.targetRir;
  let direction: AutoregDirection = 'hold';
  let delta = 0;
  let reason: AutoregRecommendation['reason'] = 'at_target';

  if (actualRir < target) {
    direction = 'increase';
    delta = Math.abs(config.stepGrams);
    reason = 'below_target';
  } else if (actualRir > target) {
    direction = 'decrease';
    delta = -Math.abs(config.stepGrams);
    reason = 'above_target';
  }

  const raw = currentWeightGrams + delta;
  const clamped = clamp(raw, config.minWeightGrams, config.maxWeightGrams);
  let finalReason: AutoregRecommendation['reason'] = reason;
  if (clamped !== raw) {
    finalReason = clamped === config.minWeightGrams ? 'clamped_min' : 'clamped_max';
    if (clamped === currentWeightGrams) {
      direction = 'hold';
      delta = 0;
    } else {
      delta = clamped - currentWeightGrams;
      direction = delta > 0 ? 'increase' : 'decrease';
    }
  }

  return {
    direction,
    deltaGrams: delta,
    recommendedWeightGrams: clamped,
    currentWeightGrams,
    reason: finalReason,
  };
}

/** Runtime adjustment state held in WorkoutScreen (ephemeral, not persisted). */
export interface AutoregRuntime {
  config: AutoregConfig;
  /** Last recommendation applied for current step (for UI display). */
  lastRecommendation: AutoregRecommendation | null;
}

export function idleAutoregRuntime(config: AutoregConfig = DEFAULT_AUTOREG_CONFIG): AutoregRuntime {
  return { config, lastRecommendation: null };
}
