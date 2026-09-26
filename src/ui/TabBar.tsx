import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { strings } from '../constants/strings';
import { useActiveSessionStore } from '../state/activeSessionStore';
import { TAB_ORDER, useNav, type TabName } from './navigation';

/**
 * Bottom navigation (Phase 2L): five destinations, icon + label, selected
 * state conveyed by an indicator bar + font weight + accessibilityState
 * (never color alone). Rendered by App beneath the active screen; hidden
 * on immersive routes (see isImmersiveRoute).
 */

const TAB_GLYPHS: Record<TabName, string> = {
  home: '⌂',
  routines: '☰',
  train: '▶',
  progress: '▲',
  more: '⋯',
};

/** Labels are read at render time so language switches apply live. */
function tabLabel(name: TabName): string {
  switch (name) {
    case 'home':
      return strings.tabs.home;
    case 'routines':
      return strings.tabs.routines;
    case 'train':
      return strings.tabs.train;
    case 'progress':
      return strings.tabs.progress;
    case 'more':
      return strings.tabs.more;
  }
}

export function TabBar() {
  const { tab, selectTab } = useNav();
  const insets = useSafeAreaInsets();
  const hasActiveSession = useActiveSessionStore((s) => s.sessionId != null);

  return (
    <View
      className="flex-row border-t border-line bg-bg"
      style={{ paddingBottom: Math.max(insets.bottom, 8), paddingTop: 6 }}
      testID="tab-bar"
    >
      {TAB_ORDER.map((name) => {
        const active = tab === name;
        const label = tabLabel(name);
        return (
          <Pressable
            key={name}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected: active }}
            testID={`tab-${name}`}
            onPress={() => selectTab(name)}
            style={({ pressed }) => (pressed ? { opacity: 0.7 } : undefined)}
            className="relative min-h-14 flex-1 items-center justify-center px-1"
          >
            {active ? (
              <View testID="tab-indicator" className="absolute top-0 h-0.5 w-7 rounded-full bg-accent-ink" />
            ) : null}
            <Text
              importantForAccessibility="no"
              accessibilityElementsHidden
              className={`text-lg ${active ? 'text-accent-ink' : 'text-dim'}`}
            >
              {TAB_GLYPHS[name]}
            </Text>
            <Text
              className={`mt-0.5 text-[11px] ${active ? 'font-semibold text-accent-ink' : 'font-medium text-muted'}`}
            >
              {label}
            </Text>
            {name === 'train' && hasActiveSession ? (
              <View
                importantForAccessibility="no"
                accessibilityElementsHidden
                testID="tab-train-session-dot"
                className="absolute right-4 top-1.5 h-1.5 w-1.5 rounded-full bg-accent-ink"
              />
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
