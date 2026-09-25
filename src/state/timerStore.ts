import { create } from 'zustand';

/**
 * Visual mirror only (frozen rule): truth lives in cursor_json.timer.expiresAt.
 * The store recomputes remainingMs from Date.now(); it never owns the timer.
 * While paused (cursor pausedAt set), remaining is frozen at expiresAt − pausedAt.
 */
interface TimerStore {
  expiresAt: number | null;
  durationMs: number | null;
  kind: 'rest' | 'auto' | null;
  pausedAt: number | null;
  remainingMs: number;
  paused: boolean;
  setFromCursor: (timer: { kind: 'rest' | 'auto'; durationMs: number; expiresAt: number; pausedAt?: number | null } | null) => void;
  tick: () => void;
  clear: () => void;
}

const remainingOf = (expiresAt: number, pausedAt: number | null, now: number): number =>
  Math.max(0, expiresAt - (pausedAt ?? now));

export const useTimerStore = create<TimerStore>((set) => ({
  expiresAt: null,
  durationMs: null,
  kind: null,
  pausedAt: null,
  remainingMs: 0,
  paused: false,
  setFromCursor: (timer) =>
    timer
      ? set({
          expiresAt: timer.expiresAt,
          durationMs: timer.durationMs,
          kind: timer.kind,
          pausedAt: timer.pausedAt ?? null,
          paused: timer.pausedAt != null,
          remainingMs: remainingOf(timer.expiresAt, timer.pausedAt ?? null, Date.now()),
        })
      : set({ expiresAt: null, durationMs: null, kind: null, pausedAt: null, paused: false, remainingMs: 0 }),
  tick: () =>
    set((s) =>
      s.expiresAt === null
        ? { remainingMs: 0 }
        : { remainingMs: remainingOf(s.expiresAt, s.pausedAt, Date.now()) },
    ),
  clear: () => set({ expiresAt: null, durationMs: null, kind: null, pausedAt: null, paused: false, remainingMs: 0 }),
}));
