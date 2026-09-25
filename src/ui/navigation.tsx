import { BackHandler } from 'react-native';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

/**
 * Minimal stack navigator (Day 2). No navigation framework dependency —
 * the app only needs Home ⇄ list ⇄ editor with correct Android back behavior.
 */

export type Route =
  | { name: 'home' }
  | { name: 'exercises' }
  | { name: 'exerciseEditor'; exerciseId: string | null }
  | { name: 'routines' }
  | { name: 'routineEditor'; routineId: string | null }
  | { name: 'workout' }
  | { name: 'history' }
  | { name: 'historyDetail'; sessionId: string }
  | { name: 'portability' }
  | { name: 'importPreview'; encoded: string }
  | { name: 'load' }
  | { name: 'muscles' }
  | { name: 'inventory' }
  | { name: 'readiness' };

interface NavValue {
  route: Route;
  depth: number;
  push: (route: Route) => void;
  pop: () => void;
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

export function Navigator({ children }: { children: (route: Route) => ReactNode }) {
  const [stack, setStack] = useState(() => [entry({ name: 'home' as const })]);
  const stackRef = useRef(stack);
  stackRef.current = stack;
  const interceptorRef = useRef<(() => boolean) | null>(null);

  const push = useCallback((route: Route) => setStack((s) => [...s, entry(route)]), []);
  const pop = useCallback(() => setStack((s) => (s.length <= 1 ? s : s.slice(0, -1))), []);
  const setBackInterceptor = useCallback((fn: (() => boolean) | null) => {
    interceptorRef.current = fn;
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (interceptorRef.current && interceptorRef.current()) return true;
      if (stackRef.current.length <= 1) return false; // let the OS handle it (exit app)
      setStack((s) => (s.length <= 1 ? s : s.slice(0, -1)));
      return true;
    });
    return () => sub.remove();
  }, []);

  const top = stack[stack.length - 1];
  const value = useMemo<NavValue>(
    () => ({ route: top.route, depth: stack.length, push, pop, setBackInterceptor }),
    [top.route, stack.length, push, pop, setBackInterceptor],
  );

  return <NavContext.Provider value={value}>{children(top.route)}</NavContext.Provider>;
}
