import { dispatch } from './index';
import { initialCursor } from './cursor';
import type { RoutineDefinition } from '../types/engine';

/**
 * Explicit session completion state (1.1.0): COMPLETE_SESSION without a
 * reason finishes 'completed' (legacy behavior); with an athlete-stated
 * reason it finishes 'incomplete' and preserves the reason verbatim.
 */

function definition(): RoutineDefinition {
  return {
    id: 'r1',
    name: 'R',
    blocks: [
      {
        id: 'b1',
        name: 'Main',
        kind: 'normal',
        rounds: 1,
        steps: [
          {
            id: 's1',
            role: 'work',
            exerciseId: null,
            exerciseName: 'Squat',
            prescription: {
              targetSets: 1,
              targetRepsMin: 5,
              targetRepsMax: 5,
              targetWeightGrams: null,
              targetDurationMs: null,
              targetRir: null,
              tempo: { eccentricMs: null, pauseBottomMs: null, concentricMs: null, pauseTopMs: null },
            },
          },
        ],
        transitions: [],
        interval: null,
      },
    ],
  };
}

describe('explicit session completion (1.1.0)', () => {
  it('COMPLETE_SESSION without a reason finishes completed (legacy)', () => {
    const cursor = initialCursor(definition());
    const next = dispatch(definition(), cursor, { type: 'COMPLETE_SESSION', now: 1000 });
    expect(next.cursor.status).toBe('completed');
    expect(next.cursor.incompleteReason ?? null).toBeNull();
    expect(next.cursor.timer).toBeNull();
  });

  it('COMPLETE_SESSION with a reason finishes incomplete and keeps the reason', () => {
    const cursor = initialCursor(definition());
    const next = dispatch(definition(), cursor, {
      type: 'COMPLETE_SESSION',
      now: 1000,
      incompleteReason: 'time_constraint',
    });
    expect(next.cursor.status).toBe('incomplete');
    expect(next.cursor.incompleteReason).toBe('time_constraint');
    expect(next.effects.some((e) => e.kind === 'COMPLETE_SESSION')).toBe(true);
    expect(next.effects.some((e) => e.kind === 'CANCEL_TIMER')).toBe(true);
  });

  it.each([
    'user_stopped',
    'time_constraint',
    'fatigue',
    'pain',
    'equipment_unavailable',
    'interruption',
    'technical_issue',
    'other',
  ] as const)('reason %s yields incomplete status', (reason) => {
    const cursor = initialCursor(definition());
    const next = dispatch(definition(), cursor, { type: 'COMPLETE_SESSION', now: 1000, incompleteReason: reason });
    expect(next.cursor.status).toBe('incomplete');
    expect(next.cursor.incompleteReason).toBe(reason);
  });

  it('natural completion (last set) stays completed without a reason', () => {
    const cursor = initialCursor(definition());
    const next = dispatch(definition(), cursor, {
      type: 'COMPLETE_SET',
      now: 1000,
      set: { weightGrams: 60_000, reps: 5, durationMs: null, distanceMm: null, rir: null },
    });
    expect(next.cursor.status).toBe('completed');
    expect(next.cursor.incompleteReason ?? null).toBeNull();
  });
});
