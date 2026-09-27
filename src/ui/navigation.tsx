import { BackHandler } from 'react-native';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { RoutineDraft } from '../types/draft';

/**
 * Tab-aware stack navigator (Phase 2L). No navigation framework dependency —
 * five top-level destinations, each with its own navigation stack, correct
 * Android back behavior (deep stack → tab root → Home → exit), and an
 * immersive mode for focused routes (workout / editors) where the bottom
 * navigation is hidden.
 */

export type TabName = 'home' | 'routines' | 'train' | 'progress' | 'more';

export const TAB_ORDER: readonly TabName[] = ['home', 'routines', 'train', 'progress', 'more'] as const;

export type Route =
  | { name: 'home' }
  | { name: 'routines' }
  | { name: 'train' }
  | { name: 'progress' }
  | { name: 'more' }
  | { name: 'exercises' }
  | { name: 'exerciseEditor'; exerciseId: string | null }
  | { name: 'programs' }
  | { name: 'programDetail'; programId: string }
  | { name: 'templates' }
  | { name: 'routineEditor'; routineId: string | null }
  | { name: 'routinePreview'; draft: RoutineDraft }
  | { name: 'workout' }
  | { name: 'history' }
  | { name: 'historyDetail'; sessionId: string }
  | { name: 'compare'; sessionId: string }
  | { name: 'portability' }
  | { name: 'load' }
  | { name: 'muscles' }
  | { name: 'records' }
  | { name: 'inventory' }
  | { name: 'readiness' }
  | { name: 'trust' }
  | { name: 'report' };

export type TabRootRoute = Extract<Route, { name: TabName }>;

export const TAB_ROOTS: Record<TabName, TabRootRoute> = {
  home: { name: 'home' },
  routines: { name: 'routines' },
  train: { name: 'train' },
  progress: { name: 'progress' },
  more: { name: 'more' },
};

/**
 * Immersive routes hide the bottom navigation: the athlete is inside a
 * workout or a focused editor where chrome would compete for attention
 * (and where the keyboard owns the bottom edge).
 */
export function isImmersiveRoute(route: Route): boolean {
  return route.name === 'workout' || route.name === 'routineEditor' || route.name === 'exerciseEditor' || route.name === 'portability';
}

interface NavValue {
  route: Route;
  /** Depth of the ACTIVE tab's stack (1 = tab root). */
  depth: number;
  tab: TabName;
  push: (route: Route) => void;
  pop: () => void;
  /** Switches tabs; re-tapping the active tab pops it back to its root. */
  selectTab: (tab: TabName) => void;
  /**
   * Starts (or resumes) the workout: the `workout` route always lives on
   * the train tab's stack, so switching tabs mid-session and returning
   * lands straight back in the session.
   */
  startWorkout: () => void;
  /** Screens register a handler to intercept Android/system back. Return true = handled. */
  setBackInterceptor: (fn: (() => boolean) | null) => void;
}

const NavContext = createContext<NavValue | null>(null);

export function useNav(): NavValue {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error('useNav outside Navigator');
  return ctx;
}

let keyCounter = 0;
const entry = (route: Route) => ({ key: `r${++keyCounter}`, route });

const initialStacks = (): Record<TabName, { key: string; route: Route }[]> => ({
  home: [entry(TAB_ROOTS.home)],
  routines: [entry(TAB_ROOTS.routines)],
  train: [entry(TAB_ROOTS.train)],
  progress: [entry(TAB_ROOTS.progress)],
  more: [entry(TAB_ROOTS.more)],
});

/**
 * Android back decision (pure — unit tested). `pop` deepens no further:
 * tab roots unwind to Home, Home exits the app.
 */
export function backAction(depth: number, tab: TabName): 'pop' | 'home' | 'exit' {
  if (depth > 1) return 'pop';
  if (tab !== 'home') return 'home';
  return 'exit';
}

export function Navigator({ children }: { children: (route: Route) => ReactNode }) {
  const [stacks, setStacks] = useState(initialStacks);
  const [tab, setTab] = useState<TabName>('home');
  const stacksRef = useRef(stacks);
  stacksRef.current = stacks;
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const interceptorRef = useRef<(() => boolean) | null>(null);

  const push = useCallback((route: Route) => {
    // The workout always belongs to the train tab, whatever tab started it.
    if (route.name === 'workout') {
      setTab('train');
      setStacks((s) => (hasWorkout(s.train) ? s : { ...s, train: [...s.train, entry(route)] }));
      return;
    }
    setStacks((s) => ({ ...s, [tabRef.current]: [...s[tabRef.current], entry(route)] }));
  }, []);

  const pop = useCallback(() => {
    setStacks((s) => {
      const current = s[tabRef.current];
      if (current.length <= 1) return s;
      return { ...s, [tabRef.current]: current.slice(0, -1) };
    });
  }, []);

  const selectTab = useCallback((next: TabName) => {
    if (next === tabRef.current) {
      // Re-tap: pop the active tab back to its root (standard bottom-nav behavior).
      setStacks((s) => (s[next].length > 1 ? { ...s, [next]: [s[next][0]] } : s));
      return;
    }
    setTab(next);
  }, []);

  const startWorkout = useCallback(() => {
    setTab('train');
    setStacks((s) =>
      hasWorkout(s.train) ? s : { ...s, train: [...s.train.slice(0, 1), entry({ name: 'workout' })] },
    );
  }, []);

  const setBackInterceptor = useCallback((fn: (() => boolean) | null) => {
    interceptorRef.current = fn;
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (interceptorRef.current && interceptorRef.current()) return true;
      const currentTab = tabRef.current;
      const stack = stacksRef.current[currentTab];
      switch (backAction(stack.length, currentTab)) {
        case 'pop':
          setStacks((s) => ({ ...s, [currentTab]: s[currentTab].slice(0, -1) }));
          return true;
        case 'home':
          setTab('home');
          return true;
        case 'exit':
          return false; // let the OS handle it (exit app)
      }
    });
    return () => sub.remove();
  }, []);

  const currentStack = stacks[tab];
  const top = currentStack[currentStack.length - 1];
  const value = useMemo<NavValue>(
    () => ({
      route: top.route,
      depth: currentStack.length,
      tab,
      push,
      pop,
      selectTab,
      startWorkout,
      setBackInterceptor,
    }),
    [top.route, currentStack.length, tab, push, pop, selectTab, startWorkout, setBackInterceptor],
  );

  return <NavContext.Provider value={value}>{children(top.route)}</NavContext.Provider>;
}

function hasWorkout(stack: { route: Route }[]): boolean {
  return stack.some((e) => e.route.name === 'workout');
}
