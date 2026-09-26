/**
 * Deterministic Progression Engine (Phase 3A).
 *
 * Analyzes comparable historical performances against current prescription
 * to determine progression opportunity using double-progression logic.
 *
 * Pure TypeScript — no React, no DB, no IO, no network.
 * All units: grams, milliseconds, millimeters, integer timestamps.
 */
import {
  type SetLoadInput,
  type DatedSession,
  calculateSetLoad,
} from './load';
import { estimate1rmGrams } from './records';
import { rankSubstitutions, type SubstitutionExercise } from './substitutions';
import { equipmentClassOf } from './substitutions';

/** Prescription target for an exercise (mirrors types/engine.ts Prescription). */
export interface PrescriptionTarget {
  targetRepsMin: number | null;
  targetRepsMax: number | null;
  targetWeightGrams: number | null;
  targetRir: number | null;
  /** Tempo spec from prescription. */
  tempo?: {
    eccentricMs: number | null;
    pauseBottomMs: number | null;
    concentricMs: number | null;
    pauseTopMs: number | null;
  } | null;
}

/** Single completed set performance with context. */
export interface SetPerformance {
  /** The exercise name as logged in the session. */
  exerciseName: string;
  /** Stable exercise identity when available (seed id). */
  exerciseId: string | null;
  /** Session completion timestamp. */
  timestampMs: number;
  /** Session ID for traceability. */
  sessionId: string;
  /** Actual logged values. */
  weightGrams: number;
  reps: number;
  /** Actual RIR logged (null if not recorded). */
  actualRir: number | null;
  /** Actual tempo used (null if not recorded). */
  actualTempo: {
    eccentricMs: number | null;
    pauseBottomMs: number | null;
    concentricMs: number | null;
    pauseTopMs: number | null;
  } | null;
  /** Equipment class at time of performance. */
  equipmentClass: string;
  /** Whether this was a substitution (not the original prescribed exercise). */
  isSubstitution: boolean;
  /** Prescription target at time of performance. */
  prescription: PrescriptionTarget;
  /** Estimated 1RM for this set (Epley). */
  estimated1rmGrams: number | null;
}

/** Evidence about why two performances are/aren't comparable. */
export interface ComparabilityEvidence {
  /** Overall comparability verdict. */
  comparable: boolean;
  /** Reason code if not comparable. */
  reason?: ComparabilityReason;
  /** Specific mismatches found. */
  mismatches: ComparabilityMismatch[];
  /** Exercise identity match type. */
  identityMatch: 'seed_id' | 'record_key' | 'name_only' | 'none';
  /** Whether prescription targets match. */
  prescriptionMatch: boolean;
  /** Whether equipment class matches. */
  equipmentMatch: boolean;
  /** Whether both have RIR data. */
  rirAvailable: boolean;
  /** Whether both have tempo data. */
  tempoAvailable: boolean;
}

/** Historical prescription targets recorded for a session exercise
 *  (from the immutable definition_json snapshot). Shape = PrescriptionTarget:
 *  it IS a prescription target, just one that was recorded historically. */
export type HistoricalPrescription = PrescriptionTarget;

/** Per-session, per-exercise prescription context used for comparability.
 *  Keyed by `${sessionId}|${exerciseName}` in AnalyzeProgressionInput. */
export interface SessionExercisePrescription {
  exerciseName: string;
  exerciseId: string | null;
  prescription: HistoricalPrescription;
  equipmentClass: string;
  /** True when this logged exercise was a substitute, not the prescribed one. */
  isSubstitution: boolean;
}

/** Reason why performances are not comparable. */
export type ComparabilityReason =
  | 'different_exercise'
  | 'current_substitution'
  | 'previous_substitution'
  | 'different_equipment_class'
  | 'prescription_mismatch'
  | 'missing_rir_both'
  | 'incomplete_data';

