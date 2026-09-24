import { Database } from '@nozbe/watermelondb';
import type { ApexRoutinePackage, ImportPreview, PortableExercise, PortableRoutine } from './types';
import { PortabilityError } from './types';
import { parseRoutinePackage } from './routinePackage';
import { emptyPrescription, type RoutineDraft } from '../types/draft';
import type { TransitionType } from '../types/engine';

export interface ImportResult {
  routineId: string;
  routineName: string;
  createdExercises: number;
  reusedExercises: number;
}

/** Deterministic local identity key for exercise matching (not a DB id). */
export function exerciseMatchKey(name: string, category: string, equipment: string, metricFlags: number): string {
  const n = name.trim().toLowerCase().replace(/\s+/g, ' ');
  const c = category.trim().toLowerCase();
  const e = equipment.trim().toLowerCase();
  return `${n}|${c}|${e}|${metricFlags}`;
}

export interface ImportHooks {
  /** Test-only: called after each created row inside the writer. Throw to force rollback. */
  onRowCreated?: (table: string, count: number) => void;
}

/**
 * Compute import preview without mutating the database.
 */
export async function previewRoutineImport(db: Database, raw: unknown | string): Promise<ImportPreview> {
  const pkg = typeof raw === 'string' ? parseRoutinePackage(raw) : parseRoutinePackage(JSON.stringify(raw));
  const existing = (await db.get('exercises').query().fetch()) as unknown as Array<{
    name: string;
    category: string;
    equipment: string;
    metricFlags: number;
  }>;
  const localKeys = new Set(
    existing.map((e) => exerciseMatchKey(e.name, e.category, e.equipment, e.metricFlags)),
  );
  let matched = 0;
  for (const ex of pkg.exercises) {
    if (localKeys.has(exerciseMatchKey(ex.name, ex.category, ex.equipment, ex.metricFlags))) matched++;
  }
  let steps = 0;
  for (const b of pkg.routine.blocks) steps += b.steps.length;
  return {
    routineName: pkg.routine.name,
    exerciseCount: pkg.exercises.length,
    blockCount: pkg.routine.blocks.length,
    stepCount: steps,
    formatVersion: pkg.formatVersion,
    producerApp: pkg.producer.app,
    producerVersion: pkg.producer.version,
    matchedExercises: matched,
    newExercises: pkg.exercises.length - matched,
  };
}

interface CreatedIds {
  exercises: string[];
  routines: string[];
  blocks: string[];
  steps: string[];
  prescriptions: string[];
  transitions: string[];
}

async function compensateImport(db: Database, created: CreatedIds): Promise<void> {
  try {
    await db.write(async () => {
      for (const id of created.transitions) {
        try {
          const row = await db.get('block_transitions').find(id);
          await row.markAsDeleted();
        } catch { /* already gone */ }
      }
      for (const id of created.prescriptions) {
        try {
          const row = await db.get('routine_exercise_prescriptions').find(id);
          await row.markAsDeleted();
        } catch { /* already gone */ }
      }
      for (const id of created.steps) {
        try {
          const row = await db.get('routine_block_steps').find(id);
          await row.markAsDeleted();
        } catch { /* already gone */ }
      }
      for (const id of created.blocks) {
        try {
          const row = await db.get('routine_blocks').find(id);
          await row.markAsDeleted();
        } catch { /* already gone */ }
      }
      for (const id of created.routines) {
        try {
          const row = await db.get('routines').find(id);
          await row.markAsDeleted();
        } catch { /* already gone */ }
      }
      for (const id of created.exercises) {
        try {
          const row = await db.get('exercises').find(id);
          await row.markAsDeleted();
        } catch { /* already gone */ }
      }
    });
  } catch {
    // Best-effort compensating rollback — never mask the original error.
  }
}

/**
 * Atomic routine import.
 * 1) Parse + validate + checksum (no DB writes).
 * 2) Resolve exercise reuse (reads only).
 * 3) Single db.write for routine + children + new exercises.
 * On any failure: compensating deletes of rows created in this call
 * (works on LokiJS tests and SQLite production alike).
 *
 * Duplicate policy: always creates a NEW routine. Name collisions get
 * deterministic suffixes: "Name (imported)", "Name (imported 2)", …
 */
