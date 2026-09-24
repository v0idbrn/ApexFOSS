import type { BlockKind, TempoSpec, TransitionType } from './engine';

/** Editor draft model — UI working copy of a routine structure (persisted via DbActions.saveRoutineDraft). */

export interface DraftPrescription {
  targetSets: number | null;
  targetRepsMin: number | null;
  targetRepsMax: number | null;
  targetDurationMs: number | null;
  targetWeightGrams: number | null;
  targetRir: number | null;
  tempo: TempoSpec;
}

export interface DraftStep {
  localId: string;
  exerciseId: string | null;
  exerciseName: string;
  prescription: DraftPrescription;
  /** "After this step" edge. to_step_id is always null (implicit forward/loop target). */
  transition: { type: TransitionType; delayMs: number };
}

export interface DraftBlock {
  localId: string;
  name: string;
  kind: BlockKind;
  rounds: number;
  steps: DraftStep[];
}

export interface RoutineDraft {
  id: string | null;
  name: string;
  blocks: DraftBlock[];
}

export const emptyPrescription = (): DraftPrescription => ({
  targetSets: null,
  targetRepsMin: null,
  targetRepsMax: null,
  targetDurationMs: null,
  targetWeightGrams: null,
  targetRir: null,
  tempo: { eccentricMs: null, pauseBottomMs: null, concentricMs: null, pauseTopMs: null },
});

export const emptyDraft = (): RoutineDraft => ({ id: null, name: '', blocks: [] });