/** Specific mismatch detail. */
export interface ComparabilityMismatch {
  field: 'exercise' | 'equipment' | 'prescription' | 'rir' | 'tempo';
  expected: string;
  actual: string;
}

/** Result of double-progression evaluation. */
export type ProgressionState =
  | 'progress'
  | 'maintain'
  | 'insufficient_data';

/** Reason codes for progression decisions (stable, localizable keys). */
export type ProgressionReason =
  | 'REPS_RANGE_COMPLETED'           // reached upper bound of rep range
  | 'REPS_EXCEEDED_RANGE'            // exceeded upper bound
  | 'REPS_BELOW_MIN'                 // below minimum reps
  | 'REPS_IN_RANGE'                  // inside range, no progression
  | 'INSUFFICIENT_HISTORY'           // < 2 comparable performances
  | 'NO_COMPARABLE_PERFORMANCE'      // zero comparable performances
  | 'PRESCRIPTION_MISMATCH'          // current prescription differs from history
  | 'NO_REPS_RANGE'                  // prescription lacks min/max reps
  | 'NO_CURRENT_WEIGHT'              // current prescription weight missing
  | 'NO_RIR_DATA'                    // RIR data missing for autoreg context
  | 'SUBSTITUTION_USED'              // latest performance was a substitution
  | 'PREVIOUS_SUBSTITUTION'          // historical performance was a substitution
  | 'EQUIPMENT_MISMATCH'             // equipment class differs
  | 'TEMPO_MISMATCH';                // tempo differs

/** Evidence supporting a progression decision. */
export interface ProgressionEvidence {
  /** The progression state. */
  state: ProgressionState;
  /** Stable reason code for UI localization. */
  reason: ProgressionReason;
  /** Human-readable explanation for debugging (not for UI). */
  explanation: string;
  /** The comparable historical performance used as baseline. */
  baseline?: SetPerformance;
  /** The current/latest performance being evaluated. */
  current?: SetPerformance;
  /** Number of comparable performances in history. */
  comparableCount: number;
  /** Current prescription target. */
  currentPrescription: PrescriptionTarget;
  /** Comparability evidence between current and baseline. */
  comparability?: ComparabilityEvidence;
  /** Whether the current weight was at target. */
  atTargetWeight: boolean;
  /** Reps achieved vs prescribed range. */
  repsVsRange: {
    achieved: number;
    min: number | null;
    max: number | null;
  };
  /** Weight progression opportunity (grams) if a data-derived increment exists. */
  suggestedWeightGrams?: number;
  /** Provenance of the increment. 'none' = no reliable source: the opportunity
   *  is real but the engine refuses to invent a step (UI should ask the athlete). */
  weightIncrementSource?: 'equipment_inventory' | 'none';
}

/** Input for progression analysis. */
export interface AnalyzeProgressionInput {
  /** Exercise name to analyze. */
  exerciseName: string;
  /** Stable exercise ID when available. */
  exerciseId: string | null;
  /** All completed sessions (from loadAnalyticsSnapshot). */
  sessions: DatedSession[];
  /** Current prescription target for this exercise. */
  currentPrescription: PrescriptionTarget;
  /** Current equipment class for this exercise. */
  currentEquipmentClass: string;
  /** Current exercise ID for identity matching. */
  currentExerciseId: string | null;
  /** Historical prescriptions per session per exercise for this exercise.
   *  Key: `${sessionId}|${exerciseName}`. Provided by caller from session definition_json snapshots.
   */
  historicalPrescriptions?: Map<string, SessionExercisePrescription>;
  /** Available exercises for substitution context. */
  availableExercises?: SubstitutionExercise[];
  /** Now timestamp for window calculations. */
  now: number;
  /** Caller-derived next achievable weight for this exercise (grams), computed from
   *  REAL data — e.g. the persistent equipment inventory (schema v4, src/data/equipment.ts)
   *  resolved through solveLoadInventory (src/analytics/inventory.ts).
   *  The engine NEVER invents increments: when absent/null/not greater than the current
   *  target weight, no suggestion is made and the progression opportunity is still
   *  reported with weightIncrementSource 'none'. */
  achievableNextWeightGrams?: number | null;
}

