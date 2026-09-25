import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, type ViewStyle } from 'react-native';

/**
 * Tasteful, interruptible motion helpers (Phase 2J §6).
 * Short entrance fades only — no decorative loops, no extra dependencies.
 * All motion respects the system reduce-motion setting.
 */

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (mounted) setReduced(v);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

/** Entrance style: short fade + 8dp rise. Static (opacity 1) when reduced motion is on. */
export function useEnterStyle(delayMs = 0): Animated.WithAnimatedValue<ViewStyle> {
  const reduced = useReducedMotion();
  const anim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduced) {
      anim.setValue(1);
      return;
    }
    anim.setValue(0);
    const timing = Animated.timing(anim, {
      toValue: 1,
      duration: 200,
      delay: delayMs,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    timing.start();
    return () => timing.stop();
  }, [anim, reduced, delayMs]);
  return {
    opacity: anim,
    transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
  };
}

/** Content wrapper with a short entrance fade (skip when reduced motion). */
export function Enter({ children, delayMs = 0, className }: { children: ReactNode; delayMs?: number; className?: string }) {
  const style = useEnterStyle(delayMs);
  return (
    <Animated.View style={style} className={className}>
      {children}
    </Animated.View>
  );
}
