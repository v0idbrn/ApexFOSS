import type { BlockKind, IntervalSpec, TempoSpec, TransitionType } from '../types/engine';
import type { ApexRoutinePackage, PortableBlock, PortableExercise, PortableStep } from './types';
import { ROUTINE_FORMAT, ROUTINE_FORMAT_VERSION, PortabilityError } from './types';
import { semanticChecksum, canonicalJson } from './canonical';
import { validateIntervalConfig } from '../interval/intervalEngine';

const BLOCK_KINDS: readonly string[] = ['normal', 'superset', 'contrast', 'circuit', 'interval'];
const TRANSITIONS: readonly string[] = ['immediate', 'rest', 'auto_advance'];
const MAX_BLOCKS = 500;
const MAX_STEPS_PER_BLOCK = 500;
const MAX_EXERCISES = 5000;
const MAX_NAME = 200;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function reqStr(obj: Record<string, unknown>, key: string, path: string, max = MAX_NAME): string {
  const v = obj[key];
  if (typeof v !== 'string' || v.length === 0 || v.length > max) {
    throw new PortabilityError('invalid_string', `${path}.${key}`);
  }
  return v;
}

function reqInt(obj: Record<string, unknown>, key: string, path: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v) || v < min || v > max) {
    throw new PortabilityError('invalid_integer', `${path}.${key}`);
  }
  return v;
}

function optIntOrNull(obj: Record<string, unknown>, key: string, path: string, min = 0, max = Number.MAX_SAFE_INTEGER): number | null {
  const v = obj[key];
  if (v === null || v === undefined) return null;
  if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v) || v < min || v > max) {
    throw new PortabilityError('invalid_integer', `${path}.${key}`);
  }
  return v;
}

function validateTempo(raw: unknown, path: string): TempoSpec {
  if (!isObj(raw)) throw new PortabilityError('invalid_tempo', path);
  return {
    eccentricMs: optIntOrNull(raw, 'eccentricMs', path, 0, 3_600_000),
    pauseBottomMs: optIntOrNull(raw, 'pauseBottomMs', path, 0, 3_600_000),
    concentricMs: optIntOrNull(raw, 'concentricMs', path, 0, 3_600_000),
    pauseTopMs: optIntOrNull(raw, 'pauseTopMs', path, 0, 3_600_000),
  };
}

function validatePrescription(raw: unknown, path: string) {
  if (!isObj(raw)) throw new PortabilityError('invalid_prescription', path);
  const targetSets = optIntOrNull(raw, 'targetSets', path, 1, 999);
  const targetRepsMin = optIntOrNull(raw, 'targetRepsMin', path, 0, 9999);
  const targetRepsMax = optIntOrNull(raw, 'targetRepsMax', path, 0, 9999);
  if (targetRepsMin !== null && targetRepsMax !== null && targetRepsMin > targetRepsMax) {
    throw new PortabilityError('invalid_prescription', `${path}.reps`);
  }
  const p = {
    targetSets,
    targetRepsMin,
    targetRepsMax,
    targetDurationMs: optIntOrNull(raw, 'targetDurationMs', path, 0, 86_400_000),
    targetWeightGrams: optIntOrNull(raw, 'targetWeightGrams', path, 0, 10_000_000),
    targetRir: optIntOrNull(raw, 'targetRir', path, 0, 10),
    tempo: validateTempo(raw.tempo, `${path}.tempo`),
  };
  return p;
}

function validateInterval(raw: unknown, path: string): IntervalSpec | null {
  if (raw === null || raw === undefined) return null;
  if (!isObj(raw)) throw new PortabilityError('invalid_interval', path);
  const mode = raw.mode;
  if (mode !== 'hiit' && mode !== 'emom' && mode !== 'glycolytic') {
    throw new PortabilityError('invalid_interval', `${path}.mode`);
  }
  const spec: IntervalSpec = {
    mode,
    workMs: reqInt(raw, 'workMs', path, 0),
    restMs: reqInt(raw, 'restMs', path, 0),
    rounds: reqInt(raw, 'rounds', path, 1, 10_000),
    periodMs: optIntOrNull(raw, 'periodMs', path, 0) as number | null,
    preparationMs: reqInt(raw, 'preparationMs', path, 0),
  };
  const check = validateIntervalConfig({
    mode: spec.mode,
    workMs: spec.workMs,
    restMs: spec.restMs,
    rounds: spec.rounds,
    periodMs: spec.periodMs,
    preparationMs: spec.preparationMs,
  });
  if (!check.ok) throw new PortabilityError('invalid_interval', check.reason);
  return spec;
}

function validateExercise(raw: unknown, path: string): PortableExercise {
  if (!isObj(raw)) throw new PortabilityError('missing_field', path);
  const key = reqStr(raw, 'key', path, 32);
  if (!/^e[1-9][0-9]{0,7}$/.test(key)) throw new PortabilityError('duplicate_identity', `${path}.key`);
  return {
    key,
    name: reqStr(raw, 'name', path),
    category: typeof raw.category === 'string' && raw.category.length <= MAX_NAME ? raw.category : '',
    equipment: typeof raw.equipment === 'string' && raw.equipment.length <= MAX_NAME ? raw.equipment : '',
    metricFlags: reqInt(raw, 'metricFlags', path, 0, 15),
  };
}

