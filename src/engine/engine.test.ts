import { dispatch, computeTarget } from './index';
import { initialCursor } from './cursor';
import { RoutineDefinition, StepDef, BlockDef, SetPayload, TransitionDef } from '../types/engine';

const NO_SET: SetPayload = { weightGrams: null, reps: null, durationMs: null, distanceMm: null, rir: null };
const SET = (grams = 100000, reps = 5): SetPayload => ({ ...NO_SET, weightGrams: grams, reps });
const T0 = 1_700_000_000_000;

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

const routine = (blocks: BlockDef[]): RoutineDefinition => ({ id: 'r1', name: 'Test', blocks });

const complete = (now = T0, set = SET()) => dispatch as never; // placeholder never used
void complete;

describe('Workout Execution Engine — NORMAL', () => {
  const def = routine([block('b1', 'Main', 'normal', 1, [step('s1', 'Squat', 3)])]);
  const cursor = initialCursor(def, T0);

  it('logs the set and starts a 90s rest between sets', () => {
    const { cursor: c1, effects } = dispatch(def, cursor, { type: 'COMPLETE_SET', now: T0, set: SET() });
    expect(effects[0]).toMatchObject({ kind: 'LOG_SET', blockIndex: 0, stepIndex: 0, round: 1, setIndex: 1 });
    expect(c1.setIndex).toBe(2);
    expect(c1.timer).toMatchObject({ kind: 'rest', durationMs: 90_000, expiresAt: T0 + 90_000 });
    expect(c1.lastReversible).toMatchObject({ kind: 'set', setIndex: 1, setLogId: null });
    const start = effects.find((e) => e.kind === 'START_TIMER');
    expect(start).toMatchObject({ kind: 'START_TIMER', durationMs: 90_000, expiresAt: T0 + 90_000 });
    expect(effects.some((e) => e.kind === 'SCHEDULE_NOTIFICATION')).toBe(true);
  });

  it('timer expiry keeps position and clears the timer', () => {
    const { cursor: c1 } = dispatch(def, cursor, { type: 'COMPLETE_SET', now: T0, set: SET() });
    const { cursor: c2, effects } = dispatch(def, c1, { type: 'TIMER_EXPIRE', now: T0 + 90_000 });
    expect(c2.setIndex).toBe(2);
    expect(c2.timer).toBeNull();
    expect(effects.some((e) => e.kind === 'CANCEL_TIMER')).toBe(true);
    expect(effects.some((e) => e.kind === 'ADVANCE_STEP')).toBe(false);
  });

  it('finishes the session after the last set of the last block', () => {
    let c = cursor;
    for (let i = 1; i <= 3; i++) {
      const r = dispatch(def, c, { type: 'COMPLETE_SET', now: T0, set: SET() });
      c = r.cursor;
      if (i < 3) c = dispatch(def, c, { type: 'TIMER_EXPIRE', now: T0 + i * 90_000 }).cursor;
    }
    const final = dispatch(def, c, { type: 'TIMER_EXPIRE', now: T0 + 300_000 });
    void final;
    // After 3rd set: session completes (no further block).
    const third = dispatch(def, c, { type: 'TIMER_EXPIRE', now: T0 + 300_000 });
    expect(third.cursor.status).toBe('completed');
  });
});

describe('Workout Execution Engine — SUPERSET (implicit semantics)', () => {
  const def = routine([
    block('b1', 'Super', 'superset', 2, [step('a', 'Push', 1), step('b', 'Pull', 1)]),
  ]);

  it('A complete → immediate advance to B (no timer)', () => {
    const { cursor, effects } = dispatch(def, initialCursor(def, T0), { type: 'COMPLETE_SET', now: T0, set: SET() });
    expect(effects.some((e) => e.kind === 'START_TIMER')).toBe(false);
    expect(effects.some((e) => e.kind === 'ADVANCE_STEP')).toBe(true);
    expect(cursor.stepIndex).toBe(1);
    expect(cursor.round).toBe(1);
  });

  it('B complete → implicit loop: REST 90s back to A, round+1 (advance effect fires at expiry)', () => {
    const start = initialCursor(def, T0);
    const { cursor: atB } = dispatch(def, start, { type: 'COMPLETE_SET', now: T0, set: SET() });
    const { cursor, effects } = dispatch(def, atB, { type: 'COMPLETE_SET', now: T0, set: SET() });
    // Navigation effects are emitted when the timer expires, not when it starts:
    expect(effects.some((e) => e.kind === 'START_TIMER')).toBe(true);
    expect(effects.some((e) => e.kind === 'ADVANCE_ROUND')).toBe(false);
    expect(cursor.timer).toMatchObject({ kind: 'rest', durationMs: 90_000 });
    expect(cursor.timer!.target).toMatchObject({ stepIndex: 0, round: 2 });
    expect(cursor.stepIndex).toBe(1); // stays put until timer elapses
    const atExpiry = dispatch(def, cursor, { type: 'TIMER_EXPIRE', now: T0 + 90_000 });
    expect(atExpiry.effects.some((e) => e.kind === 'ADVANCE_ROUND')).toBe(true);
    expect(atExpiry.cursor).toMatchObject({ stepIndex: 0, round: 2 });
  });

  it('last round last step completes the session', () => {
    let c = initialCursor(def, T0);
    // Round 1
    c = dispatch(def, c, { type: 'COMPLETE_SET', now: T0, set: SET() }).cursor; // A
    c = dispatch(def, c, { type: 'COMPLETE_SET', now: T0, set: SET() }).cursor; // B → timer
    c = dispatch(def, c, { type: 'TIMER_EXPIRE', now: T0 + 90_000 }).cursor; // → A r2
    // Round 2
    c = dispatch(def, c, { type: 'COMPLETE_SET', now: T0, set: SET() }).cursor; // A
    const r = dispatch(def, c, { type: 'COMPLETE_SET', now: T0, set: SET() }); // B final
    expect(r.cursor.status).toBe('completed');
    expect(r.effects.some((e) => e.kind === 'COMPLETE_SESSION')).toBe(true);
  });
});

