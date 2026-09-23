import {
  BlockDef,
  DispatchResult,
  Effect,
  EngineEvent,
  ExecutionCursor,
  RoutineDefinition,
  CursorPosition,
  ENGINE_DEFAULTS,
} from '../types/engine';

/**
 * Pure Workout Execution Engine (frozen architecture):
 *   (definition, cursor, event) → { cursor', effects[] }
 * No React, Expo, WatermelonDB, Zustand, filesystem or networking.
 * The UI never interprets transitions — it applies effects via the application layer.
 */

const findTransition = (block: BlockDef, fromStepId: string) =>
  block.transitions.find((t) => t.fromStepId === fromStepId) ?? null;

function advanceBlock(
  def: RoutineDefinition,
  blockIndex: number,
): CursorPosition & { sessionComplete: boolean } {
  if (blockIndex + 1 < def.blocks.length) {
    return { blockIndex: blockIndex + 1, stepIndex: 0, round: 1, setIndex: 1, sessionComplete: false };
  }
  return { blockIndex, stepIndex: 0, round: 1, setIndex: 1, sessionComplete: true };
}

/**
 * Immediate positional advance (used for IMMEDIATE transitions, TIMER_EXPIRE and SKIP).
 * Pure arithmetic over indexes; explicit edges override implicit flow.
 */
export function computeTarget(
  def: RoutineDefinition,
  blockIndex: number,
  stepIndex: number,
  round: number,
): CursorPosition & { sessionComplete: boolean } {
  const block = def.blocks[blockIndex];
  if (!block || block.steps.length === 0) {
    return { blockIndex, stepIndex, round, setIndex: 1, sessionComplete: true };
  }
  const step = block.steps[stepIndex];
  const isLastStep = stepIndex >= block.steps.length - 1;
  const trans = step ? findTransition(block, step.id) : null;

  if (!isLastStep) {
    if (trans && trans.toStepId) {
      const j = block.steps.findIndex((s) => s.id === trans.toStepId);
      if (j >= 0) {
        // Jumping backwards (or to self) starts a new round; forward jumps keep the round.
        return { blockIndex, stepIndex: j, round: j <= stepIndex ? round + 1 : round, setIndex: 1, sessionComplete: false };
      }
    }
    return { blockIndex, stepIndex: stepIndex + 1, round, setIndex: 1, sessionComplete: false };
  }

  // Last step of the block.
  if (trans && trans.toStepId) {
    const j = block.steps.findIndex((s) => s.id === trans.toStepId);
    if (j >= 0) {
      if (round < block.rounds) {
        return { blockIndex, stepIndex: j, round: round + 1, setIndex: 1, sessionComplete: false };
      }
      return advanceBlock(def, blockIndex); // rounds exhausted → next block / complete
    }
  }
  if (round < block.rounds) {
    return { blockIndex, stepIndex: 0, round: round + 1, setIndex: 1, sessionComplete: false };
  }
  return advanceBlock(def, blockIndex);
}

type Timing =
  | { kind: 'immediate' }
  | { kind: 'timer'; timerKind: 'rest' | 'auto'; durationMs: number };

/** What happens after a step finishes (all its sets logged or skipped). */
function timingAfterStep(
  def: RoutineDefinition,
  blockIndex: number,
  stepIndex: number,
  round: number,
): Timing {
  const block = def.blocks[blockIndex];
  const step = block.steps[stepIndex];
  const isLastStep = stepIndex >= block.steps.length - 1;
  const trans = findTransition(block, step.id);

  if (trans) {
    if (trans.type === 'immediate') return { kind: 'immediate' };
    return { kind: 'timer', timerKind: trans.type === 'auto_advance' ? 'auto' : 'rest', durationMs: Math.max(0, trans.delayMs) };
  }
  // Implicit semantics (frozen): non-last step → immediate; loop → REST 90s; block end → REST 120s.
  if (!isLastStep) return { kind: 'immediate' };
  if (round < block.rounds) return { kind: 'timer', timerKind: 'rest', durationMs: ENGINE_DEFAULTS.restLoopMs };
  return { kind: 'timer', timerKind: 'rest', durationMs: ENGINE_DEFAULTS.restBlockMs };
}

