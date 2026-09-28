import { Database, Q } from '@nozbe/watermelondb';
import { RoutineDefinition, ExecutionCursor, Effect, StepDef, BlockDef, TransitionType } from '../types/engine';
import { classifySetExecution, normalizeOverrideReason } from '../workout/execution';
import { RoutineDraft, emptyPrescription } from '../types/draft';
import { BODY_MEASUREMENT_TYPES, BODY_STORAGE_UNITS, isBilateralMeasurement } from '../types/body';
import { initialCursor } from '../engine/cursor';
import {
  Exercise,
  Routine,
  Program,
  Mesocycle,
  Goal,
  BodyMetric,
  RoutineBlock,
  RoutineBlockStep,
  Prescription,
  BlockTransition,
  WorkoutSession,
  SetLog,
  ReadinessTest,
} from './models';
import { SEED_EXERCISES } from '../../scripts/seed-exercises';

/** DB writer actions — the de-facto repository layer (no extra repository tier). */

const now = () => Date.now();

let draftIdCounter = 0;
export const newLocalId = (prefix: string) => `${prefix}_${++draftIdCounter}_${Date.now().toString(36)}`;

async function loadDraft(db: Database, routineId: string): Promise<RoutineDraft> {
  const routine = await db.get<Routine>('routines').find(routineId);
  const blocks = await db.get<RoutineBlock>('routine_blocks').query(Q.where('routine_id', routineId)).fetch();
  blocks.sort((a, b) => a.sortOrder - b.sortOrder);

  const draftBlocks = [];
  for (const block of blocks) {
    const steps = await db.get<RoutineBlockStep>('routine_block_steps').query(Q.where('block_id', block.id)).fetch();
    steps.sort((a, b) => a.sortOrder - b.sortOrder);

    const transitions = await db.get<BlockTransition>('block_transitions').query(Q.where('block_id', block.id)).fetch();
    const transitionByFrom = new Map(transitions.map((t) => [t.fromStepId, t]));

    const draftSteps = [];
    for (const step of steps) {
      const prescriptions = await db
        .get<Prescription>('routine_exercise_prescriptions')
        .query(Q.where('step_id', step.id))
        .fetch();
      const p = prescriptions[0];
      let exerciseName = '';
      if (step.exerciseId) {
        try {
          exerciseName = (await db.get<Exercise>('exercises').find(step.exerciseId)).name;
        } catch {
          exerciseName = '';
        }
      }
      const t = transitionByFrom.get(step.id);
      draftSteps.push({
        localId: step.id,
        exerciseId: step.exerciseId,
        exerciseName,
        prescription: p
          ? {
              targetSets: p.targetSets,
              targetRepsMin: p.targetRepsMin,
              targetRepsMax: p.targetRepsMax,
              targetDurationMs: p.targetDurationMs,
              targetWeightGrams: p.targetWeightGrams,
              targetRir: p.targetRir,
              tempo: {
                eccentricMs: p.tempoEccentricMs,
                pauseBottomMs: p.tempoPauseBottomMs,
                concentricMs: p.tempoConcentricMs,
                pauseTopMs: p.tempoPauseTopMs,
              },
            }
          : emptyPrescription(),
        transition: {
          type: (t?.transitionType as TransitionType) ?? 'immediate',
          delayMs: t?.delayMs ?? 0,
        },
      });
    }

    draftBlocks.push({
      localId: block.id,
      name: block.name,
      kind: block.blockKind as RoutineDraft['blocks'][number]['kind'],
      rounds: block.rounds,
      steps: draftSteps,
      interval: block.intervalJson ? (JSON.parse(block.intervalJson) as RoutineDraft['blocks'][number]['interval']) : null,
    });
  }

  return { id: routine.id, name: routine.name, blocks: draftBlocks };
}

export interface DbActions {
  seedExercisesIfEmpty(): Promise<number>;
  createExercise(input: { name: string; category: string; equipment: string; metricFlags: number }): Promise<string>;
  updateExercise(
    id: string,
    input: { name: string; category: string; equipment: string; metricFlags: number },
  ): Promise<void>;
  deleteExercise(id: string): Promise<void>;
  /** Counts routine steps that reference an exercise (sessions use immutable snapshots). */
  countExerciseReferences(id: string): Promise<number>;
  listExercises(): Promise<Exercise[]>;

  createRoutine(name: string): Promise<string>;
  updateRoutineName(id: string, name: string): Promise<void>;
  deleteRoutine(id: string): Promise<void>;
  listRoutinesWithCounts(): Promise<Array<{ id: string; name: string; blockCount: number; stepCount: number }>>;

