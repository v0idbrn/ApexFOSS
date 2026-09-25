import type { RoutineDefinition, ExecutionCursor } from '../types/engine';

/**
 * Position-based session progress (Phase 2J §4).
 * Describes where the cursor sits inside the *plan* — it never claims how
 * many sets were actually logged (skips/undos make those different things).
 * Rest-role steps are transitions, not planned work, so they count as 0.
 */

function setsPerRound(block: RoutineDefinition['blocks'][number]): number {
  let total = 0;
  for (const step of block.steps) {
    if (step.role === 'rest') continue;
    total += Math.max(1, step.prescription.targetSets ?? 1);
  }
  return total;
}

/** Total planned work sets across the whole routine (position basis). */
export function plannedSets(def: RoutineDefinition): number {
  let total = 0;
  for (const block of def.blocks) {
    total += setsPerRound(block) * Math.max(1, block.rounds);
  }
  return total;
}

/** Planned sets strictly before the cursor's current position. */
export function completedPositionSets(def: RoutineDefinition, cursor: ExecutionCursor): number {
  let done = 0;
  for (let bi = 0; bi < def.blocks.length; bi++) {
    const block = def.blocks[bi];
    if (bi > cursor.blockIndex) break;
    const perRound = setsPerRound(block);
    if (bi < cursor.blockIndex) {
      done += perRound * Math.max(1, block.rounds);
      continue;
    }
    // Current block: completed rounds before the cursor's round.
    const roundsBefore = Math.max(0, cursor.round - 1);
    done += perRound * roundsBefore;
    // Current round: finished steps + sets before the cursor's set.
    for (let si = 0; si < block.steps.length; si++) {
      const step = block.steps[si];
      if (si > cursor.stepIndex) break;
      if (step.role === 'rest') continue;
      const sets = Math.max(1, step.prescription.targetSets ?? 1);
      if (si < cursor.stepIndex) {
        done += sets;
      } else {
        done += Math.max(0, Math.min(cursor.setIndex - 1, sets));
      }
    }
  }
  return done;
}

export interface SessionProgress {
  doneSets: number;
  totalSets: number;
  /** 0..1; 0 when the plan has no sets. Always finite. */
  ratio: number;
}

export function sessionProgress(def: RoutineDefinition, cursor: ExecutionCursor): SessionProgress {
  const totalSets = plannedSets(def);
  const doneSets = Math.min(totalSets, completedPositionSets(def, cursor));
  const ratio = totalSets > 0 ? doneSets / totalSets : 0;
  return { doneSets, totalSets, ratio: Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0 };
}
