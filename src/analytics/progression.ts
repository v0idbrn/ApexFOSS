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

/** Reason why performances are not comparable. */
export type ComparabilityReason =
  | 'different_exercise'
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
  /** Weight progression opportunity (grams) if applicable. */
  suggestedWeightGrams?: number;
  /** Source of weight increment if suggested. */
  weightIncrementSource?: 'prescription_step' | 'equipment_step' | 'default_step' | 'none';
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
      const isTarget = exercise.exerciseName === exerciseName;
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

  // Exercise identity
  let identityMatch: ComparabilityEvidence['identityMatch'] = 'none';
  if (current.exerciseId && historical.exerciseId && current.exerciseId === historical.exerciseId) {
    identityMatch = 'seed_id';
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

  // Prescription match (compare targets)
  const prescriptionMatch =
    current.prescription.targetRepsMin === historical.prescription.targetRepsMin &&
    current.prescription.targetRepsMax === historical.prescription.targetRepsMax &&
    current.prescription.targetWeightGrams === historical.prescription.targetWeightGrams &&
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
  else if (!equipmentMatch) reason = 'different_equipment_class';
  else if (!prescriptionMatch) reason = 'prescription_mismatch';
  else if (current.isSubstitution) reason = 'different_exercise';
  else if (historical.isSubstitution) reason = 'different_exercise';

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
  // Filter to performances before the last one (assuming last is current)
  const historical = performances.slice(0, -1);
  if (historical.length === 0) return null;

  // Find the most recent comparable performance
  for (let i = historical.length - 1; i >= 0; i--) {
    const candidate = historical[i];
    const comparability = checkComparability(performances[performances.length - 1], candidate, currentPrescription);
    if (comparability.comparable) {
      return { baseline: candidate, comparability };
    }
  }

  return null;
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

    // At target weight and hit upper bound → progression opportunity
    // Weight increment: prefer prescription step, then equipment step, then default 2.5kg
    let suggestedWeightGrams = targetWeight + 2500; // default 2.5kg
    let weightIncrementSource: ProgressionEvidence['weightIncrementSource'] = 'default_step';

    return {
      state: 'progress',
      reason: 'REPS_RANGE_COMPLETED',
      explanation: `Reps ${repsAchieved} reached upper bound ${maxReps} at target weight ${targetWeight}g.`,
      baseline,
      current,
      comparableCount: 1,
      currentPrescription,
      atTargetWeight: true,
      repsVsRange: { achieved: repsAchieved, min: minReps, max: maxReps },
      suggestedWeightGrams,
      weightIncrementSource,
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

    return {
      state: 'progress',
      reason: 'REPS_EXCEEDED_RANGE',
      explanation: `Reps ${repsAchieved} exceeded upper bound ${maxReps} at target weight ${targetWeight}g.`,
      baseline,
      current,
      comparableCount: 1,
      currentPrescription,
      atTargetWeight: true,
      repsVsRange: { achieved: repsAchieved, min: minReps, max: maxReps },
      suggestedWeightGrams: targetWeight + 2500,
      weightIncrementSource: 'default_step',
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

  // Find comparable baseline
  const baselineResult = findBaseline(performances, currentPrescription, currentEquipmentClass);

  if (!baselineResult) {
    return {
      state: 'insufficient_data',
      reason: 'INSUFFICIENT_HISTORY',
      explanation: `Only ${performances.length} performance(s) found; need at least 2 comparable for progression analysis.`,
      current,
      comparableCount: performances.length,
      currentPrescription,
      atTargetWeight: false,
      repsVsRange: {
        achieved: current.reps,
        min: currentPrescription.targetRepsMin ?? 0,
        max: currentPrescription.targetRepsMax ?? 0,
      },
    };
  }

  const { baseline, comparability } = baselineResult;

  // Check for substitution issues
  if (current.isSubstitution) {
    return {
      state: 'insufficient_data',
      reason: 'SUBSTITUTION_USED',
      explanation: 'Latest performance used a substitution exercise; cannot evaluate progression for original exercise.',
      baseline,
      current,
      comparableCount: performances.length,
      currentPrescription,
      comparability,
      atTargetWeight: false,
      repsVsRange: {
        achieved: current.reps,
        min: currentPrescription.targetRepsMin ?? 0,
        max: currentPrescription.targetRepsMax ?? 0,
      },
    };
  }

  if (baseline.isSubstitution) {
    return {
      state: 'insufficient_data',
      reason: 'PREVIOUS_SUBSTITUTION',
      explanation: 'Baseline performance was a substitution; not comparable for progression.',
      baseline,
      current,
      comparableCount: performances.length,
      currentPrescription,
      comparability,
      atTargetWeight: false,
      repsVsRange: {
        achieved: current.reps,
        min: currentPrescription.targetRepsMin ?? 0,
        max: currentPrescription.targetRepsMax ?? 0,
      },
    };
  }

  // Check equipment match with current
  if (current.equipmentClass !== currentEquipmentClass) {
    return {
      state: 'insufficient_data',
      reason: 'EQUIPMENT_MISMATCH',
      explanation: `Equipment class changed (${current.equipmentClass} → ${currentEquipmentClass}).`,
      baseline,
      current,
      comparableCount: performances.length,
      currentPrescription,
      comparability,
      atTargetWeight: false,
      repsVsRange: {
        achieved: current.reps,
        min: currentPrescription.targetRepsMin ?? 0,
        max: currentPrescription.targetRepsMax ?? 0,
      },
    };
  }

  // Evaluate double progression
  const currentWeight = currentPrescription.targetWeightGrams;
  const evidence = evaluateDoubleProgression(
    baseline,
    current,
    currentPrescription,
    currentWeight,
  );

  return {
    ...evidence,
    comparableCount: performances.length,
    comparability,
  };
}

export type {
  PrescriptionTarget,
  SetPerformance,
  ComparabilityEvidence,
  ComparabilityReason,
  ComparabilityMismatch,
  ProgressionState,
  ProgressionReason,
  ProgressionEvidence,
  AnalyzeProgressionInput,
};