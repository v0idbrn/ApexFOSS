import { dispatch } from '../engine';
import type { ExecutionCursor, RoutineDefinition, TimerState } from '../types/engine';
import { expiredTimerRecoveryEvent, isTimerExpired } from './runner';

jest.mock('../notifications', () => ({
  scheduleTimerNotification: jest.fn(async (expiresAt: number, title: string) => `n_${expiresAt}_${title}`),
  cancelTimerNotification: jest.fn(async () => undefined),
}));

/**
 * Recovery semantics (D-064): an expired rest advances exactly like a live
 * expiry; an exercise countdown interrupted by process death is cancelled at
 * the same position and must not produce a LOG_SET effect.
 */

const T0 = 1_700_000_000_000;

const definition: RoutineDefinition = {
  id: 'r1',
  name: 'Timed',
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
          exerciseName: 'Plank',
          prescription: {
            targetSets: 2,
            targetRepsMin: null,
            targetRepsMax: null,
            targetDurationMs: 30_000,
            targetWeightGrams: null,
            targetRir: null,
            tempo: { eccentricMs: null, pauseBottomMs: null, concentricMs: null, pauseTopMs: null },
          },
        },
      ],
      transitions: [],
    },
  ],
};

const cursor = (timer: TimerState | null): ExecutionCursor => ({
  blockIndex: 0,
  stepIndex: 0,
  round: 1,
  setIndex: 1,
  status: 'active',
  timer,
  lastReversible: null,
  startedAt: T0,
});

const timer = (over: Partial<TimerState>): TimerState => ({
  kind: 'rest',
  durationMs: 90_000,
  expiresAt: T0 + 90_000,
  target: { blockIndex: 0, stepIndex: 0, round: 1, setIndex: 1 },
  pausedAt: null,
  ...over,
});

describe('expiredTimerRecoveryEvent', () => {
  it('returns nothing without a timer, before expiry, or while paused', () => {
    expect(expiredTimerRecoveryEvent(cursor(null), T0)).toBeNull();
    expect(expiredTimerRecoveryEvent(cursor(timer({})), T0)).toBeNull();
    expect(
      expiredTimerRecoveryEvent(cursor(timer({ kind: 'exercise', pausedAt: T0 + 1_000 })), T0 + 200_000),
    ).toBeNull();
  });

  it('advances rest, auto and preparation timers like a live expiry', () => {
    for (const kind of ['rest', 'auto', 'preparation'] as const) {
      expect(expiredTimerRecoveryEvent(cursor(timer({ kind })), T0 + 90_000)).toEqual({
        type: 'TIMER_EXPIRE',
        now: T0 + 90_000,
      });
    }
  });

  it('cancels an interrupted exercise countdown instead of expiring it', () => {
    const c = cursor(timer({ kind: 'exercise', durationMs: 30_000, expiresAt: T0 + 30_000 }));
    expect(isTimerExpired(c, T0 + 40_000)).toBe(true);
    expect(expiredTimerRecoveryEvent(c, T0 + 40_000)).toEqual({
      type: 'SKIP_TIMER',
      now: T0 + 40_000,
    });
  });
});

describe('recovered timer effects', () => {
  it('cancels an interrupted exercise without logging the set or moving', () => {
    const c = cursor(timer({ kind: 'exercise', durationMs: 30_000, expiresAt: T0 + 30_000 }));
    const result = dispatch(definition, c, expiredTimerRecoveryEvent(c, T0 + 60_000)!);

    expect(result.cursor.blockIndex).toBe(0);
    expect(result.cursor.stepIndex).toBe(0);
    expect(result.cursor.round).toBe(1);
    expect(result.cursor.setIndex).toBe(1);
    expect(result.cursor.timer).toBeNull();
    expect(result.cursor.status).toBe('active');
    expect(result.effects.some((e) => e.kind === 'LOG_SET')).toBe(false);
  });

  it('still advances an expired rest timer', () => {
    const c = cursor(timer({ kind: 'rest', target: { blockIndex: 0, stepIndex: 0, round: 1, setIndex: 2 } }));
    const result = dispatch(definition, c, expiredTimerRecoveryEvent(c, T0 + 90_000)!);
    expect(result.cursor.timer).toBeNull();
    expect(result.cursor.setIndex).toBe(2);
  });
});
