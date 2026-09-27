import { computeNextUp, type ProgramMember } from './scheduling';

const member = (over: Partial<ProgramMember>): ProgramMember => ({
  routineId: 'r1',
  name: 'Day A',
  order: 1,
  lastTrainedAt: null,
  ...over,
});

describe('computeNextUp (Phase 4C flexible scheduling)', () => {
  it('returns null for no members', () => {
    expect(computeNextUp([])).toBeNull();
  });

  it('prefers never-trained members regardless of order recency', () => {
    const next = computeNextUp([
      member({ routineId: 'rA', name: 'Day A', order: 1, lastTrainedAt: 500 }),
      member({ routineId: 'rB', name: 'Day B', order: 2, lastTrainedAt: 900 }),
      member({ routineId: 'rC', name: 'Day C', order: 3, lastTrainedAt: null }),
    ]);
    expect(next).toEqual({ routineId: 'rC', name: 'Day C', neverTrained: true });
  });

  it('rotates to the least-recently-trained once everything is trained', () => {
    const next = computeNextUp([
      member({ routineId: 'rA', name: 'Day A', order: 1, lastTrainedAt: 900 }),
      member({ routineId: 'rB', name: 'Day B', order: 2, lastTrainedAt: 100 }),
      member({ routineId: 'rC', name: 'Day C', order: 3, lastTrainedAt: 500 }),
    ]);
    expect(next).toEqual({ routineId: 'rB', name: 'Day B', neverTrained: false });
  });

  it('breaks ties by program order (authored order wins)', () => {
    const next = computeNextUp([
      member({ routineId: 'rB', name: 'Day B', order: 2, lastTrainedAt: 100 }),
      member({ routineId: 'rA', name: 'Day A', order: 1, lastTrainedAt: 100 }),
      member({ routineId: 'rC', name: 'Day C', order: 3, lastTrainedAt: 100 }),
    ]);
    expect(next).toEqual({ routineId: 'rA', name: 'Day A', neverTrained: false });
  });

  it('is deterministic for shuffled input', () => {
    const members = [
      member({ routineId: 'r1', order: 1, lastTrainedAt: 300 }),
      member({ routineId: 'r2', order: 2, lastTrainedAt: 200 }),
      member({ routineId: 'r3', order: 3, lastTrainedAt: 200 }),
    ];
    const a = computeNextUp([...members].reverse());
    const b = computeNextUp(members);
    expect(a).toEqual(b);
    expect(a!.routineId).toBe('r2'); // order 2 beats order 3 on equal recency
  });
});
