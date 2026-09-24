import { Database, Q } from '@nozbe/watermelondb';
import { Routine, RoutineBlock, RoutineBlockStep, Prescription, BlockTransition, WorkoutSession } from './models';
import { RoutineDefinition, ExecutionCursor } from '../types/engine';
import { parseCursor } from '../engine/cursor';

/** Snapshot (§11): the executed definition is frozen at session start. */

export async function serializeRoutine(db: Database, routine: Routine): Promise<RoutineDefinition> {
  const blocks = await db
    .get<RoutineBlock>('routine_blocks')
    .query(Q.where('routine_id', routine.id))
    .fetch();
  blocks.sort((a, b) => a.sortOrder - b.sortOrder);

  const blockDefs = [];
  for (const block of blocks) {
    const steps = await db
      .get<RoutineBlockStep>('routine_block_steps')
      .query(Q.where('block_id', block.id))
      .fetch();
    steps.sort((a, b) => a.sortOrder - b.sortOrder);

    const transitions = await db
      .get<BlockTransition>('block_transitions')
      .query(Q.where('block_id', block.id))
      .fetch();
    // Deterministic order: follow step order, unknown fromStepId last (stable by id).
    const stepOrder = new Map(steps.map((s, i) => [s.id, i]));
    transitions.sort((a, b) => {
      const ia = stepOrder.get(a.fromStepId) ?? Number.MAX_SAFE_INTEGER;
      const ib = stepOrder.get(b.fromStepId) ?? Number.MAX_SAFE_INTEGER;
      if (ia !== ib) return ia - ib;
      return a.fromStepId < b.fromStepId ? -1 : a.fromStepId > b.fromStepId ? 1 : 0;
    });

    const stepDefs = [];
    for (const step of steps) {
      const prescriptions = await db
        .get<Prescription>('routine_exercise_prescriptions')
        .query(Q.where('step_id', step.id))
        .fetch();
      const p = prescriptions[0];
      let exerciseName = '';
      if (step.exerciseId) {
        try {
          const exercise = await db.get<any>('exercises').find(step.exerciseId);
          exerciseName = exercise.name;
        } catch {
          exerciseName = '';
        }
      }
      stepDefs.push({
        id: step.id,
        role: (step.stepRole as 'work' | 'rest') ?? 'work',
        exerciseId: step.exerciseId,
        exerciseName,
        prescription: {
          targetSets: p?.targetSets ?? null,
          targetRepsMin: p?.targetRepsMin ?? null,
          targetRepsMax: p?.targetRepsMax ?? null,
          targetDurationMs: p?.targetDurationMs ?? null,
          targetWeightGrams: p?.targetWeightGrams ?? null,
          targetRir: p?.targetRir ?? null,
          tempo: {
            eccentricMs: p?.tempoEccentricMs ?? null,
            pauseBottomMs: p?.tempoPauseBottomMs ?? null,
            concentricMs: p?.tempoConcentricMs ?? null,
            pauseTopMs: p?.tempoPauseTopMs ?? null,
          },
        },
      });
    }

    blockDefs.push({
      id: block.id,
      name: block.name,
      kind: block.blockKind as any,
      rounds: block.rounds,
      steps: stepDefs,
      transitions: transitions.map((t) => ({
        fromStepId: t.fromStepId,
        toStepId: t.toStepId,
        delayMs: t.delayMs,
        type: t.transitionType as any,
      })),
    });
  }

  return { id: routine.id, name: routine.name, blocks: blockDefs };
}

export function definitionOf(session: WorkoutSession): RoutineDefinition {
  return JSON.parse(session.definitionJson) as RoutineDefinition;
}

export function cursorOf(session: WorkoutSession): ExecutionCursor {
  // cursor_json is canonical — derived caches are never read for engine state.
  return parseCursor(session.cursorJson);
}