/**
 * Extract all completed set performances for a given exercise from sessions.
 * Uses current prescription as fallback for historical prescription (assumes prescription unchanged).
 */
/**
 * Extract all completed set performances for a given exercise from sessions.
 * Uses historical prescriptions when available, falls back to current prescription.
 */
function extractPerformances(
  sessions: DatedSession[],
  exerciseName: string,
  exerciseId: string | null,
  currentEquipmentClass: string,
  currentPrescription: PrescriptionTarget,
  historicalPrescriptions?: Map<string, SessionExercisePrescription>,
  availableExercises?: SubstitutionExercise[],
): SetPerformance[] {
  const performances: SetPerformance[] = [];

  // Build substitution lookup for this exercise
  const substitutionNames = new Set<string>();
  if (availableExercises && availableExercises.length > 0) {
    const targetEx: SubstitutionExercise = {
      id: exerciseId,
      name: exerciseName,
      category: '',
      equipment: '',
      metricFlags: 0,
      contributions: null,
    };
    const ranked = rankSubstitutions(targetEx, availableExercises, { limit: 10 });
    for (const r of ranked) {
      substitutionNames.add(r.exercise.name);
    }
  }

  for (const session of sessions) {
    for (const exercise of session.exercises) {
      // Include by exact name OR by matching stable ID (an exercise may be
      // displayed under a different name across versions). Identity quality is
      // judged later by checkComparability — inclusion here is deliberately broad.
      const isTarget =
        exercise.exerciseName === exerciseName ||
        (exerciseId !== null && exercise.exerciseId === exerciseId);
      const isSub = substitutionNames.has(exercise.exerciseName);

      // Get historical prescription for this specific exercise in this session
      const histKey = `${session.sessionId}|${exercise.exerciseName}`;
      const histPresc = historicalPrescriptions?.get(histKey);
      const histIsSub = histPresc?.isSubstitution ?? false;

      // Include if it's the target exercise, a known substitution, or marked as substitution in historical data
      if (!isTarget && !isSub && !histIsSub) continue;

      const equipmentClass = histPresc?.equipmentClass ?? currentEquipmentClass;
      const isSubstitution = histPresc?.isSubstitution ?? isSub;
      const prescription = histPresc?.prescription ?? currentPrescription;

      for (const set of exercise.sets) {
        if (!set.isCompleted) continue;
        const load = calculateSetLoad(set);
        if (!load.hasResistance) continue;

        const weightGrams = set.weightGrams ?? 0;
        const reps = set.reps ?? 0;
        if (weightGrams <= 0 || reps <= 0) continue;

        performances.push({
          exerciseName: exercise.exerciseName,
          exerciseId: exercise.exerciseId ?? null,
          timestampMs: session.timestampMs,
          sessionId: session.sessionId,
          weightGrams,
          reps,
          actualRir: null, // Not available in SetLoadInput currently
          actualTempo: null, // Not available in SetLoadInput currently
          equipmentClass,
          isSubstitution,
          prescription,
          estimated1rmGrams: estimate1rmGrams(weightGrams, reps),
        });
      }
    }
  }

  // Sort by timestamp ascending (oldest first)
  performances.sort((a, b) => a.timestampMs - b.timestampMs);
  return performances;
}

/**
 * Check if two performances are comparable for progression analysis.
 */
