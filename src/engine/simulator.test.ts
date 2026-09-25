import { simulateRoutine } from './simulator';
import { ENGINE_DEFAULTS, type BlockDef, type RoutineDefinition, type StepDef, type TransitionDef } from '../types/engine';

const step = (id: string, name: string, sets: number, extra: Partial<StepDef> = {}): StepDef => ({
  id,
  role: 'work',
  exerciseId: null,
  exerciseName: name,
  prescription: {
    targetSets: sets,
    targetRepsMin: null,
    targetRepsMax: null,
    targetDurationMs: null,
    targetWeightGrams: null,
    targetRir: null,
    tempo: { eccentricMs: null, pauseBottomMs: null, concentricMs: null, pauseTopMs: null },
  },
  ...extra,
});

const restStep = (id: string, durationMs: number): StepDef => ({
  ...step(id, 'Rest', 1),
  role: 'rest',
  prescription: {
    targetSets: 1,
    targetRepsMin: null,
    targetRepsMax: null,
    targetDurationMs: durationMs,
    targetWeightGrams: null,
    targetRir: null,
    tempo: { eccentricMs: null, pauseBottomMs: null, concentricMs: null, pauseTopMs: null },
  },
});

const block = (
  id: string,
  name: string,
  kind: BlockDef['kind'],
  rounds: number,
  steps: StepDef[],
  transitions: TransitionDef[] = [],
): BlockDef => ({ id, name, kind, rounds, steps, transitions });

const routine = (blocks: BlockDef[]): RoutineDefinition => ({ id: 'r1', name: 'Sim', blocks });

