import type { ExecutionCursor, TimerState } from '../types/engine';
import { isTimerExpired, reconcileTimerNotification } from './runner';
import { parseCursor } from '../engine/cursor';
import { useTimerStore } from '../state/timerStore';

jest.mock('../notifications', () => ({
  scheduleTimerNotification: jest.fn(async (expiresAt: number, title: string) => `notif_${expiresAt}_${title}`),
  cancelTimerNotification: jest.fn(async () => undefined),
  requestNotificationPermission: jest.fn(async () => true),
  listScheduledNotificationIds: jest.fn(async () => []),
  __resetNotificationPermissionLatchForTests: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const notifications = require('../notifications');

const NOW = 1_700_000_000_000;

function cursorWithTimer(timer: TimerState | null): ExecutionCursor {
  return {
    blockIndex: 0,
    stepIndex: 0,
    round: 1,
    setIndex: 1,
    status: 'active',
    timer,
    lastReversible: null,
    startedAt: NOW - 1000,
  };
}

const target = { blockIndex: 0, stepIndex: 1, round: 1, setIndex: 1 };

describe('timer pause (Phase 2J §5) — expiresAt stays canonical', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useTimerStore.getState().clear();
  });

  it('isTimerExpired: expired running timer reports true', () => {
    const c = cursorWithTimer({ kind: 'rest', durationMs: 60_000, expiresAt: NOW - 1, target });
    expect(isTimerExpired(c, NOW)).toBe(true);
  });

  it('isTimerExpired: paused timer never reports expired, even past expiresAt', () => {
    const c = cursorWithTimer({ kind: 'rest', durationMs: 60_000, expiresAt: NOW - 1, target, pausedAt: NOW - 5000 });
    expect(isTimerExpired(c, NOW)).toBe(false);
  });

  it('isTimerExpired: running future timer reports false', () => {
    const c = cursorWithTimer({ kind: 'rest', durationMs: 60_000, expiresAt: NOW + 30_000, target });
    expect(isTimerExpired(c, NOW)).toBe(false);
  });

  it('reconcile: paused timer cancels any scheduled notification instead of scheduling', async () => {
    const timer: TimerState = { kind: 'rest', durationMs: 60_000, expiresAt: NOW + 30_000, target, pausedAt: NOW };
    await reconcileTimerNotification('sess-1', timer, NOW);
    expect(notifications.cancelTimerNotification).toHaveBeenCalled();
    expect(notifications.scheduleTimerNotification).not.toHaveBeenCalled();
  });

  it('reconcile: resumed timer schedules against the rewritten expiresAt', async () => {
    const timer: TimerState = { kind: 'rest', durationMs: 60_000, expiresAt: NOW + 30_000, target, pausedAt: null };
    await reconcileTimerNotification('sess-2', timer, NOW);
    expect(notifications.scheduleTimerNotification).toHaveBeenCalledWith(NOW + 30_000, expect.any(String));
  });

  it('parseCursor: preserves a valid pausedAt', () => {
    const json = JSON.stringify(cursorWithTimer({ kind: 'rest', durationMs: 60_000, expiresAt: NOW + 30_000, target, pausedAt: NOW }));
    const parsed = parseCursor(json);
    expect(parsed.timer?.pausedAt).toBe(NOW);
  });

  it('parseCursor: drops a malformed pausedAt without crashing', () => {
    const json = JSON.stringify({
      ...cursorWithTimer({ kind: 'rest', durationMs: 60_000, expiresAt: NOW + 30_000, target }),
      timer: { kind: 'rest', durationMs: 60_000, expiresAt: NOW + 30_000, target, pausedAt: 'bogus' },
    });
    const parsed = parseCursor(json);
    expect(parsed.timer?.pausedAt).toBeNull();
    expect(parsed.timer?.expiresAt).toBe(NOW + 30_000);
  });

  it('timer store: freezes remaining at expiresAt − pausedAt while paused', () => {
    const pausedAt = NOW;
    const expiresAt = NOW + 40_000;
    useTimerStore.getState().setFromCursor({ kind: 'rest', durationMs: 60_000, expiresAt, pausedAt });
    const frozen = useTimerStore.getState().remainingMs;
    expect(frozen).toBe(40_000);
    expect(useTimerStore.getState().paused).toBe(true);
    useTimerStore.getState().tick();
    expect(useTimerStore.getState().remainingMs).toBe(frozen);
  });

  it('timer store: counts down again once pausedAt is cleared', () => {
    const expiresAt = Date.now() + 30_000;
    useTimerStore.getState().setFromCursor({ kind: 'rest', durationMs: 60_000, expiresAt, pausedAt: null });
    expect(useTimerStore.getState().paused).toBe(false);
    const before = useTimerStore.getState().remainingMs;
    expect(before).toBeLessThanOrEqual(30_000);
    expect(before).toBeGreaterThan(25_000);
  });

  it('timer store: clear resets pause state', () => {
    useTimerStore.getState().setFromCursor({ kind: 'rest', durationMs: 60_000, expiresAt: NOW + 1000, pausedAt: NOW });
    useTimerStore.getState().clear();
    expect(useTimerStore.getState().paused).toBe(false);
    expect(useTimerStore.getState().pausedAt).toBeNull();
    expect(useTimerStore.getState().remainingMs).toBe(0);
  });
});