/** If the target position is a rest-role step, convert arrival into an auto timer past it. */
function resolveRestStep(
  def: RoutineDefinition,
  target: CursorPosition & { sessionComplete: boolean },
  now: number,
): { target: CursorPosition & { sessionComplete: boolean }; restStep: { durationMs: number } | null } {
  if (target.sessionComplete) return { target, restStep: null };
  const step = def.blocks[target.blockIndex]?.steps[target.stepIndex];
  if (step && step.role === 'rest') {
    const durationMs = step.prescription.targetDurationMs ?? ENGINE_DEFAULTS.restStepFallbackMs;
    const past = computeTarget(def, target.blockIndex, target.stepIndex, target.round);
    return {
      target: past,
      restStep: { durationMs },
    };
  }
  return { target, restStep: null };
}

function navigationEffects(from: ExecutionCursor, to: CursorPosition): Effect[] {
  const effects: Effect[] = [];
  if (to.blockIndex !== from.blockIndex) {
    effects.push({ kind: 'ADVANCE_BLOCK', blockIndex: to.blockIndex });
    return effects;
  }
  if (to.stepIndex !== from.stepIndex) {
    effects.push({ kind: 'ADVANCE_STEP', blockIndex: to.blockIndex, stepIndex: to.stepIndex, round: to.round });
  }
  if (to.round !== from.round) {
    effects.push({ kind: 'ADVANCE_ROUND', blockIndex: to.blockIndex, round: to.round });
  }
  return effects;
}

function moveTo(cursor: ExecutionCursor, target: CursorPosition): ExecutionCursor {
  return {
    ...cursor,
    blockIndex: target.blockIndex,
    stepIndex: target.stepIndex,
    round: target.round,
    setIndex: target.setIndex,
    timer: null,
  };
}

function startTimer(
  cursor: ExecutionCursor,
  timerKind: 'rest' | 'auto',
  durationMs: number,
  now: number,
  target: CursorPosition,
): { cursor: ExecutionCursor; effects: Effect[] } {
  const expiresAt = now + durationMs;
  return {
    cursor: { ...cursor, timer: { kind: timerKind, durationMs, expiresAt, target } },
    effects: [
      { kind: 'START_TIMER', timerKind, durationMs, expiresAt },
      { kind: 'SCHEDULE_NOTIFICATION', expiresAt, title: timerKind === 'rest' ? 'Rest complete' : 'Next' },
    ],
  };
}

export function dispatch(
  definition: RoutineDefinition,
  cursor: ExecutionCursor,
  event: EngineEvent,
): DispatchResult {
  if (cursor.status === 'completed') {
    // Only recovery-neutral events accepted on a completed session; others are no-ops.
    return { cursor, effects: [] };
  }
  switch (event.type) {
    case 'COMPLETE_SET':
      return onCompleteSet(definition, cursor, event.now, event.set);
    case 'SKIP_STEP':
      return onSkipStep(definition, cursor, event.now);
    case 'SKIP_TIMER':
    case 'TIMER_EXPIRE':
      return onTimerDone(definition, cursor);
    case 'UNDO_LAST':
      return onUndo(cursor);
    case 'COMPLETE_SESSION':
      return {
        cursor: { ...cursor, status: 'completed', timer: null, lastReversible: null },
        effects: [{ kind: 'CANCEL_TIMER' }, { kind: 'CANCEL_NOTIFICATION' }, { kind: 'COMPLETE_SESSION' }],
      };
  }
}

