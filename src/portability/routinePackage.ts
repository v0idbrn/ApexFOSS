import { Database } from '@nozbe/watermelondb';
import type { RoutineDraft } from '../types/draft';
import type {
  ApexRoutinePackage,
  PortableBlock,
  PortableExercise,
  PortableRoutine,
  PortableStep,
} from './types';
import { ROUTINE_FORMAT, ROUTINE_FORMAT_VERSION, PortabilityError } from './types';
import { canonicalJson, semanticChecksum } from './canonical';
import { validateRoutinePackage } from './validate';
import { makeDbActions } from '../data/actions';

const APP_VERSION = '0.1.0';

/**
 * Assign package-local exercise keys by first-use order across blocks/steps.
 * Deterministic given routine structure + exercise metadata (not DB ids).
 */
export function assignExerciseKeys(draft: RoutineDraft): {
  exercises: PortableExercise[];
  exerciseByKey: Map<string, PortableExercise>;
  keyByLocalId: Map<string, string>;
} {
  const keyByLocalId = new Map<string, string>();
  const exerciseByKey = new Map<string, PortableExercise>();
  const exercises: PortableExercise[] = [];

  const ensure = (localId: string, meta: { name: string; category: string; equipment: string; metricFlags: number }) => {
    const existing = keyByLocalId.get(localId);
    if (existing) return existing;
    const key = `e${exercises.length + 1}`;
    const portable: PortableExercise = {
      key,
      name: meta.name,
      category: meta.category,
      equipment: meta.equipment,
      metricFlags: meta.metricFlags,
    };
    exercises.push(portable);
    exerciseByKey.set(key, portable);
    keyByLocalId.set(localId, key);
    return key;
  };

  for (const block of draft.blocks) {
    for (const step of block.steps) {
      if (step.exerciseId) {
        ensure(step.exerciseId, {
          name: step.exerciseName,
          category: '',
          equipment: '',
          metricFlags: 0,
        });
      }
    }
  }
  return { exercises, exerciseByKey, keyByLocalId };
}

interface ExerciseMeta {
  name: string;
  category: string;
  equipment: string;
  metricFlags: number;
}

/** Build a portable routine package from a draft + exercise metadata from DB. */
export async function buildRoutinePackage(db: Database, routineId: string): Promise<ApexRoutinePackage> {
  const draft = await makeDbActions(db).loadRoutineDraft(routineId);
  if (!draft.id) throw new PortabilityError('missing_field', 'routine');
  const metaByLocalId = new Map<string, ExerciseMeta>();
  const exerciseRows = (await db.get('exercises').query().fetch()) as unknown as Array<{
    id: string;
    name: string;
    category: string;
    equipment: string;
    metricFlags: number;
  }>;
  for (const row of exerciseRows) {
    metaByLocalId.set(row.id, {
      name: row.name,
      category: row.category,
      equipment: row.equipment,
      metricFlags: row.metricFlags,
    });
  }
  return buildRoutinePackageFromDraft(draft, metaByLocalId, Date.now());
}

/** Pure builder — same logical draft always yields the same semantic package (checksum ignores exportedAt). */
export function buildRoutinePackageFromDraft(
  draft: RoutineDraft,
  metaByLocalId: Map<string, ExerciseMeta>,
  exportedAt: number,
): ApexRoutinePackage {
  const keyByLocalId = new Map<string, string>();
  const exercises: PortableExercise[] = [];

  const ensureKey = (localId: string): string | null => {
    if (!localId) return null;
    const hit = keyByLocalId.get(localId);
    if (hit) return hit;
    const meta = metaByLocalId.get(localId);
    if (!meta) {
      // Step references unknown exercise row — still portable via name-only row.
      const stepName = findExerciseName(draft, localId);
      if (!stepName) throw new PortabilityError('dangling_exercise', localId);
      const key = `e${exercises.length + 1}`;
      exercises.push({ key, name: stepName, category: '', equipment: '', metricFlags: 0 });
      keyByLocalId.set(localId, key);
      return key;
    }
    const key = `e${exercises.length + 1}`;
    exercises.push({
      key,
      name: meta.name,
      category: meta.category,
      equipment: meta.equipment,
      metricFlags: meta.metricFlags,
    });
    keyByLocalId.set(localId, key);
    return key;
  };

  // First pass: assign keys in step order.
  for (const block of draft.blocks) {
    for (const step of block.steps) {
      if (step.exerciseId) ensureKey(step.exerciseId);
    }
  }

  const blocks: PortableBlock[] = draft.blocks.map((b) => ({
    name: b.name,
    kind: b.kind,
    rounds: b.kind === 'interval' ? 1 : Math.max(1, Math.round(b.rounds || 1)),
    steps: b.steps.map((s): PortableStep => ({
      role: 'work',
      exerciseKey: s.exerciseId ? keyByLocalId.get(s.exerciseId) ?? null : null,
      exerciseName: s.exerciseName,
      prescription: {
        targetSets: s.prescription.targetSets,
        targetRepsMin: s.prescription.targetRepsMin,
        targetRepsMax: s.prescription.targetRepsMax,
        targetDurationMs: s.prescription.targetDurationMs,
        targetWeightGrams: s.prescription.targetWeightGrams,
        targetRir: s.prescription.targetRir,
        tempo: {
          eccentricMs: s.prescription.tempo.eccentricMs,
          pauseBottomMs: s.prescription.tempo.pauseBottomMs,
          concentricMs: s.prescription.tempo.concentricMs,
          pauseTopMs: s.prescription.tempo.pauseTopMs,
        },
      },
      transition: {
        type: s.transition.type,
        delayMs: Math.max(0, Math.round(s.transition.delayMs || 0)),
      },
    })),
    interval: b.kind === 'interval' ? b.interval ?? null : null,
  }));

  const routine: PortableRoutine = { name: draft.name, blocks };
  const semantic = { routine, exercises };
  const pkg: ApexRoutinePackage = {
    format: ROUTINE_FORMAT,
    formatVersion: ROUTINE_FORMAT_VERSION,
    exportedAt,
    producer: { app: 'ApexFOSS', version: APP_VERSION },
    routine,
    exercises,
    checksum: semanticChecksum(semantic),
  };
  return validateRoutinePackage(pkg);
}

function findExerciseName(draft: RoutineDraft, localId: string): string | null {
  for (const b of draft.blocks) {
    for (const s of b.steps) {
      if (s.exerciseId === localId && s.exerciseName) return s.exerciseName;
    }
  }
  return null;
}

/** Canonical UTF-8 JSON for a routine package (stable key order). */
export function serializeRoutinePackage(pkg: ApexRoutinePackage): string {
  return canonicalJson(pkg);
}

/**
 * Parse untrusted routine package JSON.
 * Throws PortabilityError — never partially trusts input.
 */
export function parseRoutinePackage(json: string): ApexRoutinePackage {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new PortabilityError('invalid_json');
  }
  return validateRoutinePackage(raw);
}

/** Count steps for preview. */
export function countSteps(routine: PortableRoutine): number {
  let n = 0;
  for (const b of routine.blocks) n += b.steps.length;
  return n;
}
