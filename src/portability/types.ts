import type { BlockKind, IntervalSpec, TempoSpec, TransitionType } from '../types/engine';

/** Portable interchange types. Integer units only. No Watermelon IDs required. */

export const ROUTINE_FORMAT = 'apexfoss-routine' as const;
export const BACKUP_FORMAT = 'apexfoss-backup' as const;
export const ROUTINE_FORMAT_VERSION = 1 as const;
export const BACKUP_FORMAT_VERSION = 1 as const;

/** Package-local exercise identity (installation-independent). */
export interface PortableExercise {
  key: string;
  name: string;
  category: string;
  equipment: string;
  metricFlags: number;
}

export interface PortablePrescription {
  targetSets: number | null;
  targetRepsMin: number | null;
  targetRepsMax: number | null;
  targetDurationMs: number | null;
  targetWeightGrams: number | null;
  targetRir: number | null;
  tempo: TempoSpec;
}

export interface PortableStep {
  role: 'work' | 'rest';
  /** null = rest/cue step with no exercise. Otherwise a PortableExercise.key. */
  exerciseKey: string | null;
  exerciseName: string;
  prescription: PortablePrescription;
  transition: { type: TransitionType; delayMs: number };
}

export interface PortableBlock {
  name: string;
  kind: BlockKind;
  rounds: number;
  steps: PortableStep[];
  interval?: IntervalSpec | null;
}

export interface PortableRoutine {
  name: string;
  blocks: PortableBlock[];
}

export interface ApexRoutinePackage {
  format: typeof ROUTINE_FORMAT;
  formatVersion: number;
  /** Metadata only — not part of semantic checksum. */
  exportedAt: number;
  producer: { app: string; version: string };
  /** Semantic content. Covered by checksum. */
  routine: PortableRoutine;
  exercises: PortableExercise[];
  /** sha256 hex of canonical(routine + exercises). */
  checksum: string;
}

/** Routine preview shown before any mutation. */
export interface ImportPreview {
  routineName: string;
  exerciseCount: number;
  blockCount: number;
  stepCount: number;
  formatVersion: number;
  producerApp: string;
  producerVersion: string;
  /** How many referenced exercises already exist locally (name+category+equipment+flags). */
  matchedExercises: number;
  newExercises: number;
}

export type PortabilityErrorCode =
  | 'invalid_json'
  | 'wrong_format'
  | 'unsupported_version'
  | 'missing_field'
  | 'invalid_integer'
  | 'invalid_string'
  | 'invalid_boolean'
  | 'invalid_units'
  | 'invalid_transition'
  | 'invalid_interval'
  | 'invalid_tempo'
  | 'invalid_rounds'
  | 'invalid_prescription'
  | 'dangling_exercise'
  | 'duplicate_identity'
  | 'checksum_mismatch'
  | 'too_large'
  | 'empty_routine'
  | 'unsupported_backup_version'
  | 'schema_mismatch'
  | 'invalid_session'
  | 'invalid_reference';

export class PortabilityError extends Error {
  readonly code: PortabilityErrorCode;
  constructor(code: PortabilityErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'PortabilityError';
    this.code = code;
  }
}

/** A program container (Phase 4A): name only; membership lives on routines. */
export interface PortableProgram {
  name: string;
}

/** A mesocycle phase (Phase 4B): ordered inside a program via programIndex. */
export interface BackupMesocycle {
  name: string;
  /** Index into backup.data.programs. */
  programIndex: number;
  sortOrder: number;
}

/** Phase 4D: strength goal referencing an exercise by package key. */
export interface BackupGoal {
  exerciseKey: string;
  targetWeightGrams: number;
}

/** Backup row shapes (logical, not Watermelon dumps). */
export interface BackupRoutine extends PortableRoutine {
  /** Index into backup.data.programs, or null/absent when unassigned (Phase 4A). */
  programIndex?: number | null;
  /** Order within the program; null/absent when unassigned or legacy. */
  programOrder?: number | null;
  /** Index into backup.data.mesocycles, or null/absent when not staged (Phase 4B). */
  mesocycleIndex?: number | null;
}

export interface BackupSession {
  /** Index into backup.routines, or null when routine row is gone. */
  routineIndex: number | null;
  name: string;
  startedAt: number;
  endedAt: number | null;
  status: string;
  /**
   * Post-workout session note (schema v5). Absent on backups created before
   * v5 — restore treats missing as null.
   */
  note?: string | null;
  definitionJson: string;
  cursorJson: string;
  currentBlockIndex: number;
  currentStepId: string | null;
  currentRound: number;
  currentSetIndex: number;
  timerExpiresAt: number | null;
}

export interface BackupSessionExercise {
  sessionIndex: number;
  exerciseKey: string | null;
  exerciseName: string;
  blockIndex: number;
  orderIndex: number;
}

export interface BackupSetLog {
  sessionExerciseIndex: number;
  blockIndex: number;
  stepIndex: number;
  round: number;
  setIndex: number;
  weightGrams: number | null;
  reps: number | null;
  durationMs: number | null;
  distanceMm: number | null;
  rir: number | null;
  isCompleted: number;
  completedAt: number | null;
  /** Phase 3C execution marking; absent on older backups → legacy semantics. */
  executionType?: string | null;
  /** Phase 3C athlete-stated reason; absent on older backups → none stated. */
  overrideReason?: string | null;
}

/** Readiness tap tests (Phase 2E). Optional on older backups. */
export interface BackupReadinessTest {
  testedAt: number;
  durationMs: number;
  tapCount: number;
}

/** Gym equipment inventory (Phase 2J, schema v4). Optional on older backups. */
export interface BackupEquipmentItem {
  name: string;
  weightGrams: number;
  quantity: number;
  perSide: boolean;
}

export interface BackupData {
  exercises: PortableExercise[];
  routines: BackupRoutine[];
  sessions: BackupSession[];
  sessionExercises: BackupSessionExercise[];
  setLogs: BackupSetLog[];
  /** Absent on backups created before schema v3 — restore treats as empty. */
  readinessTests?: BackupReadinessTest[];
  /** Absent on backups created before schema v4 — restore treats as empty. */
  equipmentItems?: BackupEquipmentItem[];
  /** Absent on backups created before schema v8 — restore treats as empty. */
  programs?: PortableProgram[];
  /** Absent on backups created before schema v9 — restore treats as empty. */
  mesocycles?: BackupMesocycle[];
  /** Absent on backups created before schema v10 — restore treats as empty. */
  goals?: BackupGoal[];
}

export interface ApexBackup {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  appVersion: string;
  schemaVersion: number;
  /** Metadata only. */
  exportedAt: number;
  /** sha256 hex of canonical(data). */
  checksum: string;
  data: BackupData;
}

/** Compact payload size ceiling for single QR / deep-link transport (bytes of UTF-8). */
export const MAX_PORTABLE_PAYLOAD_BYTES = 2000;

/**
 * Hard ceilings for pasted TEXT inputs (spec sections 9/10/12).
 * Checked before JSON.parse so hostile multi-MB pastes are rejected
 * without allocating the parsed object. See D-036.
 * - Routine JSON: structural maxima allow pathological packages, but any
 *   realistic routine (hundreds of steps) is far below 5 MB.
 * - Backup JSON: ~2 KB per session row pair; 32 MB covers very large
 *   histories while bounding JSON.parse memory on low-RAM devices.
 */
export const MAX_ROUTINE_JSON_BYTES = 5_000_000;
export const MAX_BACKUP_JSON_BYTES = 33_554_432;