describe('Workout Execution Engine — CONTRAST/PAP (explicit transitions)', () => {
  // Frozen example: A → B = 0ms (IMMEDIATE); B → A = 120s (REST).
  const def = routine([
    block(
      'b1',
      'Contrast A',
      'contrast',
      3,
      [step('a', 'Heavy Squat', 1), step('b', 'Box Jump', 1)],
      [
        { fromStepId: 'a', toStepId: 'b', delayMs: 0, type: 'immediate' },
        { fromStepId: 'b', toStepId: 'a', delayMs: 120_000, type: 'rest' },
      ],
    ),
  ]);

  it('A complete → B with zero delay and no timer', () => {
    const { cursor, effects } = dispatch(def, initialCursor(def, T0), { type: 'COMPLETE_SET', now: T0, set: SET() });
    expect(cursor.stepIndex).toBe(1);
    expect(effects.some((e) => e.kind === 'START_TIMER')).toBe(false);
  });

  it('B complete → REST 120s back to A, next round', () => {
    const start = initialCursor(def, T0);
    const { cursor: atB } = dispatch(def, start, { type: 'COMPLETE_SET', now: T0, set: SET() });
    const { cursor } = dispatch(def, atB, { type: 'COMPLETE_SET', now: T0, set: SET() });
    expect(cursor.timer).toMatchObject({ kind: 'rest', durationMs: 120_000, expiresAt: T0 + 120_000 });
    expect(cursor.timer!.target).toMatchObject({ stepIndex: 0, round: 2 });
  });

  it('rounds exhaust → session completes after final round', () => {
    let c = initialCursor(def, T0);
    for (let round = 1; round <= 3; round++) {
      c = dispatch(def, c, { type: 'COMPLETE_SET', now: T0, set: SET() }).cursor; // A → B
      c = dispatch(def, c, { type: 'COMPLETE_SET', now: T0, set: SET() }).cursor; // B → timer
      if (round < 3) c = dispatch(def, c, { type: 'TIMER_EXPIRE', now: T0 + round * 120_000 }).cursor;
    }
    const r = dispatch(def, c, { type: 'TIMER_EXPIRE', now: T0 + 360_000 });
    expect(r.cursor.status).toBe('completed');
  });
});

describe('Workout Execution Engine — transitions semantics', () => {
  it('AUTO_ADVANCE starts an auto timer with the edge delay', () => {
    const def = routine([
      block('b1', 'Auto', 'circuit', 1, [step('a', 'Work', 1), step('b', 'Work2', 1)], [
        { fromStepId: 'a', toStepId: 'b', delayMs: 15_000, type: 'auto_advance' },
      ]),
    ]);
    const { cursor } = dispatch(def, initialCursor(def, T0), { type: 'COMPLETE_SET', now: T0, set: SET() });
    expect(cursor.timer).toMatchObject({ kind: 'auto', durationMs: 15_000 });
  });

  it('rest-role step converts arrival into an auto timer past it', () => {
    const def = routine([
      block('b1', 'WithRest', 'normal', 1, [step('a', 'Work', 1), restStep('r', 30_000), step('b', 'Work2', 1)]),
    ]);
    const { cursor } = dispatch(def, initialCursor(def, T0), { type: 'COMPLETE_SET', now: T0, set: SET() });
    expect(cursor.timer).toMatchObject({ kind: 'auto', durationMs: 30_000 });
    expect(cursor.timer!.target).toMatchObject({ stepIndex: 2 }); // lands past the rest step
  });

  it('end of block with a next block → REST 120s then ADVANCE_BLOCK', () => {
    const def = routine([
      block('b1', 'One', 'normal', 1, [step('a', 'Work', 1)]),
      block('b2', 'Two', 'normal', 1, [step('c', 'Work', 1)]),
    ]);
    const { cursor, effects } = dispatch(def, initialCursor(def, T0), { type: 'COMPLETE_SET', now: T0, set: SET() });
    expect(cursor.timer).toMatchObject({ kind: 'rest', durationMs: 120_000 });
    expect(cursor.timer!.target).toMatchObject({ blockIndex: 1, stepIndex: 0, round: 1 });
    void effects;
    const r = dispatch(def, cursor, { type: 'TIMER_EXPIRE', now: T0 + 120_000 });
    expect(r.effects.some((e) => e.kind === 'ADVANCE_BLOCK')).toBe(true);
    expect(r.cursor.blockIndex).toBe(1);
  });
});

