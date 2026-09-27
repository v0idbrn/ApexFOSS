/** Canonical engine + definition types. Pure TypeScript, no runtime deps (frozen architecture). */

export type BlockKind = 'normal' | 'superset' | 'contrast' | 'circuit' | 'interval';
export type TransitionType = 'immediate' | 'rest' | 'auto_advance';
export type StepRole = 'work' | 'rest';

export interface TempoSpec {
  eccentricMs: number | null;
  pauseBottomMs: number | null;
  concentricMs: number | null;
  pauseTopMs: number | null;
}

/** Interval programming on a block (Phase 2C). Integer ms only. */
export interface IntervalSpec {
  mode: 'hiit' | 'emom' | 'glycolytic';
  workMs: number;
  restMs: number;
  rounds: number;
  periodMs: number | null;
  preparationMs: number;
}

export interface Prescription {
  targetSets: number | null;
  targetRepsMin: number | null;
  targetRepsMax: number | null;
  targetDurationMs: number | null;
  targetWeightGrams: number | null;
  targetRir: number | null;
  tempo: TempoSpec;
}

export interface StepDef {
  id: string;
  role: StepRole;
  exerciseId: string | null;
  exerciseName: string;
  prescription: Prescription;
}

export interface TransitionDef {
  fromStepId: string;
  /** null = implicit loop target (first step of the block) */
  toStepId: string | null;
  delayMs: number;
  type: TransitionType;
}

export interface BlockDef {
  id: string;
  name: string;
  kind: BlockKind;
  rounds: number;
  steps: StepDef[];
  transitions: TransitionDef[];
  /** Present iff kind === 'interval'. Serialized into definition_json. */
  interval?: IntervalSpec | null;
}

export interface RoutineDefinition {
  id: string;
  name: string;
  blocks: BlockDef[];
}

export interface CursorPosition {
  blockIndex: number;
  stepIndex: number;
  round: number;
  setIndex: number;
}

export interface TimerState {
  kind: 'rest' | 'auto';
  durationMs: number;
  expiresAt: number;
  /** Position the cursor jumps to when the timer expires / is skipped. */
  target: CursorPosition;
  /**
   * Application-layer pause marker (Phase 2J): when set, the countdown is
   * frozen and remaining = expiresAt − pausedAt. expiresAt remains the single
   * expiry source of truth; resume rewrites it to now + remaining and clears
   * this field. Absent/null = running (engine-produced timers never set it).
   */
  pausedAt?: number | null;
}

export interface ReversibleSet {
  kind: 'set';
  /** Filled by the application layer after creating the set_log row; null until then. */
  setLogId: string | null;
  blockIndex: number;
  stepIndex: number;
  round: number;
  setIndex: number;
}

/** Canonical execution state — serialized into workout_sessions.cursor_json. */
/** Optional active interval runtime embedded in cursor_json (process-death recovery). */
export interface PersistedInterval {
  status: 'running';
  config: {
    mode: 'hiit' | 'emom' | 'glycolytic';
    workMs: number;
    restMs: number;
    rounds: number;
    periodMs: number | null;
    preparationMs: number;
    emomWorkMs: number;
    emomRestMs: number;
    totalMs: number;
  };
  startedAt: number;
  round: number;
  phase: 'prep' | 'work' | 'rest' | null;
  phaseStartsAt: number;
  phaseEndsAt: number;
  workDoneEarly: boolean;
}

export interface ExecutionCursor extends CursorPosition {
  status: 'active' | 'completed';
  timer: TimerState | null;
  lastReversible: ReversibleSet | null;
  startedAt: number;
  /** Interval trainer state while on an interval block; absent/cleared otherwise. */
  interval?: PersistedInterval | null;
  /**
   * Extra/drop sets logged per position (Phase 3C): key
   * `${blockIndex}:${stepIndex}:${round}` → count. Keeps extra setIndex
   * assignment deterministic under event replay. Absent = none logged.
   */
  extraCounts?: Record<string, number>;
}

/**
 * How a logged set relates to its prescription (Phase 3C: prescription ≠ actual).
 * - normal: matches prescription (or no prescription to compare against)
 * - modified: performed with at least one differing load/rep/duration/RIR value
 * - extra: set beyond the prescribed set count
 * - drop: extra set performed as a drop set (lower load, immediate continuation)
 * - skipped: prescribed set that was not performed (no performance recorded)
 */
export type ExecutionType = 'normal' | 'modified' | 'extra' | 'drop' | 'skipped';

/**
 * Athlete-stated reason for deviating from prescription (Phase 3C).
 * Optional and explicit only — the engine never infers a cause from values.
 */
export type OverrideReason =
  | 'load_reduced'
  | 'load_increased'
  | 'reps_reduced'
  | 'reps_increased'
  | 'fatigue'
  | 'pain_discomfort'
  | 'equipment_unavailable'
  | 'time_constraint'
  | 'other';

export interface SetPayload {
  weightGrams: number | null;
  reps: number | null;
  durationMs: number | null;
  distanceMm: number | null;
  rir: number | null;
  /** Athlete-stated override reason; absent/null = none stated. Passed through to the log. */
  overrideReason?: OverrideReason | null;
}

export type EngineEvent =
  | { type: 'COMPLETE_SET'; now: number; set: SetPayload }
  | { type: 'SKIP_SET'; now: number }
  | { type: 'SKIP_STEP'; now: number }
  | { type: 'SKIP_TIMER'; now: number }
  | { type: 'TIMER_EXPIRE'; now: number }
  | { type: 'UNDO_LAST'; now: number }
  | { type: 'COMPLETE_SESSION'; now: number }
  | { type: 'LOG_EXTRA_SET'; now: number; set: SetPayload; executionType: 'extra' | 'drop' };

export type Effect =
  | {
      kind: 'LOG_SET';
      blockIndex: number;
      stepIndex: number;
      round: number;
      setIndex: number;
      set: SetPayload;
      /** Present only for extra/drop sets logged via LOG_EXTRA_SET. */
      executionType?: 'extra' | 'drop';
    }
  | { kind: 'LOG_SKIPPED_SET'; blockIndex: number; stepIndex: number; round: number; setIndex: number }
  | { kind: 'VOID_LAST_SET'; setLogId: string | null }
  | { kind: 'START_TIMER'; timerKind: 'rest' | 'auto'; durationMs: number; expiresAt: number }
  | { kind: 'CANCEL_TIMER' }
  | { kind: 'ADVANCE_STEP'; blockIndex: number; stepIndex: number; round: number }
  | { kind: 'ADVANCE_ROUND'; blockIndex: number; round: number }
  | { kind: 'ADVANCE_BLOCK'; blockIndex: number }
  | { kind: 'COMPLETE_SESSION' }
  | { kind: 'SCHEDULE_NOTIFICATION'; expiresAt: number; title: string }
  | { kind: 'CANCEL_NOTIFICATION' };

export interface DispatchResult {
  cursor: ExecutionCursor;
  effects: Effect[];
}

/** Engine defaults when no explicit transition exists (frozen semantics). */
export const ENGINE_DEFAULTS = {
  restBetweenSetsMs: 90_000,
  restLoopMs: 90_000,
  restBlockMs: 120_000,
  restStepFallbackMs: 60_000,
} as const;