describe('simulateRoutine (Phase 2J §14)', () => {
  it('runs a single-set block to completion with no timers', () => {
    const def = routine([block('b1', 'Main', 'normal', 1, [step('s1', 'Bench', 1)])]);
    const result = simulateRoutine(def);
    expect(result).toMatchObject({
      completed: true,
      truncated: false,
      workSetCount: 1,
      timerCount: 0,
      totalTimerMs: 0,
      dispatchCount: 1,
    });
    expect(result.setsByExercise).toEqual([{ exerciseName: 'Bench', sets: 1 }]);
  });

  it('counts between-set rests for a multi-set step and completes without a final timer', () => {
    const def = routine([block('b1', 'Main', 'normal', 1, [step('s1', 'Bench', 3)])]);
    const result = simulateRoutine(def);
    expect(result.completed).toBe(true);
    expect(result.workSetCount).toBe(3);
    expect(result.timerCount).toBe(2);
    expect(result.totalTimerMs).toBe(2 * ENGINE_DEFAULTS.restBetweenSetsMs);
    // 3 COMPLETE_SET dispatches + 2 TIMER_EXPIRE dispatches.
    expect(result.dispatchCount).toBe(5);
  });

  it('adds the loop rest between rounds and finishes on the final set', () => {
    const def = routine([block('b1', 'Main', 'normal', 2, [step('s1', 'Squat', 1)])]);
    const result = simulateRoutine(def);
    expect(result.completed).toBe(true);
    expect(result.workSetCount).toBe(2);
    expect(result.timerCount).toBe(1);
    expect(result.totalTimerMs).toBe(ENGINE_DEFAULTS.restLoopMs);
  });

  it('applies the block rest between blocks and crosses via TIMER_EXPIRE', () => {
    const def = routine([
      block('b1', 'Main', 'normal', 1, [step('s1', 'Squat', 2)]),
      block('b2', 'Finish', 'normal', 1, [step('s2', 'Bench', 1)]),
    ]);
    const result = simulateRoutine(def);
    expect(result.completed).toBe(true);
    expect(result.workSetCount).toBe(3);
    expect(result.timerCount).toBe(2); // between-sets + block transition
    expect(result.totalTimerMs).toBe(ENGINE_DEFAULTS.restBetweenSetsMs + ENGINE_DEFAULTS.restBlockMs);
    expect(result.path.map((p) => `${p.blockIndex}:${p.stepIndex}:r${p.round}:s${p.setIndex}`)).toEqual([
      '0:0:r1:s1',
      '0:0:r1:s2',
      '1:0:r1:s1',
    ]);
    expect(result.setsByExercise).toEqual([
      { exerciseName: 'Squat', sets: 2 },
      { exerciseName: 'Bench', sets: 1 },
    ]);
  });

  it('converts rest-role steps into auto timers without logging work', () => {
    const def = routine([
      block('b1', 'Main', 'normal', 1, [
        step('s1', 'Bench', 1),
        restStep('s2', 45_000),
        step('s3', 'Row', 1),
      ]),
    ]);
    const result = simulateRoutine(def);
    expect(result.completed).toBe(true);
    expect(result.workSetCount).toBe(2);
    expect(result.setsByExercise.map((e) => e.exerciseName)).toEqual(['Bench', 'Row']);
    expect(result.timerCount).toBe(1);
    expect(result.totalTimerMs).toBe(45_000);
  });

  it('honors an explicit transition delay between steps', () => {
    const def = routine([
      block('b1', 'Main', 'normal', 1, [step('s1', 'Bench', 1), step('s2', 'Row', 1)], [
        { fromStepId: 's1', toStepId: 's2', type: 'rest', delayMs: 30_000 },
      ]),
    ]);
    const result = simulateRoutine(def);
    expect(result.completed).toBe(true);
    expect(result.totalTimerMs).toBe(30_000);
    expect(result.workSetCount).toBe(2);
  });

  it('records exercise ids when the step references one', () => {
    const def = routine([
      block('b1', 'Main', 'normal', 1, [step('s1', 'Bench', 1, { exerciseId: 'ex-42' })]),
    ]);
    const result = simulateRoutine(def);
    expect(result.path[0]).toMatchObject({ exerciseId: 'ex-42', exerciseName: 'Bench' });
  });

  it('is deterministic — identical inputs produce identical results', () => {
    const def = routine([
      block('b1', 'Main', 'normal', 2, [step('s1', 'Squat', 2), step('s2', 'Bench', 1)]),
      block('b2', 'Core', 'normal', 1, [restStep('s3', 60_000), step('s4', 'Plank', 1)]),
    ]);
    expect(simulateRoutine(def)).toEqual(simulateRoutine(def));
  });

  it('handles an empty routine as immediately complete', () => {
    const result = simulateRoutine(routine([]));
    expect(result).toMatchObject({ completed: true, truncated: false, workSetCount: 0, timerCount: 0 });
    expect(result.path).toEqual([]);
  });

  it('bounds unbounded backward-transition routines with the dispatch budget', () => {
    // Self-transition on a non-last step increments the round forever — the
    // engine itself never terminates here, so the simulator must truncate.
    const def = routine([
      block('b1', 'Loop', 'normal', 1, [step('s1', 'Bench', 1), step('s2', 'Row', 1)], [
        { fromStepId: 's1', toStepId: 's1', type: 'immediate', delayMs: 0 },
      ]),
    ]);
    const result = simulateRoutine(def, { maxDispatches: 40 });
    expect(result.truncated).toBe(true);
    expect(result.completed).toBe(false);
    expect(result.dispatchCount).toBe(40);
    expect(result.workSetCount).toBeGreaterThan(0);
  });

  it('never returns NaN or negative totals for degenerate input', () => {
    const def = routine([block('b1', 'Main', 'normal', 1, [step('s1', 'Bench', 1)])]);
    const result = simulateRoutine(def, { maxDispatches: 0.5 }); // clamps to ≥1
    expect(Number.isFinite(result.totalTimerMs)).toBe(true);
    expect(result.totalTimerMs).toBeGreaterThanOrEqual(0);
    expect(result.dispatchCount).toBeGreaterThanOrEqual(1);
  });
});