function onCompleteSet(
  def: RoutineDefinition,
  cursor: ExecutionCursor,
  now: number,
  set: import('../types/engine').SetPayload,
): DispatchResult {
  const block = def.blocks[cursor.blockIndex];
  const step = block?.steps[cursor.stepIndex];
  if (!block || !step) {
    return { cursor: { ...cursor, status: 'completed', timer: null }, effects: [{ kind: 'COMPLETE_SESSION' }] };
  }

  const lastReversible = {
    kind: 'set' as const,
    setLogId: null,
    blockIndex: cursor.blockIndex,
    stepIndex: cursor.stepIndex,
    round: cursor.round,
    setIndex: cursor.setIndex,
  };
  const logEffect: Effect = {
    kind: 'LOG_SET',
    blockIndex: cursor.blockIndex,
    stepIndex: cursor.stepIndex,
    round: cursor.round,
    setIndex: cursor.setIndex,
    set,
  };
  const effects: Effect[] = [logEffect];
  let next: ExecutionCursor = { ...cursor, timer: null, lastReversible };

  const targetSets = Math.max(1, step.prescription.targetSets ?? 1);
  if (cursor.setIndex < targetSets) {
    // More sets left in this step → default rest between sets, same position continues.
    const target: CursorPosition = {
      blockIndex: cursor.blockIndex,
      stepIndex: cursor.stepIndex,
      round: cursor.round,
      setIndex: cursor.setIndex + 1,
    };
    next = { ...next, setIndex: target.setIndex };
    const timer = startTimer(next, 'rest', ENGINE_DEFAULTS.restBetweenSetsMs, now, target);
    return { cursor: timer.cursor, effects: [...effects, ...timer.effects] };
  }

  const timing = timingAfterStep(def, cursor.blockIndex, cursor.stepIndex, cursor.round);
  const rawTarget = computeTarget(def, cursor.blockIndex, cursor.stepIndex, cursor.round);

  if (timing.kind === 'immediate' && !rawTarget.sessionComplete) {
    const { target, restStep } = resolveRestStep(def, rawTarget, now);
    if (restStep) {
      next = { ...next };
      const timer = startTimer(next, 'auto', restStep.durationMs, now, target);
      return { cursor: timer.cursor, effects: [...effects, ...timer.effects] };
    }
    next = moveTo(next, target);
    return { cursor: next, effects: [...effects, ...navigationEffects(cursor, target)] };
  }

  if (rawTarget.sessionComplete) {
    return {
      cursor: { ...next, status: 'completed', timer: null },
      effects: [...effects, { kind: 'CANCEL_TIMER' }, { kind: 'CANCEL_NOTIFICATION' }, { kind: 'COMPLETE_SESSION' }],
    };
  }

  const { target, restStep } = resolveRestStep(def, rawTarget, now);
  const duration = restStep ? restStep.durationMs : timing.kind === 'timer' ? timing.durationMs : 0;
  const timerKind = restStep ? 'auto' : timing.kind === 'timer' ? timing.timerKind : 'rest';
  next = { ...next };
  const timer = startTimer(next, timerKind, duration, now, target);
  return { cursor: timer.cursor, effects: [...effects, ...timer.effects] };
}

function onSkipStep(def: RoutineDefinition, cursor: ExecutionCursor, _now: number): DispatchResult {
  const rawTarget = computeTarget(def, cursor.blockIndex, cursor.stepIndex, cursor.round);
  const base: ExecutionCursor = { ...cursor, timer: null, lastReversible: null };
  if (rawTarget.sessionComplete) {
    return {
      cursor: { ...base, status: 'completed' },
      effects: [{ kind: 'CANCEL_TIMER' }, { kind: 'CANCEL_NOTIFICATION' }, { kind: 'COMPLETE_SESSION' }],
    };
  }
  const { target, restStep } = resolveRestStep(def, rawTarget, _now);
  if (restStep) {
    const timer = startTimer(base, 'auto', restStep.durationMs, _now, target);
    return { cursor: timer.cursor, effects: timer.effects };
  }
  const next = moveTo(base, target);
  return { cursor: next, effects: [...navigationEffects(cursor, target)] };
}

function onTimerDone(def: RoutineDefinition, cursor: ExecutionCursor): DispatchResult {
  if (!cursor.timer) return { cursor, effects: [] };
  const target = cursor.timer.target;
  const base: ExecutionCursor = { ...cursor, timer: null };
  const step = def.blocks[target.blockIndex]?.steps[target.stepIndex];
  const effects: Effect[] = [{ kind: 'CANCEL_TIMER' }, { kind: 'CANCEL_NOTIFICATION' }];
  if (!step) {
    return {
      cursor: { ...base, status: 'completed' },
      effects: [...effects, { kind: 'COMPLETE_SESSION' }],
    };
  }
  const next = moveTo(base, target);
  return { cursor: next, effects: [...effects, ...navigationEffects(cursor, target)] };
}

function onUndo(cursor: ExecutionCursor): DispatchResult {
  const last = cursor.lastReversible;
  if (!last || last.kind !== 'set') {
    // Undo only applies while the last event is a completed set (frozen UNDO semantics).
    return { cursor, effects: [] };
  }
  const restored: ExecutionCursor = {
    blockIndex: last.blockIndex,
    stepIndex: last.stepIndex,
    round: last.round,
    setIndex: last.setIndex,
    status: 'active',
    timer: null,
    lastReversible: null,
    startedAt: cursor.startedAt,
  };
  return {
    cursor: restored,
    effects: [{ kind: 'VOID_LAST_SET', setLogId: last.setLogId }, { kind: 'CANCEL_TIMER' }, { kind: 'CANCEL_NOTIFICATION' }],
  };
}
