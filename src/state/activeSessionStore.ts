import { create } from 'zustand';

interface ActiveSessionStore {
  sessionId: string | null;
  routineName: string | null;
  setSession: (id: string | null, routineName: string | null) => void;
}

/** UI navigation mirror — the DB is the source of truth for session existence. */
export const useActiveSessionStore = create<ActiveSessionStore>((set) => ({
  sessionId: null,
  routineName: null,
  setSession: (sessionId, routineName) => set({ sessionId, routineName }),
}));