describe('Workout Execution Engine — SKIP and UNDO', () => {
  const def = routine([block('b1', 'Main', 'normal', 2, [step('a', 'A', 3), step('b', 'B', 2)])]);

  it('skip advances position immediately', () => {
    const { cursor, effects } = dispatch(def, initialCursor(def, T0), { type: 'SKIP_STEP', now: T0 });
    expect(cursor.stepIndex).toBe(1);
    expect(effects.some((e) => e.kind === 'ADVANCE_STEP')).toBe(true);
  });

  it('undo reverts the last completed set (while it is the last event)', () => {
    let { cursor } = dispatch(def, initialCursor(def, T0), { type: 'COMPLETE_SET', now: T0, set: SET(50000, 8) });
    expect(cursor.setIndex).toBe(2);
    const r = dispatch(def, cursor, { type: 'UNDO_LAST', now: T0 + 10_000 });
    expect(r.effects[0]).toMatchObject({ kind: 'VOID_LAST_SET', setLogId: null });
    expect(r.cursor).toMatchObject({ blockIndex: 0, stepIndex: 0, round: 1, setIndex: 1, status: 'active' });
    expect(r.cursor.timer).toBeNull();
    expect(r.cursor.lastReversible).toBeNull();
  });

  it('undo with nothing to undo is a no-op', () => {
    const cursor = initialCursor(def, T0);
    const r = dispatch(def, cursor, { type: 'UNDO_LAST', now: T0 });
    expect(r.cursor).toBe(cursor);
    expect(r.effects).toHaveLength(0);
  });

  it('skip clears the undo reference (no arbitrary history rebuilds)', () => {
    let { cursor } = dispatch(def, initialCursor(def, T0), { type: 'COMPLETE_SET', now: T0, set: SET() });
    cursor = dispatch(def, cursor, { type: 'SKIP_STEP', now: T0 }).cursor;
    const r = dispatch(def, cursor, { type: 'UNDO_LAST', now: T0 });
    expect(r.effects).toHaveLength(0);
  });
});

describe('Workout Execution Engine — guards', () => {
  it('completed cursor ignores events', () => {
    const def = routine([block('b1', 'Main', 'normal', 1, [step('a', 'A', 1)])]);
    const c0 = initialCursor(def, T0);
    const c1 = dispatch(def, c0, { type: 'COMPLETE_SET', now: T0, set: SET() }).cursor;
    expect(c1.status).toBe('completed');
    const r = dispatch(def, c1, { type: 'COMPLETE_SET', now: T0, set: SET() });
    expect(r.cursor).toBe(c1);
    expect(r.effects).toHaveLength(0);
  });

  it('SKIP_TIMER behaves like TIMER_EXPIRE', () => {
    const def = routine([block('b1', 'Main', 'normal', 1, [step('a', 'Squat', 2)])]);
    let { cursor } = dispatch(def, initialCursor(def, T0), { type: 'COMPLETE_SET', now: T0, set: SET() });
    const r = dispatch(def, cursor, { type: 'SKIP_TIMER', now: T0 + 5_000 });
    expect(r.cursor.setIndex).toBe(2);
    expect(r.cursor.timer).toBeNull();
  });
});

describe('computeTarget — explicit edges', () => {
  it('backward jump starts a new round', () => {
    const def = routine([
      block('b1', 'X', 'circuit', 5, [step('a', 'A', 1), step('b', 'B', 1)], [
        { fromStepId: 'b', toStepId: 'a', delayMs: 60_000, type: 'rest' },
      ]),
    ]);
    const t = computeTarget(def, 0, 1, 2);
    expect(t).toMatchObject({ blockIndex: 0, stepIndex: 0, round: 3, sessionComplete: false });
  });

  it('forward jump keeps the round', () => {
    const def = routine([
      block('b1', 'X', 'circuit', 5, [step('a', 'A', 1), step('b', 'B', 1), step('c', 'C', 1)], [
        { fromStepId: 'a', toStepId: 'c', delayMs: 0, type: 'immediate' },
      ]),
    ]);
    const t = computeTarget(def, 0, 0, 2);
    expect(t).toMatchObject({ stepIndex: 2, round: 2, sessionComplete: false });
  });
});
