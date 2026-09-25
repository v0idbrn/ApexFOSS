import { definitionFromDraft } from './serialize';
import { simulateRoutine } from '../engine/simulator';
import { ENGINE_DEFAULTS } from '../types/engine';
import { emptyDraft, emptyPrescription, type RoutineDraft } from '../types/draft';

function draftWith(steps: RoutineDraft['blocks'][number]['steps'], overrides: Partial<RoutineDraft['blocks'][number]> = {}): RoutineDraft {
  return {
    id: 'r1',
    name: 'Push day',
    blocks: [
      {
        localId: 'blk-1',
        name: 'Main',
        kind: 'normal',
        rounds: 1,
        steps,
        interval: null,
        ...overrides,
      },
    ],
  };
}

const workStep = (localId: string, exerciseName: string, sets: number): RoutineDraft['blocks'][number]['steps'][number] => ({
  localId,
  exerciseId: `ex-${localId}`,
  exerciseName,
  prescription: { ...emptyPrescription(), targetSets: sets },
  transition: { type: 'immediate', delayMs: 0 },
});

describe('definitionFromDraft (Phase 2J §14)', () => {
  it('maps steps with work role, local ids and prescription values', () => {
    const definition = definitionFromDraft(draftWith([workStep('s1', 'Bench Press', 3)]));
    expect(definition.id).toBe('r1');
    expect(definition.name).toBe('Push day');
    expect(definition.blocks).toHaveLength(1);
    const block = definition.blocks[0];
    expect(block).toMatchObject({ id: 'blk-1', name: 'Main', kind: 'normal', rounds: 1 });
    const step = block.steps[0];
    expect(step).toMatchObject({ id: 's1', role: 'work', exerciseId: 'ex-s1', exerciseName: 'Bench Press' });
    expect(step.prescription.targetSets).toBe(3);
    expect(block.transitions).toEqual([
      { fromStepId: 's1', toStepId: null, delayMs: 0, type: 'immediate' },
    ]);
  });

  it('clamps rounds like saveRoutineDraft (min 1, interval forced to 1)', () => {
    const zero = definitionFromDraft(draftWith([], { rounds: 0 }));
    expect(zero.blocks[0].rounds).toBe(1);
    const fractional = definitionFromDraft(draftWith([], { rounds: 2.4 }));
    expect(fractional.blocks[0].rounds).toBe(2);
    const interval = definitionFromDraft(draftWith([], { kind: 'interval', rounds: 9 }));
    expect(interval.blocks[0].rounds).toBe(1);
    expect(interval.blocks[0].interval).toBeNull();
  });

  it('normalizes transition delays exactly like the persisted path', () => {
    const immediate = definitionFromDraft(
      draftWith([{ ...workStep('s1', 'Bench', 1), transition: { type: 'immediate', delayMs: 5000 } }]),
    );
    expect(immediate.blocks[0].transitions[0].delayMs).toBe(0);
    const rest = definitionFromDraft(
      draftWith([{ ...workStep('s1', 'Bench', 1), transition: { type: 'rest', delayMs: -100 } }]),
    );
    expect(rest.blocks[0].transitions[0]).toMatchObject({ type: 'rest', delayMs: 0 });
    const auto = definitionFromDraft(
      draftWith([{ ...workStep('s1', 'Bench', 1), transition: { type: 'auto_advance', delayMs: 45_500.4 } }]),
    );
    expect(auto.blocks[0].transitions[0].delayMs).toBe(45_500);
  });

  it('falls back for unnamed blocks and routines', () => {
    const definition = definitionFromDraft({ id: null, name: '  ', blocks: [{ ...draftWith([]).blocks[0], name: '   ' }] });
    expect(definition.id).toBe('draft-preview');
    expect(definition.name).toBe('Untitled');
    expect(definition.blocks[0].name).toBe('Block 1');
  });

  it('produces a definition the real engine can simulate to completion', () => {
    const draft = {
      id: 'r1',
      name: 'Leg day',
      blocks: [
        {
          localId: 'b1',
          name: 'Main',
          kind: 'normal' as const,
          rounds: 2,
          steps: [workStep('s1', 'Squat', 2), workStep('s2', 'RDL', 1)],
          interval: null,
        },
      ],
    };
    const result = simulateRoutine(definitionFromDraft(draft));
    expect(result.completed).toBe(true);
    expect(result.truncated).toBe(false);
    expect(result.workSetCount).toBe(6); // (2 + 1) sets × 2 rounds
    // Between-set rests only inside Squat: 1 per round (2 total);
    // round transition rests after RDL: 90 s (loop) — engine-driven, not guessed.
    expect(result.totalTimerMs).toBeGreaterThanOrEqual(2 * ENGINE_DEFAULTS.restBetweenSetsMs);
    expect(result.setsByExercise.map((e) => e.exerciseName)).toEqual(['Squat', 'RDL']);
    expect(result.setsByExercise.map((e) => e.sets)).toEqual([4, 2]);
  });

  it('handles an empty draft without throwing', () => {
    const definition = definitionFromDraft(emptyDraft());
    expect(definition.blocks).toEqual([]);
    const result = simulateRoutine(definition);
    expect(result.completed).toBe(true);
    expect(result.workSetCount).toBe(0);
  });
});