export async function importRoutinePackage(
  db: Database,
  raw: unknown | string,
  hooks: ImportHooks = {},
): Promise<ImportResult> {
  const pkg: ApexRoutinePackage =
    typeof raw === 'string' ? parseRoutinePackage(raw) : parseRoutinePackage(JSON.stringify(raw));

  // --- reads only ---
  const allExercises = (await db.get('exercises').query().fetch()) as unknown as Array<{
    id: string;
    name: string;
    category: string;
    equipment: string;
    metricFlags: number;
  }>;
  const byMatch = new Map<string, string>();
  for (const e of allExercises) {
    const k = exerciseMatchKey(e.name, e.category, e.equipment, e.metricFlags);
    if (!byMatch.has(k)) byMatch.set(k, e.id);
  }

  const existingRoutineNames = new Set(
    ((await db.get('routines').query().fetch()) as unknown as Array<{ name: string }>).map((r) => r.name),
  );
  const routineName = uniqueRoutineName(pkg.routine.name, existingRoutineNames);

  const reuseIdByKey = new Map<string, string>();
  const createByKey = new Map<string, PortableExercise>();
  for (const ex of pkg.exercises) {
    const k = exerciseMatchKey(ex.name, ex.category, ex.equipment, ex.metricFlags);
    const hit = byMatch.get(k);
    if (hit) reuseIdByKey.set(ex.key, hit);
    else createByKey.set(ex.key, ex);
  }

  const created: CreatedIds = { exercises: [], routines: [], blocks: [], steps: [], prescriptions: [], transitions: [] };

  try {
    const routineId = await db.write(async () => {
      const keyToId = new Map<string, string>(reuseIdByKey);
      for (const [key, ex] of createByKey) {
        const row = await db.get('exercises').create((rec: any) => {
          rec.name = ex.name;
          rec.category = ex.category;
          rec.equipment = ex.equipment;
          rec.metricFlags = ex.metricFlags;
          rec.createdAt = Date.now();
          rec.updatedAt = Date.now();
        });
        created.exercises.push(row.id);
        keyToId.set(key, row.id);
        hooks.onRowCreated?.('exercises', created.exercises.length);
      }

      const resolveExerciseId = (key: string | null): string | null =>
        key ? keyToId.get(key) ?? null : null;

      const r = await db.get('routines').create((rec: any) => {
        rec.name = routineName;
        rec.createdAt = Date.now();
        rec.updatedAt = Date.now();
      });
      created.routines.push(r.id);
      hooks.onRowCreated?.('routines', created.routines.length);

      for (const [bi, b] of pkg.routine.blocks.entries()) {
        const block = await db.get('routine_blocks').create((rec: any) => {
          rec.routineId = r.id;
          rec.name = b.name.trim() || `Block ${bi + 1}`;
          rec.blockKind = b.kind;
          rec.sortOrder = bi;
          rec.rounds = b.kind === 'interval' ? 1 : Math.max(1, Math.round(b.rounds || 1));
          rec.intervalJson = b.kind === 'interval' && b.interval ? JSON.stringify(b.interval) : null;
          rec.createdAt = Date.now();
          rec.updatedAt = Date.now();
        });
        created.blocks.push(block.id);
        hooks.onRowCreated?.('routine_blocks', created.blocks.length);

        for (const [si, s] of b.steps.entries()) {
          const step = await db.get('routine_block_steps').create((rec: any) => {
            rec.blockId = block.id;
            rec.sortOrder = si;
            rec.stepRole = s.role;
            rec.exerciseId = resolveExerciseId(s.exerciseKey);
            rec.createdAt = Date.now();
            rec.updatedAt = Date.now();
          });
          created.steps.push(step.id);
          hooks.onRowCreated?.('routine_block_steps', created.steps.length);
          const presc = await db.get('routine_exercise_prescriptions').create((rec: any) => {
            rec.stepId = step.id;
            rec.targetSets = s.prescription.targetSets;
            rec.targetRepsMin = s.prescription.targetRepsMin;
            rec.targetRepsMax = s.prescription.targetRepsMax;
            rec.targetDurationMs = s.prescription.targetDurationMs;
            rec.targetWeightGrams = s.prescription.targetWeightGrams;
            rec.targetRir = s.prescription.targetRir;
            rec.tempoEccentricMs = s.prescription.tempo.eccentricMs;
            rec.tempoPauseBottomMs = s.prescription.tempo.pauseBottomMs;
            rec.tempoConcentricMs = s.prescription.tempo.concentricMs;
            rec.tempoPauseTopMs = s.prescription.tempo.pauseTopMs;
            rec.createdAt = Date.now();
            rec.updatedAt = Date.now();
          });
          created.prescriptions.push(presc.id);
          hooks.onRowCreated?.('routine_exercise_prescriptions', created.prescriptions.length);
          const tr = await db.get('block_transitions').create((rec: any) => {
            rec.blockId = block.id;
            rec.fromStepId = step.id;
            rec.toStepId = null;
            rec.delayMs = s.transition.type === 'immediate' ? 0 : Math.max(0, Math.round(s.transition.delayMs));
            rec.transitionType = s.transition.type;
            rec.createdAt = Date.now();
            rec.updatedAt = Date.now();
          });
          created.transitions.push(tr.id);
          hooks.onRowCreated?.('block_transitions', created.transitions.length);
        }
      }
      return r.id as string;
    });

    const finalRoutine = (await db.get('routines').find(routineId)) as unknown as { name: string };
    return {
      routineId,
      routineName: finalRoutine.name,
      createdExercises: createByKey.size,
      reusedExercises: reuseIdByKey.size,
    };
  } catch (e) {
    await compensateImport(db, created);
    throw e;
  }
}

