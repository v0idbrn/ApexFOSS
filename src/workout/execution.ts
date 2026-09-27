import type { ExecutionType, OverrideReason, Prescription, SetPayload } from '../types/engine';

/**
 * Adaptive execution helpers (Phase 3C): prescription ≠ actual performance.
 * Pure functions over plain data — no React, no DB, no IO. The prescription
 * snapshot is never mutated here; classification only *reads* both sides.
 */

export const EXECUTION_TYPES: readonly ExecutionType[] = [
  'normal',
  'modified',
  'extra',
  'drop',
  'skipped',
];

export const OVERRIDE_REASONS: readonly OverrideReason[] = [
  'load_reduced',
  'load_increased',
  'reps_reduced',
  'reps_increased',
  'fatigue',
  'pain_discomfort',
  'equipment_unavailable',
  'time_constraint',
  'other',
];

/** Closed-vocabulary guard for persisted execution types (unknown → null, never crash). */
export function normalizeExecutionType(value: unknown): ExecutionType | null {
  return (EXECUTION_TYPES as readonly unknown[]).includes(value) ? (value as ExecutionType) : null;
}

/** Closed-vocabulary guard for athlete-stated reasons (unknown → null, never invent). */
export function normalizeOverrideReason(value: unknown): OverrideReason | null {
  return (OVERRIDE_REASONS as readonly unknown[]).includes(value) ? (value as OverrideReason) : null;
}

function valuesDiffer(actual: number | null | undefined, target: number | null | undefined): boolean {
  const a = actual ?? null;
  const t = target ?? null;
  if (a === null && t === null) return false;
  if (a === null || t === null) return true;
  return a !== t;
}

/**
 * Classify a performed set against its prescription.
 * Compares weight / reps / duration / RIR only: distance has no prescription
 * target and tempo actuals are not measured. Extra/drop/skipped classification
 * is positional (set count), never inferred here.
 */
export function classifySetExecution(
  prescription: Pick<Prescription, 'targetWeightGrams' | 'targetRepsMin' | 'targetRepsMax' | 'targetDurationMs' | 'targetRir'> | null | undefined,
  actual: Pick<SetPayload, 'weightGrams' | 'reps' | 'durationMs' | 'rir'>,
): 'normal' | 'modified' {
  if (!prescription) return 'normal';
  // A rep range prescribes an interval: any achieved reps inside [min, max]
  // matches; outside counts as modified. No rep target at all → no deviation.
  const min = prescription.targetRepsMin ?? null;
  const max = prescription.targetRepsMax ?? null;
  const reps = actual.reps ?? null;
  const repsDiffer =
    min === null && max === null
      ? false
      : reps === null
        ? true
        : (min !== null && reps < min) || (max !== null && reps > max);
  if (repsDiffer) return 'modified';
  if (valuesDiffer(actual.weightGrams, prescription.targetWeightGrams)) return 'modified';
  if (valuesDiffer(actual.durationMs, prescription.targetDurationMs)) return 'modified';
  if (valuesDiffer(actual.rir, prescription.targetRir)) return 'modified';
  return 'normal';
}

