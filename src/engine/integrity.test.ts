import { checkIntegrity, integrityErrors, type IntegrityIssue } from './integrity';
import type { BlockDef, IntervalSpec, RoutineDefinition, StepDef, TransitionDef } from '../types/engine';

const step = (id: string, sets: number | null, extra: Partial<StepDef> = {}): StepDef => ({
  id,
  role: 'work',
  exerciseId: null,
  exerciseName: `Step ${id}`,
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

const restStep = (id: string): StepDef => ({ ...step(id, 1), role: 'rest' });

const block = (
  id: string,
  kind: BlockDef['kind'],
  rounds: number,
  steps: StepDef[],
  transitions: TransitionDef[] = [],
  interval: IntervalSpec | null = null,
): BlockDef => ({ id, name: `Block ${id}`, kind, rounds, steps, transitions, interval });

const routine = (blocks: BlockDef[]): RoutineDefinition => ({ id: 'r1', name: 'Checks', blocks });

const codes = (issues: IntegrityIssue[]) => issues.map((i) => i.code);

describe('checkIntegrity (Phase 2J §15)', () => {
  it('accepts a well-formed routine with no issues', () => {
    const def = routine([
      block('b1', 'normal', 2, [step('s1', 3), step('s2', 2)], [
        { fromStepId: 's1', toStepId: 's2', type: 'immediate', delayMs: 0 },
      ]),
    ]);
    expect(checkIntegrity(def)).toEqual([]);
  });

  it('flags routines with no blocks and blocks with no steps', () => {
    expect(codes(checkIntegrity(routine([])))).toEqual(['empty_routine']);
    expect(codes(checkIntegrity(routine([block('b1', 'normal', 1, [])])))).toEqual(['empty_routine']);
    const bothEmpty = checkIntegrity(routine([block('b1', 'normal', 1, []), block('b2', 'normal', 1, [])]));
    expect(codes(bothEmpty)).toEqual(['empty_routine', 'empty_routine']);
  });

  it('warns when the routine contains no work-role steps', () => {
    const issues = checkIntegrity(routine([block('b1', 'normal', 1, [restStep('s1'), restStep('s2')])]));
    expect(codes(issues)).toEqual(['no_work_steps']);
    expect(issues[0].severity).toBe('warning');
    expect(integrityErrors(issues)).toBe(0);
  });

  it('flags blocks with rounds below 1 as errors', () => {
    const issues = checkIntegrity(routine([block('b1', 'normal', 0, [step('s1', 1)])]));
    expect(issues).toContainEqual(expect.objectContaining({ code: 'invalid_rounds', severity: 'error' }));
  });

  it('requires a valid interval spec only on interval blocks', () => {
    const missing = checkIntegrity(routine([block('b1', 'interval', 1, [step('s1', 1)], [], null)]));
    expect(codes(missing)).toContain('missing_interval_spec');

    const invalidRounds = checkIntegrity(
      routine([
        block('b1', 'interval', 1, [step('s1', 1)], [], {
          mode: 'hiit',
          workMs: 30_000,
          restMs: 10_000,
          rounds: 0,
          periodMs: null,
          preparationMs: 0,
        }),
      ]),
    );
    expect(codes(invalidRounds)).toContain('missing_interval_spec');

    const valid = checkIntegrity(
      routine([
        block('b1', 'interval', 1, [step('s1', 1)], [], {
          mode: 'emom',
          workMs: 40_000,
          restMs: 20_000,
          rounds: 8,
          periodMs: null,
          preparationMs: 10_000,
        }),
      ]),
    );
    expect(valid).toEqual([]);

    const specOnNormalBlock = checkIntegrity(
      routine([
        block('b1', 'normal', 1, [step('s1', 1)], [], {
          mode: 'hiit',
          workMs: 30_000,
          restMs: 10_000,
          rounds: 4,
          periodMs: null,
          preparationMs: 0,
        }),
      ]),
    );
    expect(specOnNormalBlock).toEqual([]);
  });

  it('flags orphan transitions (unknown from or to step)', () => {
    const unknownFrom = checkIntegrity(
      routine([block('b1', 'normal', 1, [step('s1', 1)], [
        { fromStepId: 'ghost', toStepId: null, type: 'immediate', delayMs: 0 },
      ])]),
    );
    expect(codes(unknownFrom)).toContain('orphan_transition');

    const unknownTo = checkIntegrity(
      routine([block('b1', 'normal', 1, [step('s1', 1)], [
        { fromStepId: 's1', toStepId: 'ghost', type: 'rest', delayMs: 1000 },
      ])]),
    );
    expect(codes(unknownTo)).toContain('orphan_transition');
    expect(integrityErrors(unknownTo)).toBe(1); // reported once per block
  });

  it('detects unbounded transition cycles as errors', () => {
    // Backward jump between two NON-LAST steps: engine increments round with
    // no cap (computeTarget line 55) — the routine never finishes.
    const backwardCycle = checkIntegrity(
      routine([block('b1', 'normal', 1, [step('s1', 1), step('s2', 1), step('s3', 1)], [
        { fromStepId: 's1', toStepId: 's2', type: 'immediate', delayMs: 0 },
        { fromStepId: 's2', toStepId: 's1', type: 'immediate', delayMs: 0 },
      ])]),
    );
    expect(codes(backwardCycle)).toContain('transition_cycle');

    const selfLoop = checkIntegrity(
      routine([block('b1', 'normal', 1, [step('s1', 1), step('s2', 1)], [
        { fromStepId: 's1', toStepId: 's1', type: 'immediate', delayMs: 0 },
      ])]),
    );
    expect(codes(selfLoop)).toContain('transition_cycle');

    const implicitPlusBackward = checkIntegrity(
      routine([block('b1', 'normal', 3, [step('s1', 1), step('s2', 1), step('s3', 1)], [
        { fromStepId: 's2', toStepId: 's1', type: 'immediate', delayMs: 0 },
      ])]),
    );
    expect(codes(implicitPlusBackward)).toContain('transition_cycle');
  });

  it('does not flag round-bounded or forward-only transitions', () => {
    const implicit = checkIntegrity(routine([block('b1', 'normal', 3, [step('s1', 1), step('s2', 1)])]));
    expect(implicit).toEqual([]);

    const forward = checkIntegrity(
      routine([block('b1', 'normal', 2, [step('s1', 1), step('s2', 1)], [
        { fromStepId: 's1', toStepId: 's2', type: 'immediate', delayMs: 0 },
      ])]),
    );
    expect(forward).toEqual([]);

    // Return from the LAST step is round-capped in computeTarget — bounded.
    const lastStepReturn = checkIntegrity(
      routine([block('b1', 'normal', 2, [step('s1', 1), step('s2', 1)], [
        { fromStepId: 's2', toStepId: 's1', type: 'rest', delayMs: 0 },
      ])]),
    );
    expect(codes(lastStepReturn)).not.toContain('transition_cycle');

    // Forward jump to the last step, then round-capped loop — bounded.
    const jumpToLast = checkIntegrity(
      routine([block('b1', 'normal', 2, [step('s1', 1), step('s2', 1), step('s3', 1)], [
        { fromStepId: 's1', toStepId: 's3', type: 'immediate', delayMs: 0 },
      ])]),
    );
    expect(codes(jumpToLast)).not.toContain('transition_cycle');

    // Single-step block: the only edge is the last step's round-capped loop.
    const single = checkIntegrity(routine([block('b1', 'normal', 1, [step('s1', 1)])]));
    expect(codes(single)).not.toContain('transition_cycle');
  });

  it('warns on work steps without a target set count (engine assumes 1)', () => {
    const issues = checkIntegrity(routine([block('b1', 'normal', 1, [step('s1', null), step('s2', 0), step('s3', 3)])]));
    const warnings = issues.filter((i) => i.code === 'zero_target_sets');
    expect(warnings).toHaveLength(2);
    expect(warnings.map((w) => w.stepId)).toEqual(['s1', 's2']);
    expect(warnings.every((w) => w.severity === 'warning')).toBe(true);
  });

  it('warns about duplicate step ids inside a block', () => {
    const issues = checkIntegrity(
      routine([block('b1', 'normal', 1, [step('s1', 1), step('s1', 2)])]),
    );
    expect(codes(issues)).toContain('duplicate_step_id');
    expect(issues.find((i) => i.code === 'duplicate_step_id')?.severity).toBe('warning');
  });

  it('keeps issue context (block and step names) for the UI', () => {
    const def = routine([block('b1', 'normal', 1, [step('s1', null)])]);
    const issue = checkIntegrity(def).find((i) => i.code === 'zero_target_sets');
    expect(issue).toMatchObject({
      blockId: 'b1',
      blockName: 'Block b1',
      stepId: 's1',
      stepName: 'Step s1',
    });
  });

  it('is deterministic for identical input', () => {
    const def = routine([
      block('b1', 'normal', 0, [step('s1', null), step('s2', 1)], [
        { fromStepId: 's2', toStepId: 's1', type: 'immediate', delayMs: 0 },
      ]),
    ]);
    expect(checkIntegrity(def)).toEqual(checkIntegrity(def));
  });

  it('counts only errors with integrityErrors', () => {
    const issues = checkIntegrity(
      routine([block('b1', 'interval', 0, [step('s1', null), step('s2', 1)], [], null)]),
    );
    expect(codes(issues).sort()).toEqual(
      ['invalid_rounds', 'missing_interval_spec', 'zero_target_sets'].sort(),
    );
    expect(integrityErrors(issues)).toBe(2);
    expect(integrityErrors(issues)).toBe(issues.filter((i) => i.severity === 'error').length);
  });
});