function checkComparability(
  current: SetPerformance,
  historical: SetPerformance,
  currentPrescription: PrescriptionTarget,
): ComparabilityEvidence {
  const mismatches: ComparabilityMismatch[] = [];

  // Exercise identity — ID-first semantics (docs/PROGRESSION_ENGINE.md):
  // - both IDs present: equal → match; different → NOT a match (same display
  //   name never overrides two distinct valid IDs);
  // - ID missing on either side: safe fallback to exact display-name equality;
  // - no fuzzy matching, ever.
  let identityMatch: ComparabilityEvidence['identityMatch'] = 'none';
  if (current.exerciseId !== null && historical.exerciseId !== null) {
    if (current.exerciseId === historical.exerciseId) {
      identityMatch = 'seed_id';
    } else {
      mismatches.push({
        field: 'exercise',
        expected: current.exerciseName,
        actual: historical.exerciseName,
      });
    }
  } else if (current.exerciseName === historical.exerciseName) {
    identityMatch = 'name_only';
  } else {
    mismatches.push({
      field: 'exercise',
      expected: current.exerciseName,
      actual: historical.exerciseName,
    });
  }

  // Equipment class
  const equipmentMatch = current.equipmentClass === historical.equipmentClass;
  if (!equipmentMatch) {
    mismatches.push({
      field: 'equipment',
      expected: current.equipmentClass,
      actual: historical.equipmentClass,
    });
  }

  // Prescription match: same rep-range scheme and RIR target. The target
  // WEIGHT is deliberately excluded — it legitimately changes between sessions
  // (that is what progression is), and requiring equality would reject the
  // very history double progression needs to evaluate.
  const prescriptionMatch =
    current.prescription.targetRepsMin === historical.prescription.targetRepsMin &&
    current.prescription.targetRepsMax === historical.prescription.targetRepsMax &&
    current.prescription.targetRir === historical.prescription.targetRir;

  if (!prescriptionMatch) {
    mismatches.push({
      field: 'prescription',
      expected: JSON.stringify(current.prescription),
      actual: JSON.stringify(historical.prescription),
    });
  }

  // RIR availability
  const rirAvailable = current.actualRir !== null && historical.actualRir !== null;

  // Tempo availability
  const tempoAvailable =
    current.actualTempo !== null &&
    historical.actualTempo !== null &&
    JSON.stringify(current.actualTempo) === JSON.stringify(historical.actualTempo);

  // Determine overall comparability
  const comparable =
    identityMatch !== 'none' &&
    equipmentMatch &&
    prescriptionMatch &&
    !current.isSubstitution &&
    !historical.isSubstitution;

  let reason: ComparabilityReason | undefined;
  if (identityMatch === 'none') reason = 'different_exercise';
  else if (current.isSubstitution && historical.isSubstitution) reason = 'different_exercise';
  else if (current.isSubstitution) reason = 'current_substitution';
  else if (historical.isSubstitution) reason = 'previous_substitution';
  else if (!equipmentMatch) reason = 'different_equipment_class';
  else if (!prescriptionMatch) reason = 'prescription_mismatch';

  return {
    comparable,
    reason,
    mismatches,
    identityMatch,
    prescriptionMatch,
    equipmentMatch,
    rirAvailable,
    tempoAvailable,
  };
}

/**
 * Find the most recent comparable performance before the current one.
 */
function findBaseline(
  performances: SetPerformance[],
  currentPrescription: PrescriptionTarget,
  currentEquipmentClass: string,
): { baseline: SetPerformance; comparability: ComparabilityEvidence } | null {
  if (performances.length < 2) return null;
  const current = performances[performances.length - 1];
  const historical = performances.slice(0, -1);

  // Find the most recent comparable performance
  for (let i = historical.length - 1; i >= 0; i--) {
    const candidate = historical[i];
    const comparability = checkComparability(current, candidate, currentPrescription);
    if (comparability.comparable) {
      return { baseline: candidate, comparability };
    }
  }

  return null;
}

/**
 * Resolve the next-weight suggestion STRICTLY from caller-provided achievable
 * load (derived from real data, e.g. the persistent equipment inventory via
 * solveLoadInventory). The engine never invents an increment: without a
 * data-derived source the opportunity stands but no suggestion is made.
 */
