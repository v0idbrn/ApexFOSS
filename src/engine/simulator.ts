import { dispatch } from './index';
import { initialCursor } from './cursor';
import type { EngineEvent, ExecutionCursor, RoutineDefinition, SetPayload } from '../types/engine';

/**
 * Routine preview simulator (Phase 2J §14).
 *
 * Drives the REAL frozen dispatch engine with synthetic inputs — it never
 * re-implements transitions, timers or round logic. Deterministic (virtual
 * clock starts at 0), bounded by a dispatch budget, and completely pure:
 * no DB, no React, no IO, no wall-clock access.
 */

export interface SimPathEntry {
  blockIndex: number;
  stepIndex: number;
  round: number;
  setIndex: number;
  exerciseName: string;
  exerciseId: string | null;
  role: string;
  action: 'set' | 'timer' | 'skip';
}

export interface SimExerciseTotal {
  exerciseName: string;
  /** Work sets actually logged (LOG_SET effects) for this exercise. */
  sets: number;
}

export interface SimulationResult {
  /** The engine reported session completion within the budget. */
  completed: boolean;
  /** Budget exhausted before completion (possible with unbounded backward transitions). */
  truncated: boolean;
  dispatchCount: number;
  /** LOG_SET effects — every simulated work set. */
  workSetCount: number;
  /** START_TIMER effects (rest between sets, loop/block rests, rest steps). */
  timerCount: number;
  /** Sum of all timer durations — the routine's planned rest time. */
  totalTimerMs: number;
  /** Chronological trace of every logged work set (position at log time). */
  path: SimPathEntry[];
  /** Work sets per exercise (first-appearance order), rest-role steps excluded. */
  setsByExercise: SimExerciseTotal[];
}

export interface SimulateOptions {
  /** Hard bound on engine dispatches (guards unbounded loops). Default 5000. */
  maxDispatches?: number;
}

const SYNTHETIC_SET: SetPayload = {
  weightGrams: null,
  reps: null,
  durationMs: null,
  distanceMm: null,
  rir: null,
};

function blankResult(): SimulationResult {
  return {
    completed: false,
    truncated: false,
    dispatchCount: 0,
    workSetCount: 0,
    timerCount: 0,
    totalTimerMs: 0,
    path: [],
    setsByExercise: [],
  };
}

/** Run the engine to completion (or the dispatch budget) with synthetic sets. */
export function simulateRoutine(definition: RoutineDefinition, options: SimulateOptions = {}): SimulationResult {
  const maxDispatches = Math.max(1, Math.floor(options.maxDispatches ?? 5000));
  const result = blankResult();
  if (definition.blocks.length === 0) {
    result.completed = true;
    return result;
  }

  let cursor: ExecutionCursor = initialCursor(definition, 0);
  let now = 0;

  while (cursor.status !== 'completed') {
    if (result.dispatchCount >= maxDispatches) {
      result.truncated = true;
      break;
    }
    result.dispatchCount += 1;

    let event: EngineEvent;
    let action: SimPathEntry['action'];
    if (cursor.timer) {
      now = Math.max(now, cursor.timer.expiresAt);
      event = { type: 'TIMER_EXPIRE', now };
      action = 'timer';
    } else {
      const block = definition.blocks[cursor.blockIndex];
      const step = block?.steps[cursor.stepIndex];
      if (!block || !step) {
        // Defensive: engine treats missing positions as completion.
        event = { type: 'COMPLETE_SESSION', now };
        action = 'skip';
      } else if (step.role === 'work') {
        event = { type: 'COMPLETE_SET' as const, now, set: SYNTHETIC_SET };
        action = 'set';
      } else {
        // Rest-role or non-work steps advance without logging work.
        event = { type: 'SKIP_STEP' as const, now };
        action = 'skip';
      }
    }

    const before = { blockIndex: cursor.blockIndex, stepIndex: cursor.stepIndex, round: cursor.round, setIndex: cursor.setIndex };
    const hadTimer = cursor.timer !== null;
    const step = definition.blocks[cursor.blockIndex]?.steps[cursor.stepIndex];
    const outcome = dispatch(definition, cursor, event);
    cursor = outcome.cursor;

    for (const effect of outcome.effects) {
      if (effect.kind === 'LOG_SET') {
        result.workSetCount += 1;
        const exerciseName = definition.blocks[effect.blockIndex]?.steps[effect.stepIndex]?.exerciseName ?? '';
        result.path.push({
          blockIndex: effect.blockIndex,
          stepIndex: effect.stepIndex,
          round: effect.round,
          setIndex: effect.setIndex,
          exerciseName,
          exerciseId: definition.blocks[effect.blockIndex]?.steps[effect.stepIndex]?.exerciseId ?? null,
          role: step?.role ?? 'work',
          action,
        });
        const existing = result.setsByExercise.find((e) => e.exerciseName === exerciseName);
        if (existing) existing.sets += 1;
        else result.setsByExercise.push({ exerciseName, sets: 1 });
      } else if (effect.kind === 'START_TIMER') {
        result.timerCount += 1;
        result.totalTimerMs += Math.max(0, effect.durationMs);
      } else if (effect.kind === 'COMPLETE_SESSION') {
        result.completed = true;
      }
    }

    // Progress guard: the dispatch must complete the session, change position,
    // start a timer, or consume a pending timer (a between-set rest expires
    // onto the SAME position — consuming it is still progress). Anything else
    // would loop forever (the engine never does this without bad transitions).
    const positionChanged =
      cursor.blockIndex !== before.blockIndex ||
      cursor.stepIndex !== before.stepIndex ||
      cursor.round !== before.round ||
      cursor.setIndex !== before.setIndex;
    const moved = positionChanged || cursor.timer !== null || hadTimer || cursor.status === 'completed';
    if (!moved) {
      // A dispatch that neither completed the session nor changed position or
      // timers would loop forever (e.g. degenerate self-transitions) — stop and
      // flag truncation; the budget remains the hard bound either way.
      result.truncated = true;
      break;
    }
  }

  return result;
}