function validateStep(raw: unknown, path: string, exerciseKeys: Set<string>): PortableStep {
  if (!isObj(raw)) throw new PortabilityError('missing_field', path);
  const role = raw.role;
  if (role !== 'work' && role !== 'rest') throw new PortabilityError('missing_field', `${path}.role`);
  let exerciseKey: string | null = null;
  if (raw.exerciseKey === null || raw.exerciseKey === undefined) {
    exerciseKey = null;
  } else {
    if (typeof raw.exerciseKey !== 'string') throw new PortabilityError('dangling_exercise', path);
    exerciseKey = raw.exerciseKey;
    if (!exerciseKeys.has(exerciseKey)) throw new PortabilityError('dangling_exercise', path);
  }
  if (typeof raw.exerciseName !== 'string' || raw.exerciseName.length > MAX_NAME) {
    throw new PortabilityError('invalid_string', `${path}.exerciseName`);
  }
  const tr = raw.transition;
  if (!isObj(tr)) throw new PortabilityError('invalid_transition', `${path}.transition`);
  const type = tr.type as TransitionType;
  if (typeof type !== 'string' || !TRANSITIONS.includes(type)) {
    throw new PortabilityError('invalid_transition', `${path}.transition.type`);
  }
  const delayMs = reqInt(tr, 'delayMs', `${path}.transition`, 0, 86_400_000);
  if (type === 'immediate' && delayMs !== 0) {
    // Allow non-zero only for rest/auto; immediate must be 0 for determinism.
    throw new PortabilityError('invalid_transition', `${path}.transition.delay`);
  }
  return {
    role,
    exerciseKey,
    exerciseName: raw.exerciseName,
    prescription: validatePrescription(raw.prescription, `${path}.prescription`),
    transition: { type, delayMs },
  };
}

function validateBlock(raw: unknown, path: string, exerciseKeys: Set<string>): PortableBlock {
  if (!isObj(raw)) throw new PortabilityError('missing_field', path);
  const name = reqStr(raw, 'name', path);
  const kind = raw.kind as BlockKind;
  if (typeof kind !== 'string' || !BLOCK_KINDS.includes(kind)) {
    throw new PortabilityError('missing_field', `${path}.kind`);
  }
  const rounds = reqInt(raw, 'rounds', path, 1, 10_000);
  if (!Array.isArray(raw.steps) || raw.steps.length === 0 || raw.steps.length > MAX_STEPS_PER_BLOCK) {
    throw new PortabilityError('empty_routine', path);
  }
  const steps = raw.steps.map((s, i) => validateStep(s, `${path}.steps[${i}]`, exerciseKeys));
  const interval = validateInterval(raw.interval, `${path}.interval`);
  if (kind === 'interval' && !interval) throw new PortabilityError('invalid_interval', path);
  if (kind !== 'interval' && interval) throw new PortabilityError('invalid_interval', path);
  if (kind === 'interval' && rounds !== 1) throw new PortabilityError('invalid_rounds', path);
  return { name, kind, rounds, steps, interval };
}

function validatePortableRoutine(raw: unknown, exerciseKeys: Set<string>): {
  name: string;
  blocks: PortableBlock[];
} {
  if (!isObj(raw)) throw new PortabilityError('missing_field', 'routine');
  const name = reqStr(raw, 'name', 'routine');
  if (!Array.isArray(raw.blocks) || raw.blocks.length === 0 || raw.blocks.length > MAX_BLOCKS) {
    throw new PortabilityError('empty_routine', 'routine.blocks');
  }
  const blocks = raw.blocks.map((b, i) => validateBlock(b, `routine.blocks[${i}]`, exerciseKeys));
  return { name, blocks };
}

/**
 * Strict validation of an untrusted routine package.
 * Rejects wrong format, version, corruption, dangling refs, duplicate keys.
 */
export function validateRoutinePackage(raw: unknown): ApexRoutinePackage {
  if (!isObj(raw)) throw new PortabilityError('missing_field', 'root');
  if (raw.format !== ROUTINE_FORMAT) throw new PortabilityError('wrong_format');
  if (raw.formatVersion !== ROUTINE_FORMAT_VERSION) throw new PortabilityError('unsupported_version');
  if (!isObj(raw.producer) || raw.producer.app !== 'ApexFOSS') {
    throw new PortabilityError('missing_field', 'producer');
  }
  const producerVersion = raw.producer.version;
  if (typeof producerVersion !== 'string' || producerVersion.length === 0 || producerVersion.length > 32) {
    throw new PortabilityError('invalid_string', 'producer.version');
  }
  const exportedAt = reqInt(raw, 'exportedAt', 'root', 0);
  if (typeof raw.checksum !== 'string' || !/^[0-9a-f]{64}$/.test(raw.checksum)) {
    throw new PortabilityError('checksum_mismatch', 'format');
  }
  if (!Array.isArray(raw.exercises) || raw.exercises.length > MAX_EXERCISES) {
    throw new PortabilityError('missing_field', 'exercises');
  }
  const exercises = raw.exercises.map((e, i) => validateExercise(e, `exercises[${i}]`));
  const keys = exercises.map((e) => e.key);
  if (new Set(keys).size !== keys.length) throw new PortabilityError('duplicate_identity', 'exercises');
  const exerciseKeys = new Set(keys);

  const routine = validatePortableRoutine(raw.routine, exerciseKeys);
  const semantic = { routine, exercises };
  const expected = semanticChecksum(semantic);
  if (expected !== raw.checksum) throw new PortabilityError('checksum_mismatch');

  return {
    format: ROUTINE_FORMAT,
    formatVersion: ROUTINE_FORMAT_VERSION,
    exportedAt,
    producer: { app: 'ApexFOSS', version: producerVersion },
    routine,
    exercises,
    checksum: expected,
  };
}

/** Semantic equality ignoring exportedAt / producer version metadata differences when requested. */
export function semanticEquals(a: ApexRoutinePackage, b: ApexRoutinePackage): boolean {
  const sa = canonicalJson({ routine: a.routine, exercises: a.exercises });
  const sb = canonicalJson({ routine: b.routine, exercises: b.exercises });
  return sa === sb;
}