function resolveWeightIncrement(
  targetWeightGrams: number,
  achievableNextWeightGrams: number | null | undefined,
): { suggestedWeightGrams?: number; source: ProgressionEvidence['weightIncrementSource'] } {
  if (
    achievableNextWeightGrams != null &&
    Number.isFinite(achievableNextWeightGrams) &&
    achievableNextWeightGrams > targetWeightGrams
  ) {
    return { suggestedWeightGrams: Math.round(achievableNextWeightGrams), source: 'equipment_inventory' };
  }
  return { source: 'none' };
}

/**
 * Evaluate double-progression logic for a single exercise.
 *
 * Double progression logic:
 * - Prescription defines a rep range [min, max]
 * - When athlete achieves max reps at target weight, progression opportunity exists
 * - Weight increment should come from prescription step or equipment info, not hardcoded
 */
function evaluateDoubleProgression(
  baseline: SetPerformance,
  current: SetPerformance,
  currentPrescription: PrescriptionTarget,
  currentWeightGrams: number | null,
  achievableNextWeightGrams: number | null | undefined,
): ProgressionEvidence {
  const minReps = currentPrescription.targetRepsMin ?? 0;
  const maxReps = currentPrescription.targetRepsMax ?? 0;
  const targetWeight = currentPrescription.targetWeightGrams ?? currentWeightGrams ?? 0;

  const repsAchieved = current.reps;
  const atTargetWeight = current.weightGrams === targetWeight && targetWeight > 0;

  // No rep range defined
  if (minReps <= 0 || maxReps <= 0 || minReps > maxReps) {
    return {
      state: 'insufficient_data',
      reason: 'NO_REPS_RANGE',
      explanation: 'Prescription does not define a valid rep range (min/max).',
      baseline,
      current,
      comparableCount: 1,
      currentPrescription,
      atTargetWeight: false,
      repsVsRange: { achieved: repsAchieved, min: minReps, max: maxReps },
    };
  }

  // No current weight to progress from
  if (targetWeight <= 0) {
    return {
      state: 'insufficient_data',
      reason: 'NO_CURRENT_WEIGHT',
      explanation: 'Current prescription has no target weight to progress from.',
      baseline,
      current,
      comparableCount: 1,
      currentPrescription,
      atTargetWeight: false,
      repsVsRange: { achieved: repsAchieved, min: minReps, max: maxReps },
    };
  }

  // Reps below minimum
  if (repsAchieved < minReps) {
    return {
      state: 'maintain',
      reason: 'REPS_BELOW_MIN',
      explanation: `Reps ${repsAchieved} below prescribed minimum ${minReps}.`,
      baseline,
      current,
      comparableCount: 1,
      currentPrescription,
      atTargetWeight,
      repsVsRange: { achieved: repsAchieved, min: minReps, max: maxReps },
    };
  }

  // Reps within range (not at upper bound)
  if (repsAchieved > minReps && repsAchieved < maxReps) {
    return {
      state: 'maintain',
      reason: 'REPS_IN_RANGE',
      explanation: `Reps ${repsAchieved} within prescribed range ${minReps}–${maxReps}.`,
      baseline,
      current,
      comparableCount: 1,
      currentPrescription,
      atTargetWeight,
      repsVsRange: { achieved: repsAchieved, min: minReps, max: maxReps },
    };
  }

  // Reps at upper bound (completed the range)
  if (repsAchieved === maxReps) {
    // Check if at target weight
    if (!atTargetWeight) {
      return {
        state: 'maintain',
        reason: 'REPS_RANGE_COMPLETED',
        explanation: `Reps ${repsAchieved} reached upper bound ${maxReps}, but not at target weight (${targetWeight}g vs ${current.weightGrams}g).`,
        baseline,
        current,
        comparableCount: 1,
        currentPrescription,
        atTargetWeight: false,
        repsVsRange: { achieved: repsAchieved, min: minReps, max: maxReps },
      };
    }

    // At target weight and hit upper bound → progression opportunity exists.
    // The suggested next weight comes ONLY from caller-provided achievable load
    // (real data). No hardcoded increment: without a source the opportunity is
    // still reported, with weightIncrementSource 'none'.
    const { suggestedWeightGrams, source } = resolveWeightIncrement(targetWeight, achievableNextWeightGrams);

    return {
      state: 'progress',
      reason: 'REPS_RANGE_COMPLETED',
      explanation:
        suggestedWeightGrams != null
          ? `Reps ${repsAchieved} reached upper bound ${maxReps} at target weight ${targetWeight}g; next achievable load ${suggestedWeightGrams}g from equipment inventory.`
          : `Reps ${repsAchieved} reached upper bound ${maxReps} at target weight ${targetWeight}g; progression opportunity confirmed, no equipment-derived next load available.`,
      baseline,
      current,
      comparableCount: 1,
      currentPrescription,
      atTargetWeight: true,
      repsVsRange: { achieved: repsAchieved, min: minReps, max: maxReps },
      suggestedWeightGrams,
      weightIncrementSource: source,
    };
  }

  // Reps exceeded upper bound
  if (repsAchieved > maxReps) {
    if (!atTargetWeight) {
      return {
        state: 'maintain',
        reason: 'REPS_EXCEEDED_RANGE',
        explanation: `Reps ${repsAchieved} exceeded upper bound ${maxReps}, but not at target weight.`,
        baseline,
        current,
        comparableCount: 1,
        currentPrescription,
        atTargetWeight: false,
        repsVsRange: { achieved: repsAchieved, min: minReps, max: maxReps },
      };
    }

    const { suggestedWeightGrams, source } = resolveWeightIncrement(targetWeight, achievableNextWeightGrams);

    return {
      state: 'progress',
      reason: 'REPS_EXCEEDED_RANGE',
      explanation:
        suggestedWeightGrams != null
          ? `Reps ${repsAchieved} exceeded upper bound ${maxReps} at target weight ${targetWeight}g; next achievable load ${suggestedWeightGrams}g from equipment inventory.`
          : `Reps ${repsAchieved} exceeded upper bound ${maxReps} at target weight ${targetWeight}g; progression opportunity confirmed, no equipment-derived next load available.`,
      baseline,
      current,
      comparableCount: 1,
      currentPrescription,
      atTargetWeight: true,
      repsVsRange: { achieved: repsAchieved, min: minReps, max: maxReps },
      suggestedWeightGrams,
      weightIncrementSource: source,
    };
  }

  // Should not reach
  return {
    state: 'insufficient_data',
    reason: 'INSUFFICIENT_HISTORY',
    explanation: 'Unexpected state in progression evaluation.',
    baseline,
    current,
    comparableCount: 1,
    currentPrescription,
    atTargetWeight: false,
    repsVsRange: { achieved: current.reps, min: minReps, max: maxReps },
  };
}