  createProgram(name: string): Promise<string>;
  renameProgram(id: string, name: string): Promise<void>;
  /** Detaches member routines (preserved), deletes mesocycles, then the program. */
  deleteProgram(id: string): Promise<void>;
  listProgramsWithCounts(): Promise<Array<{ id: string; name: string; routineCount: number }>>;
  listProgramRoutines(programId: string): Promise<Array<{ id: string; name: string; order: number; mesocycleId: string | null }>>;
  listUnassignedRoutines(): Promise<Array<{ id: string; name: string }>>;
  assignRoutineToProgram(routineId: string, programId: string): Promise<void>;
  removeRoutineFromProgram(routineId: string): Promise<void>;

  createMesocycle(programId: string, name: string): Promise<string>;
  renameMesocycle(id: string, name: string): Promise<void>;
  /** Detaches staged routines (preserved) and deletes the mesocycle container. */
  deleteMesocycle(id: string): Promise<void>;
  listMesocycles(programId: string): Promise<Array<{ id: string; name: string; sortOrder: number; routineCount: number }>>;
  /** Stages a routine; rejects when routine and mesocycle belong to different programs. */
  assignRoutineToMesocycle(routineId: string, mesocycleId: string): Promise<void>;
  removeRoutineFromMesocycle(routineId: string): Promise<void>;

  /** Creates a strength goal; rejects unknown exercise or duplicate target. */
  createGoal(exerciseId: string, targetWeightGrams: number): Promise<string>;
  deleteGoal(id: string): Promise<void>;
  listGoals(): Promise<Array<{ id: string; exerciseId: string; targetWeightGrams: number; createdAt: number }>>;

  /** Logs one canonical body measurement in integer storage units. */
  logBodyMetrics(input: {
    measuredAt: number;
    measurementType: string;
    side?: string | null;
    value: number;
    unit: string;
  }): Promise<string>;
  deleteBodyMetric(id: string): Promise<void>;
  listBodyMetrics(): Promise<Array<{
    id: string;
    measuredAt: number;
    measurementType: string | null;
    side: string | null;
    value: number | null;
    unit: string | null;
    weightGrams: number | null;
    waistMm: number | null;
  }>>;

  loadRoutineDraft(routineId: string): Promise<RoutineDraft>;
  saveRoutineDraft(draft: RoutineDraft): Promise<string>;
  createBlock(routineId: string, input: { name: string; kind: string; rounds: number }): Promise<string>;
  createStep(blockId: string, exerciseId: string | null, exerciseName: string): Promise<string>;
  upsertPrescription(stepId: string, p: {
    targetSets: number | null; targetRepsMin: number | null; targetRepsMax: number | null;
    targetDurationMs: number | null; targetWeightGrams: number | null; targetRir: number | null;
    tempo: { eccentricMs: number | null; pauseBottomMs: number | null; concentricMs: number | null; pauseTopMs: number | null };
  }): Promise<void>;
  upsertTransition(blockId: string, fromStepId: string, to: { toStepId: string | null }, type: string, delayMs: number): Promise<void>;

  startSession(routine: Routine, definition: RoutineDefinition): Promise<string>;
  getActiveSession(): Promise<WorkoutSession | null>;
  persistCursor(session: WorkoutSession, cursor: ExecutionCursor): Promise<void>;
  completeSession(session: WorkoutSession, cursor: ExecutionCursor): Promise<void>;
  discardSession(session: WorkoutSession): Promise<void>;

  findSessionExercise(sessionId: string, blockIndex: number, orderIndex: number, exerciseName: string): Promise<any>;
  /** Applies DB-backed effects and returns the cursor with lastReversible.setLogId filled for LOG_SET. */
  applyEffects(session: WorkoutSession, cursor: ExecutionCursor, effects: Effect[]): Promise<ExecutionCursor>;

  createReadinessTest(input: { testedAt: number; durationMs: number; tapCount: number }): Promise<string>;
  listReadinessTests(limit?: number): Promise<ReadinessTest[]>;
}

