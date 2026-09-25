import { plannedSets, completedPositionSets, sessionProgress } from './sessionProgress';
import type { ExecutionCursor, RoutineDefinition } from '../types/engine';

/** Representative 2-block routine: rounds + multi-set steps + a rest step. */
const DEF: RoutineDefinition = {
  id: 'r1',
  name: 'Push',
  blocks: [
    {
      id: 'b1',
      name: 'Main',
      kind: 'normal',
      rounds: 2,
      steps: [
        { id: 's1', role: 'work', exerciseId: 'e1', exerciseName: 'Bench', prescription: pres(3) },
        { id: 's2', role: 'work', exerciseId: 'e2', exerciseName: 'Press', prescription: pres(2) },
        { id: 's3', role: 'rest', exerciseId: null, exerciseName: 'Rest', prescription: pres(null, 60_000) },
      ],
      transitions: [],
    },
    {
      id: 'b2',
      name: 'Finisher',
      kind: 'superset',
      rounds: 1,
      steps: [{ id: 's4', role: 'work', exerciseId: 'e3', exerciseName: 'Dip', prescription: pres(1) }],
      transitions: [],
    },
  ],
};

function pres(targetSets: number | null, durationMs: number | null = null) {
  return {
    targetSets,
    targetRepsMin: 8,
    targetRepsMax: null,
    targetDurationMs: durationMs,
    targetWeightGrams: null,
    targetRir: null,
    tempo: { eccentricMs: null, pauseBottomMs: null, concentricMs: null, pauseTopMs: null },
  };
}

function cursorAt(patch: Partial<ExecutionCursor>): ExecutionCursor {
  return {
    blockIndex: 0,
    stepIndex: 0,
    round: 1,
    setIndex: 1,
    status: 'active',
    timer: null,
    lastReversible: null,
    startedAt: 0,
    ...patch,
  };
}

describe('sessionProgress (Phase 2J §4)', () => {
  it('counts planned work sets across blocks and rounds, excluding rest steps', () => {
    // b1: (3 + 2) sets × 2 rounds = 10; b2: 1 → 11 total.
    expect(plannedSets(DEF)).toBe(11);
  });

  it('starts at zero for the initial cursor', () => {
    expect(sessionProgress(DEF, cursorAt({}))).toEqual({ doneSets: 0, totalSets: 11, ratio: 0 });
  });

  it('advances with set position inside the current step', () => {
    expect(completedPositionSets(DEF, cursorAt({ setIndex: 2 }))).toBe(1);
    expect(completedPositionSets(DEF, cursorAt({ setIndex: 3 }))).toBe(2);
  });

  it('counts finished steps and rounds before the cursor', () => {
    // step 2 set 1: step 1 fully done (3) + 0 sets of step 2.
    expect(completedPositionSets(DEF, cursorAt({ stepIndex: 1, setIndex: 1 }))).toBe(3);
    // round 2, step 1 set 1: full round 1 (5 sets).
    expect(completedPositionSets(DEF, cursorAt({ round: 2, stepIndex: 0, setIndex: 1 }))).toBe(5);
    // round 2, step 2 set 2: round 1 (5) + step 1 of round 2 (3) + 1 set.
    expect(completedPositionSets(DEF, cursorAt({ round: 2, stepIndex: 1, setIndex: 2 }))).toBe(9);
  });

  it('counts completed blocks while the cursor is in a later block', () => {
    expect(completedPositionSets(DEF, cursorAt({ blockIndex: 1, round: 1, stepIndex: 0, setIndex: 1 }))).toBe(10);
  });

  it('never exceeds the planned total and keeps ratio in [0, 1]', () => {
    const end = cursorAt({ blockIndex: 1, round: 1, stepIndex: 0, setIndex: 2 });
    const p = sessionProgress(DEF, end);
    expect(p.doneSets).toBeLessThanOrEqual(p.totalSets);
    expect(p.ratio).toBeLessThanOrEqual(1);
    expect(p.ratio).toBeGreaterThanOrEqual(0);
  });

  it('returns zero ratio for an empty routine without dividing by zero', () => {
    const empty: RoutineDefinition = { id: 'e', name: 'empty', blocks: [] };
    const p = sessionProgress(empty, cursorAt({}));
    expect(p).toEqual({ doneSets: 0, totalSets: 0, ratio: 0 });
  });

  it('treats a block with no explicit sets as one set per work step', () => {
    const def: RoutineDefinition = {
      id: 'r',
      name: 'n',
      blocks: [
        {
          id: 'b',
          name: 'b',
          kind: 'normal',
          rounds: 3,
          steps: [{ id: 's', role: 'work', exerciseId: null, exerciseName: 'Row', prescription: pres(null) }],
          transitions: [],
        },
      ],
    };
    expect(plannedSets(def)).toBe(3);
    expect(completedPositionSets(def, cursorAt({ round: 3, setIndex: 2 }))).toBe(3); // 2 full rounds + clamped
  });
});
