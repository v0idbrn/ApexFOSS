import { create } from 'zustand';

/**
 * Visual mirror only (frozen rule): truth lives in cursor_json.timer.expiresAt.
 * The store recomputes remainingMs from Date.now(); it never owns the timer.
 */
interface TimerStore {
  expiresAt: number | null;
  durationMs: number | null;
  kind: 'rest' | 'auto' | null;
  remainingMs: number;
  setFromCursor: (timer: { kind: 'rest' | 'auto'; durationMs: number; expiresAt: number } | null) => void;
  tick: () => void;
  clear: () => void;
}

export const useTimerStore = create<TimerStore>((set) => ({
  expiresAt: null,
  durationMs: null,
  kind: null,
  remainingMs: 0,
  setFromCursor: (timer) =>
    timer
      ? set({ expiresAt: timer.expiresAt, durationMs: timer.durationMs, kind: timer.kind, remainingMs: Math.max(0, timer.expiresAt - Date.now()) })
      : set({ expiresAt: null, durationMs: null, kind: null, remainingMs: 0 }),
  tick: () =>
    set((s) => (s.expiresAt === null ? { remainingMs: 0 } : { remainingMs: Math.max(0, s.expiresAt - Date.now()) })),
  clear: () => set({ expiresAt: null, durationMs: null, kind: null, remainingMs: 0 }),
}));