export function makeDbActions(db: Database): DbActions {
  const exercisesCol = () => db.get<Exercise>('exercises');
  const sessionsCol = () => db.get<WorkoutSession>('workout_sessions');
  const setLogsCol = () => db.get<SetLog>('set_logs');

  return {
    async seedExercisesIfEmpty() {
      return db.write(async () => {
        const count = await exercisesCol().query().fetchCount();
        if (count > 0) return 0;
        let inserted = 0;
        for (const seed of SEED_EXERCISES) {
          // Deterministic seed ids: primary key for built-in muscle mapping (Phase 2F).
          const rec = exercisesCol().prepareCreateFromDirtyRaw({
            id: seed.id,
            name: seed.name,
            category: seed.category,
            equipment: seed.equipment,
            metric_flags: seed.metricFlags,
            created_at: now(),
            updated_at: now(),
          });
          await db.batch(rec);
          inserted += 1;
        }
        return inserted;
      });
    },

    async createExercise({ name, category, equipment, metricFlags }) {
      return db.write(async () => {
        const ex = await exercisesCol().create((e) => {
          e.name = name;
          e.category = category;
          e.equipment = equipment;
          e.metricFlags = metricFlags;
          e.createdAt = now();
          e.updatedAt = now();
        });
        return ex.id;
      });
    },

    async updateExercise(id, input) {
      await db.write(async () => {
        const ex = await exercisesCol().find(id);
        await ex.update((e) => {
          e.name = input.name;
          e.category = input.category;
          e.equipment = input.equipment;
          e.metricFlags = input.metricFlags;
          e.updatedAt = now();
        });
      });
    },

    async deleteExercise(id) {
      await db.write(async () => {
        const ex = await exercisesCol().find(id);
        await ex.markAsDeleted();
      });
    },

    async countExerciseReferences(id) {
      return db
        .get<RoutineBlockStep>('routine_block_steps')
        .query(Q.where('exercise_id', id))
        .fetchCount();
    },

    async listExercises() {
      return exercisesCol().query().fetch();
    },

    async createRoutine(name) {
      return db.write(async () => {
        const r = await db.get<Routine>('routines').create((rec) => {
          rec.name = name;
          rec.createdAt = now();
          rec.updatedAt = now();
        });
        return r.id;
      });
    },

    async updateRoutineName(id, name) {
      await db.write(async () => {
        const r = await db.get<Routine>('routines').find(id);
        await r.update((rec) => {
          rec.name = name;
          rec.updatedAt = now();
        });
      });
    },

    async deleteRoutine(id) {
      await db.write(async () => {
        const blocks = await db.get<RoutineBlock>('routine_blocks').query(Q.where('routine_id', id)).fetch();
        for (const block of blocks) {
          const steps = await db.get<RoutineBlockStep>('routine_block_steps').query(Q.where('block_id', block.id)).fetch();
          for (const step of steps) {
            const prescriptions = await db
              .get<Prescription>('routine_exercise_prescriptions')
              .query(Q.where('step_id', step.id))
              .fetch();
            for (const p of prescriptions) await p.markAsDeleted();
            await step.markAsDeleted();
          }
          const transitions = await db.get<BlockTransition>('block_transitions').query(Q.where('block_id', block.id)).fetch();
          for (const t of transitions) await t.markAsDeleted();
          await block.markAsDeleted();
        }
        const routine = await db.get<Routine>('routines').find(id);
        await routine.markAsDeleted();
      });
    },

    async listRoutinesWithCounts() {
      const routines = await db.get<Routine>('routines').query(Q.sortBy('updated_at', 'desc')).fetch();
      const blocks = await db.get<RoutineBlock>('routine_blocks').query().fetch();
      const steps = await db.get<RoutineBlockStep>('routine_block_steps').query().fetch();
      const blockCountByRoutine = new Map<string, number>();
      const blockIdsByRoutine = new Map<string, Set<string>>();
      for (const b of blocks) {
        blockCountByRoutine.set(b.routineId, (blockCountByRoutine.get(b.routineId) ?? 0) + 1);
        if (!blockIdsByRoutine.has(b.routineId)) blockIdsByRoutine.set(b.routineId, new Set());
        blockIdsByRoutine.get(b.routineId)!.add(b.id);
      }
      const stepCountByRoutine = new Map<string, number>();
      for (const s of steps) {
        for (const [routineId, blockIds] of blockIdsByRoutine) {
          if (blockIds.has(s.blockId)) {
            stepCountByRoutine.set(routineId, (stepCountByRoutine.get(routineId) ?? 0) + 1);
            break;
          }
        }
      }
      return routines.map((r) => ({
        id: r.id,
        name: r.name,
        blockCount: blockCountByRoutine.get(r.id) ?? 0,
        stepCount: stepCountByRoutine.get(r.id) ?? 0,
      }));
    },

    async createProgram(name) {
      return db.write(async () => {
        const p = await db.get<Program>('programs').create((rec) => {
          rec.name = name;
          rec.createdAt = now();
          rec.updatedAt = now();
        });
        return p.id;
      });
    },

    async renameProgram(id, name) {
      await db.write(async () => {
        const p = await db.get<Program>('programs').find(id);
        await p.update((rec) => {
          rec.name = name;
          rec.updatedAt = now();
        });
      });
    },

    async deleteProgram(id) {
      await db.write(async () => {
        const members = await db
          .get<Routine>('routines')
          .query(Q.where('program_id', id))
          .fetch();
        for (const r of members) {
          await r.update((rec) => {
            rec.programId = null;
            rec.programOrder = null;
            rec.mesocycleId = null;
            rec.updatedAt = now();
          });
        }
        const mesos = await db
          .get<Mesocycle>('mesocycles')
          .query(Q.where('program_id', id))
          .fetch();
        for (const m of mesos) await m.markAsDeleted();
        const p = await db.get<Program>('programs').find(id);
        await p.markAsDeleted();
      });
    },

    async listProgramsWithCounts() {
      const programs = await db.get<Program>('programs').query(Q.sortBy('created_at', 'asc')).fetch();
      const routines = await db.get<Routine>('routines').query().fetch();
      const countByProgram = new Map<string, number>();
      for (const r of routines) {
        if (r.programId == null) continue;
        countByProgram.set(r.programId, (countByProgram.get(r.programId) ?? 0) + 1);
      }
      return programs.map((p) => ({
        id: p.id,
        name: p.name,
        routineCount: countByProgram.get(p.id) ?? 0,
      }));
    },

    async listProgramRoutines(programId) {
      const routines = await db
        .get<Routine>('routines')
        .query(Q.where('program_id', programId))
        .fetch();
      return routines
        .map((r) => ({
          id: r.id,
          name: r.name,
          order: r.programOrder ?? Number.MAX_SAFE_INTEGER,
          mesocycleId: r.mesocycleId,
        }))
        .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    },

    async listUnassignedRoutines() {
      // Filter in memory: WatermelonDB has no portable IS NULL operator and
      // routine counts are small (no N+1, single fetch).
      const routines = await db
        .get<Routine>('routines')
        .query(Q.sortBy('updated_at', 'desc'))
        .fetch();
      return routines.filter((r) => r.programId == null).map((r) => ({ id: r.id, name: r.name }));
    },

    async assignRoutineToProgram(routineId, programId) {
      await db.write(async () => {
        // Verify the program exists before mutating the routine.
        await db.get<Program>('programs').find(programId);
        const members = await db
          .get<Routine>('routines')
          .query(Q.where('program_id', programId))
          .fetch();
        let next = 1;
        for (const m of members) {
          if (m.id !== routineId && m.programOrder != null && m.programOrder >= next) next = m.programOrder + 1;
        }
        const routine = await db.get<Routine>('routines').find(routineId);
        await routine.update((rec) => {
          rec.programId = programId;
          rec.programOrder = next;
          // Staging from a previous program no longer applies.
          rec.mesocycleId = null;
          rec.updatedAt = now();
        });
      });
    },

    async removeRoutineFromProgram(routineId) {
      await db.write(async () => {
        const routine = await db.get<Routine>('routines').find(routineId);
        await routine.update((rec) => {
          rec.programId = null;
          rec.programOrder = null;
          rec.mesocycleId = null;
          rec.updatedAt = now();
        });
      });
    },

    async createMesocycle(programId, name) {
      return db.write(async () => {
        // Verify the program exists before creating a phase inside it.
        await db.get<Program>('programs').find(programId);
        const existing = await db
          .get<Mesocycle>('mesocycles')
          .query(Q.where('program_id', programId))
          .fetch();
        let next = 1;
        for (const m of existing) if (m.sortOrder >= next) next = m.sortOrder + 1;
        const row = await db.get<Mesocycle>('mesocycles').create((rec) => {
          rec.name = name;
          rec.programId = programId;
          rec.sortOrder = next;
          rec.createdAt = now();
          rec.updatedAt = now();
        });
        return row.id;
      });
    },

    async renameMesocycle(id, name) {
      await db.write(async () => {
        const m = await db.get<Mesocycle>('mesocycles').find(id);
        await m.update((rec) => {
          rec.name = name;
          rec.updatedAt = now();
        });
      });
    },

    async deleteMesocycle(id) {
      await db.write(async () => {
        const staged = await db
          .get<Routine>('routines')
          .query(Q.where('mesocycle_id', id))
          .fetch();
        for (const r of staged) {
          await r.update((rec) => {
            rec.mesocycleId = null;
            rec.updatedAt = now();
          });
        }
        const m = await db.get<Mesocycle>('mesocycles').find(id);
        await m.markAsDeleted();
      });
    },

    async listMesocycles(programId) {
      const mesos = await db
        .get<Mesocycle>('mesocycles')
        .query(Q.where('program_id', programId))
        .fetch();
      const routines = await db.get<Routine>('routines').query().fetch();
      const countByMeso = new Map<string, number>();
      for (const r of routines) {
        if (r.mesocycleId == null) continue;
        countByMeso.set(r.mesocycleId, (countByMeso.get(r.mesocycleId) ?? 0) + 1);
      }
      return mesos
        .map((m) => ({
          id: m.id,
          name: m.name,
          sortOrder: m.sortOrder,
          routineCount: countByMeso.get(m.id) ?? 0,
        }))
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    },

    async assignRoutineToMesocycle(routineId, mesocycleId) {
      await db.write(async () => {
        const meso = await db.get<Mesocycle>('mesocycles').find(mesocycleId);
        const routine = await db.get<Routine>('routines').find(routineId);
        if (routine.programId == null || routine.programId !== meso.programId) {
          throw new Error('routine is not a member of the mesocycle program');
        }
        await routine.update((rec) => {
          rec.mesocycleId = mesocycleId;
          rec.updatedAt = now();
        });
      });
    },

    async removeRoutineFromMesocycle(routineId) {
      await db.write(async () => {
        const routine = await db.get<Routine>('routines').find(routineId);
        await routine.update((rec) => {
          rec.mesocycleId = null;
          rec.updatedAt = now();
        });
      });
    },

    async createGoal(exerciseId, targetWeightGrams) {
      return db.write(async () => {
        await db.get<Exercise>('exercises').find(exerciseId);
        if (!Number.isInteger(targetWeightGrams) || targetWeightGrams <= 0) {
          throw new Error('goal target must be a positive integer of grams');
        }
        const existing = await db
          .get<Goal>('goals')
          .query(Q.where('exercise_id', exerciseId))
          .fetch();
        if (existing.length > 0) throw new Error('exercise already has a goal');
        const row = await db.get<Goal>('goals').create((rec) => {
          rec.exerciseId = exerciseId;
          rec.targetWeightGrams = targetWeightGrams;
          rec.createdAt = now();
          rec.updatedAt = now();
        });
        return row.id;
      });
    },

    async deleteGoal(id) {
      await db.write(async () => {
        const goal = await db.get<Goal>('goals').find(id);
        await goal.markAsDeleted();
      });
    },

    async listGoals() {
      const rows = await db.get<Goal>('goals').query(Q.sortBy('created_at', 'asc')).fetch();
      return rows.map((g) => ({
        id: g.id,
        exerciseId: g.exerciseId,
        targetWeightGrams: g.targetWeightGrams,
        createdAt: g.createdAt,
      }));
    },

    async logBodyMetrics(input) {
      return db.write(async () => {
        const { measuredAt, measurementType, side, value, unit } = input;
        const positive = (v: number | null) => v != null && Number.isInteger(v) && v > 0;
        if (!BODY_MEASUREMENT_TYPES.includes(measurementType as (typeof BODY_MEASUREMENT_TYPES)[number])) {
          throw new Error('measurement type is not supported');
        }
        if (!positive(value)) throw new Error('value must be a positive integer');
        if (unit !== BODY_STORAGE_UNITS[measurementType as keyof typeof BODY_STORAGE_UNITS]) {
          throw new Error('unit must match the measurement type');
        }
        if (!Number.isFinite(measuredAt) || measuredAt <= 0) {
          throw new Error('measuredAt must be a positive timestamp');
        }
        if (isBilateralMeasurement(measurementType)) {
          if (side !== 'left' && side !== 'right') {
            throw new Error('side must be left or right for bilateral measurements');
          }
        } else if (side != null) {
          throw new Error('side is only supported for bilateral measurements');
        }

        const row = await db.get<BodyMetric>('body_metrics').create((rec) => {
          rec.measuredAt = measuredAt;
          rec.measurementType = measurementType;
          rec.side = side ?? null;
          rec.value = value;
          rec.unit = unit;
          rec.weightGrams = measurementType === 'body_weight' ? value : null;
          rec.waistMm = measurementType === 'waist' ? value : null;
          rec.createdAt = now();
          rec.updatedAt = now();
        });
        return row.id;
      });
    },

    async deleteBodyMetric(id) {
      await db.write(async () => {
        const row = await db.get<BodyMetric>('body_metrics').find(id);
        await row.markAsDeleted();
      });
    },

    async listBodyMetrics() {
      const rows = await db
        .get<BodyMetric>('body_metrics')
        .query(Q.sortBy('measured_at', 'desc'))
        .fetch();
      return rows.map((m) => ({
        id: m.id,
        measuredAt: m.measuredAt,
        measurementType: m.measurementType,
        side: m.side,
        value: m.value,
        unit: m.unit,
        weightGrams: m.weightGrams,
        waistMm: m.waistMm,
      }));
    },

    async loadRoutineDraft(routineId) {
      return loadDraft(db, routineId);
    },

    async saveRoutineDraft(draft) {
      return db.write(async () => {
        const ts = now();
        const name = draft.name.trim();
        let routineId = draft.id;
        if (routineId) {
          const r = await db.get<Routine>('routines').find(routineId);
          await r.update((rec) => {
            rec.name = name;
            rec.updatedAt = ts;
          });
        } else {
          const r = await db.get<Routine>('routines').create((rec) => {
            rec.name = name;
            rec.createdAt = ts;
            rec.updatedAt = ts;
          });
          routineId = r.id;
        }

        // Replace-children strategy: sessions only reference routine_id and frozen
        // definition_json snapshots, so recreating steps is safe and keeps ordering trivial.
        const oldBlocks = await db.get<RoutineBlock>('routine_blocks').query(Q.where('routine_id', routineId)).fetch();
        for (const block of oldBlocks) {
          const oldSteps = await db.get<RoutineBlockStep>('routine_block_steps').query(Q.where('block_id', block.id)).fetch();
          for (const step of oldSteps) {
            const ps = await db.get<Prescription>('routine_exercise_prescriptions').query(Q.where('step_id', step.id)).fetch();
            for (const p of ps) await p.markAsDeleted();
            await step.markAsDeleted();
          }
          const ts2 = await db.get<BlockTransition>('block_transitions').query(Q.where('block_id', block.id)).fetch();
          for (const t of ts2) await t.markAsDeleted();
          await block.markAsDeleted();
        }

        for (const [bi, b] of draft.blocks.entries()) {
          const block = await db.get<RoutineBlock>('routine_blocks').create((rec) => {
            rec.routineId = routineId!;
            rec.name = b.name.trim() || `Block ${bi + 1}`;
            rec.blockKind = b.kind;
            rec.sortOrder = bi;
            rec.rounds = b.kind === 'interval' ? 1 : Math.max(1, Math.round(b.rounds || 1));
            rec.intervalJson =
              b.kind === 'interval' && b.interval ? JSON.stringify(b.interval) : null;
            rec.createdAt = ts;
            rec.updatedAt = ts;
          });
          for (const [si, s] of b.steps.entries()) {
            const step = await db.get<RoutineBlockStep>('routine_block_steps').create((rec) => {
              rec.blockId = block.id;
              rec.sortOrder = si;
              rec.stepRole = 'work';
              rec.exerciseId = s.exerciseId;
              rec.createdAt = ts;
              rec.updatedAt = ts;
            });
            await db.get<Prescription>('routine_exercise_prescriptions').create((rec) => {
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
              rec.createdAt = ts;
              rec.updatedAt = ts;
            });
            await db.get<BlockTransition>('block_transitions').create((rec) => {
              rec.blockId = block.id;
              rec.fromStepId = step.id;
              rec.toStepId = null; // implicit forward/loop target (engine positional advance)
              rec.delayMs = s.transition.type === 'immediate' ? 0 : Math.max(0, Math.round(s.transition.delayMs));
              rec.transitionType = s.transition.type;
              rec.createdAt = ts;
              rec.updatedAt = ts;
            });
          }
        }
        return routineId!;
      });
    },

    async createBlock(routineId, { name, kind, rounds }) {
      return db.write(async () => {
        const existing = await db.get<RoutineBlock>('routine_blocks').query(Q.where('routine_id', routineId)).fetch();
        const b = await db.get<RoutineBlock>('routine_blocks').create((rec) => {
          rec.routineId = routineId;
          rec.name = name;
          rec.blockKind = kind;
          rec.sortOrder = existing.length;
          rec.rounds = rounds;
          rec.createdAt = now();
          rec.updatedAt = now();
        });
        return b.id;
      });
    },

    async createStep(blockId, exerciseId, exerciseName) {
      return db.write(async () => {
        const steps = await db.get<RoutineBlockStep>('routine_block_steps').query(Q.where('block_id', blockId)).fetch();
        const s = await db.get<RoutineBlockStep>('routine_block_steps').create((rec) => {
          rec.blockId = blockId;
          rec.sortOrder = steps.length;
          rec.stepRole = 'work';
          rec.exerciseId = exerciseId;
          rec.createdAt = now();
          rec.updatedAt = now();
        });
        // Prescription row is created together with the step (1:1).
        await db.get<Prescription>('routine_exercise_prescriptions').create((p) => {
          p.stepId = s.id;
          p.createdAt = now();
          p.updatedAt = now();
        });
        void exerciseName;
        return s.id;
      });
    },

    async upsertPrescription(stepId, p) {
      await db.write(async () => {
        const rows = await db
          .get<Prescription>('routine_exercise_prescriptions')
          .query(Q.where('step_id', stepId))
          .fetch();
        const values = {
          targetSets: p.targetSets,
          targetRepsMin: p.targetRepsMin,
          targetRepsMax: p.targetRepsMax,
          targetDurationMs: p.targetDurationMs,
          targetWeightGrams: p.targetWeightGrams,
          targetRir: p.targetRir,
          tempoEccentricMs: p.tempo.eccentricMs,
          tempoPauseBottomMs: p.tempo.pauseBottomMs,
          tempoConcentricMs: p.tempo.concentricMs,
          tempoPauseTopMs: p.tempo.pauseTopMs,
          updatedAt: now(),
        };
        if (rows.length > 0) await rows[0].update((rec) => Object.assign(rec, values));
        else await db.get<Prescription>('routine_exercise_prescriptions').create((rec: Prescription) => { Object.assign(rec, values); rec.stepId = stepId; rec.createdAt = now(); });
      });
    },

    async upsertTransition(blockId, fromStepId, to, type, delayMs) {
      await db.write(async () => {
        const rows = await db
          .get<any>('block_transitions')
          .query(Q.where('block_id', blockId), Q.where('from_step_id', fromStepId))
          .fetch();
        const values = { toStepId: to.toStepId, transitionType: type, delayMs, updatedAt: now() };
        if (rows.length > 0) await rows[0].update((rec: any) => Object.assign(rec, values));
        else
          await db.get<any>('block_transitions').create((rec: any) => {
            rec.blockId = blockId;
            rec.fromStepId = fromStepId;
            Object.assign(rec, values);
            rec.createdAt = now();
          });
      });
    },

    async startSession(routine, definition) {
      return db.write(async () => {
        const cursor = initialCursor(definition);
        const s = await sessionsCol().create((rec) => {
          rec.routineId = routine.id;
          rec.name = routine.name;
          rec.startedAt = now();
          rec.sessionStatus = 'active';
          rec.definitionJson = JSON.stringify(definition);
          rec.cursorJson = JSON.stringify(cursor);
          rec.currentBlockIndex = cursor.blockIndex;
          rec.currentRound = cursor.round;
          rec.currentSetIndex = cursor.setIndex;
          rec.timerExpiresAt = null;
          rec.createdAt = now();
          rec.updatedAt = now();
        });
        return s.id;
      });
    },

    async getActiveSession() {
      const rows = await sessionsCol().query(Q.where('session_status', 'active')).fetch();
      if (rows.length === 0) return null;
      // Defensive: only one active session is expected; newest wins.
      rows.sort((a, b) => b.startedAt - a.startedAt);
      return rows[0];
    },

    async persistCursor(session, cursor) {
      await db.write(async () => {
        await session.update((rec) => {
          rec.cursorJson = JSON.stringify(cursor);
          // Derived caches, written atomically with the cursor (cursor_json wins on divergence).
          rec.sessionStatus = cursor.status;
          rec.timerExpiresAt = cursor.timer ? cursor.timer.expiresAt : null;
          rec.currentBlockIndex = cursor.blockIndex;
          rec.currentRound = cursor.round;
          rec.currentSetIndex = cursor.setIndex;
          const block: BlockDef | undefined = JSON.parse(session.definitionJson).blocks[cursor.blockIndex];
          rec.currentStepId = block?.steps[cursor.stepIndex]?.id ?? null;
          rec.updatedAt = now();
        });
      });
    },

    async completeSession(session, cursor) {
      await db.write(async () => {
        await session.update((rec) => {
          rec.cursorJson = JSON.stringify(cursor);
          rec.sessionStatus = 'completed';
          rec.endedAt = now();
          rec.timerExpiresAt = null;
          rec.updatedAt = now();
        });
      });
    },

    async discardSession(session) {
      await db.write(async () => {
        const logs = await setLogsCol().query().fetch();
        const sessionId = session.id;
        for (const log of logs) {
          void log; // set_logs are removed via session cascade below
        }
        const sesExs = await db.get<any>('session_exercises').query(Q.where('session_id', sessionId)).fetch();
        for (const se of sesExs) {
          const logs2 = await setLogsCol().query(Q.where('session_exercise_id', se.id)).fetch();
          for (const l of logs2) await l.markAsDeleted();
          await se.markAsDeleted();
        }
        await session.markAsDeleted();
      });
    },

    async findSessionExercise(sessionId, blockIndex, orderIndex, exerciseName) {
      const rows = await db
        .get<any>('session_exercises')
        .query(
          Q.where('session_id', sessionId),
          Q.where('block_index', blockIndex),
          Q.where('order_index', orderIndex),
        )
        .fetch();
      if (rows.length > 0) return rows[0];
      return db.write(async () =>
        db.get<any>('session_exercises').create((rec: any) => {
          rec.sessionId = sessionId;
          rec.exerciseId = null;
          rec.exerciseName = exerciseName;
          rec.blockIndex = blockIndex;
          rec.orderIndex = orderIndex;
          rec.createdAt = now();
          rec.updatedAt = now();
        }),
      );
    },

    async applyEffects(session, cursor, effects) {
      let createdLogId: string | null = null;
      let createdLogKey: string | null = null;
      // Only performed sets are voidable: skipped rows carry no setLogId so the
      // runner-applied cursor still agrees with the pure engine dispatch.
      let createdLogVoidable = false;
      await db.write(async () => {
        const definition: RoutineDefinition = JSON.parse(session.definitionJson);
        // NOTE: never call db.write() inside this writer (WatermelonDB's writer queue is
        // not reentrant — nested writers deadlock). All sub-operations run in THIS write.
        const ensureSessionExercise = async (blockIndex: number, orderIndex: number, exerciseName: string) => {
          const rows = await db
            .get<any>('session_exercises')
            .query(Q.where('session_id', session.id), Q.where('block_index', blockIndex), Q.where('order_index', orderIndex))
            .fetch();
          if (rows.length > 0) return rows[0];
          return db.get<any>('session_exercises').create((rec: any) => {
            rec.sessionId = session.id;
            rec.exerciseId = null;
            rec.exerciseName = exerciseName;
            rec.blockIndex = blockIndex;
            rec.orderIndex = orderIndex;
            rec.createdAt = now();
            rec.updatedAt = now();
          });
        };
        for (const effect of effects) {
          if (effect.kind === 'LOG_SET') {
            const block: BlockDef | undefined = definition.blocks[effect.blockIndex];
            const step: StepDef | undefined = block?.steps[effect.stepIndex];
            if (!block || !step) continue;
            const orderIndex = block.steps.indexOf(step);
            const se = await ensureSessionExercise(effect.blockIndex, orderIndex, step.exerciseName);
            // Phase 3C: extra/drop marking travels on the effect; normal flow is
            // classified against the immutable prescription (definition never mutated).
            const executionType: 'normal' | 'modified' | 'extra' | 'drop' =
              effect.executionType ?? classifySetExecution(step.prescription, effect.set);
            const log = await setLogsCol().create((rec) => {
              rec.sessionExerciseId = se.id;
              rec.blockIndex = effect.blockIndex;
              rec.stepIndex = effect.stepIndex;
              rec.round = effect.round;
              rec.setIndex = effect.setIndex;
              rec.weightGrams = effect.set.weightGrams;
              rec.reps = effect.set.reps;
              rec.durationMs = effect.set.durationMs;
              rec.distanceMm = effect.set.distanceMm;
              rec.rir = effect.set.rir;
              rec.isCompleted = 1;
              rec.completedAt = now();
              rec.executionType = executionType;
              rec.overrideReason = normalizeOverrideReason(effect.set.overrideReason);
              rec.createdAt = now();
              rec.updatedAt = now();
            });
            createdLogId = log.id;
            createdLogKey = `${effect.blockIndex}:${effect.stepIndex}:${effect.round}:${effect.setIndex}`;
            createdLogVoidable = true;
          } else if (effect.kind === 'LOG_SKIPPED_SET') {
            const block: BlockDef | undefined = definition.blocks[effect.blockIndex];
            const step: StepDef | undefined = block?.steps[effect.stepIndex];
            if (!block || !step) continue;
            const orderIndex = block.steps.indexOf(step);
            const se = await ensureSessionExercise(effect.blockIndex, orderIndex, step.exerciseName);
            const log = await setLogsCol().create((rec) => {
              rec.sessionExerciseId = se.id;
              rec.blockIndex = effect.blockIndex;
              rec.stepIndex = effect.stepIndex;
              rec.round = effect.round;
              rec.setIndex = effect.setIndex;
              rec.weightGrams = null;
              rec.reps = null;
              rec.durationMs = null;
              rec.distanceMm = null;
              rec.rir = null;
              rec.isCompleted = 0;
              rec.completedAt = null;
              rec.executionType = 'skipped';
              rec.overrideReason = null;
              rec.createdAt = now();
              rec.updatedAt = now();
            });
            createdLogId = log.id;
            createdLogKey = `${effect.blockIndex}:${effect.stepIndex}:${effect.round}:${effect.setIndex}`;
          } else if (effect.kind === 'VOID_LAST_SET') {
            if (!effect.setLogId) continue; // nothing persisted yet — nothing to void
            try {
              const log = await setLogsCol().find(effect.setLogId);
              await log.update((rec) => {
                rec.isCompleted = 0;
                rec.updatedAt = now();
              });
            } catch {
              // log already gone — idempotent
            }
          } else if (effect.kind === 'COMPLETE_SESSION') {
            await session.update((rec) => {
              rec.sessionStatus = 'completed';
              rec.endedAt = now();
              rec.timerExpiresAt = null;
              rec.updatedAt = now();
            });
          }
          // Timer/notification effects are handled by the timer service (not DB).
        }
      });
      // Application-layer duty: attach the real set_log id so UNDO can void it.
      const last = cursor.lastReversible;
      if (createdLogId && createdLogVoidable && last && last.kind === 'set') {
        const key = `${last.blockIndex}:${last.stepIndex}:${last.round}:${last.setIndex}`;
        if (key === createdLogKey) {
          return { ...cursor, lastReversible: { ...last, setLogId: createdLogId } };
        }
      }
      return cursor;
    },

    async createReadinessTest(input) {
      return db.write(async () => {
        const row = await db.get<ReadinessTest>('readiness_tests').create((rec) => {
          rec.testedAt = input.testedAt;
          rec.durationMs = input.durationMs;
          rec.tapCount = input.tapCount;
          rec.createdAt = now();
          rec.updatedAt = now();
        });
        return row.id;
      });
    },

    async listReadinessTests(limit = 50) {
      return db
        .get<ReadinessTest>('readiness_tests')
        .query(Q.sortBy('tested_at', 'desc'), Q.take(limit))
        .fetch();
    },
  };
}