export function uniqueRoutineName(base: string, existing: Set<string>): string {
  const trimmed = base.trim() || 'Imported routine';
  if (!existing.has(trimmed)) return trimmed;
  let n = 1;
  let candidate = `${trimmed} (imported)`;
  while (existing.has(candidate)) {
    n += 1;
    candidate = `${trimmed} (imported ${n})`;
  }
  return candidate;
}

function portableToDraft(
  routine: PortableRoutine,
  resolveId: (key: string | null) => string | null,
): {
  blocks: Array<{
    name: string;
    kind: any;
    rounds: number;
    steps: Array<{
      exerciseId: string | null;
      exerciseName: string;
      prescription: any;
      transition: any;
    }>;
    interval: any;
  }>;
} {
  return {
    blocks: routine.blocks.map((b) => ({
      name: b.name,
      kind: b.kind,
      rounds: b.rounds,
      interval: b.interval ?? null,
      steps: b.steps.map((s) => ({
        exerciseId: resolveId(s.exerciseKey),
        exerciseName: s.exerciseName,
        prescription: { ...s.prescription, tempo: { ...s.prescription.tempo } },
        transition: { type: s.transition.type as TransitionType, delayMs: s.transition.delayMs },
      })),
    })),
  };
}

/** Draft-compatible helper for tests / callers that already hold a validated package. */
export function packageToDraft(pkg: ApexRoutinePackage, resolveId: (key: string | null) => string | null): RoutineDraft {
  return {
    id: null,
    name: pkg.routine.name,
    blocks: portableToDraft(pkg.routine, resolveId).blocks.map((b) => ({
      localId: b.kind + Math.random().toString(36).slice(2),
      name: b.name,
      kind: b.kind,
      rounds: b.rounds,
      interval: b.interval,
      steps: b.steps.map((s) => ({
        localId: `s_${Math.random().toString(36).slice(2)}`,
        exerciseId: s.exerciseId,
        exerciseName: s.exerciseName,
        prescription: s.prescription ?? emptyPrescription(),
        transition: s.transition,
      })),
    })),
  };
}