/**
 * Main entry point: analyze progression for an exercise.
 */
export function analyzeProgression(input: AnalyzeProgressionInput): ProgressionEvidence {
  const {
    exerciseName,
    exerciseId,
    sessions,
    currentPrescription,
    currentEquipmentClass,
    currentExerciseId,
    historicalPrescriptions,
    availableExercises,
    achievableNextWeightGrams,
    now,
  } = input;

  // Extract all performances for this exercise
  const performances = extractPerformances(
    sessions,
    exerciseName,
    exerciseId,
    currentEquipmentClass,
    currentPrescription,
    historicalPrescriptions,
    availableExercises,
  );

  if (performances.length === 0) {
    return {
      state: 'insufficient_data',
      reason: 'NO_COMPARABLE_PERFORMANCE',
      explanation: `No completed performances found for ${exerciseName}.`,
      comparableCount: 0,
      currentPrescription,
      atTargetWeight: false,
      repsVsRange: {
        achieved: 0,
        min: currentPrescription.targetRepsMin ?? 0,
        max: currentPrescription.targetRepsMax ?? 0,
      },
    };
  }

  // The latest performance is the "current" one
  const current = performances[performances.length - 1];

  const repsVsRange = {
    achieved: current.reps,
    min: currentPrescription.targetRepsMin ?? 0,
    max: currentPrescription.targetRepsMax ?? 0,
  };

  // A single performance cannot be compared against anything.
  if (performances.length < 2) {
    if (current.isSubstitution) {
      return {
        state: 'insufficient_data',
        reason: 'NO_COMPARABLE_PERFORMANCE',
        explanation: `Only ${performances.length} performance(s) found and it is a substitution; no comparable history for ${exerciseName}.`,
        current,
        comparableCount: performances.length,
        currentPrescription,
        atTargetWeight: false,
        repsVsRange,
      };
    }
    return {
      state: 'insufficient_data',
      reason: 'INSUFFICIENT_HISTORY',
      explanation: `Only ${performances.length} performance(s) found; need at least 2 comparable for progression analysis.`,
      current,
      comparableCount: performances.length,
      currentPrescription,
      atTargetWeight: false,
      repsVsRange,
    };
  }

  // Identity gates come FIRST: a substitution is never the original exercise.
  if (current.isSubstitution) {
    return {
      state: 'insufficient_data',
      reason: 'SUBSTITUTION_USED',
      explanation: 'Latest performance used a substitution exercise; cannot evaluate progression for original exercise.',
      current,
      comparableCount: performances.length,
      currentPrescription,
      atTargetWeight: false,
      repsVsRange,
    };
  }

  // Equipment class of the analysed exercise must match the current context.
  if (current.equipmentClass !== currentEquipmentClass) {
    return {
      state: 'insufficient_data',
      reason: 'EQUIPMENT_MISMATCH',
      explanation: `Equipment class changed (${current.equipmentClass} → ${currentEquipmentClass}).`,
      current,
      comparableCount: performances.length,
      currentPrescription,
      atTargetWeight: false,
      repsVsRange,
    };
  }

  // Find comparable baseline
  const baselineResult = findBaseline(performances, currentPrescription, currentEquipmentClass);

  if (!baselineResult) {
    // Attach the comparability verdict against the most recent historical
    // performance so the caller can see WHY no baseline is comparable
    // (identity, equipment, prescription, substitution).
    const lastHistorical = performances[performances.length - 2];
    const lastComparability = checkComparability(current, lastHistorical, currentPrescription);
    const allHistoricalSubs = performances.slice(0, -1).every((p) => p.isSubstitution);
    if (allHistoricalSubs) {
      return {
        state: 'insufficient_data',
        reason: 'PREVIOUS_SUBSTITUTION',
        explanation: 'Historical performances were substitutions; not comparable for progression.',
        current,
        comparableCount: performances.length,
        currentPrescription,
        comparability: lastComparability,
        atTargetWeight: false,
        repsVsRange,
      };
    }
    return {
      state: 'insufficient_data',
      reason: 'INSUFFICIENT_HISTORY',
      explanation: `No comparable baseline found among ${performances.length - 1} historical performance(s).`,
      current,
      comparableCount: performances.length,
      currentPrescription,
      comparability: lastComparability,
      atTargetWeight: false,
      repsVsRange,
    };
  }

  const { baseline, comparability } = baselineResult;

  // Evaluate double progression
  const currentWeight = currentPrescription.targetWeightGrams;
  const evidence = evaluateDoubleProgression(
    baseline,
    current,
    currentPrescription,
    currentWeight,
    achievableNextWeightGrams,
  );

  return {
    ...evidence,
    comparableCount: performances.length,
    comparability,
  };
}