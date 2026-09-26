import React from 'react';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Navigator, useNav, type TabName } from './navigation';
import { TabBar } from './TabBar';
import { strings } from '../constants/strings';
import { useActiveSessionStore } from '../state/activeSessionStore';

let nav: ReturnType<typeof useNav>;

function Harness() {
  nav = useNav();
  return (
    <>
      <Text testID="route">{nav.route.name}</Text>
      <TabBar />
    </>
  );
}

const initialMetrics = {
  frame: { x: 0, y: 0, width: 720, height: 1600 },
  insets: { top: 24, left: 0, right: 0, bottom: 24 },
};

async function renderBar(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <SafeAreaProvider initialMetrics={initialMetrics}>
        <Navigator>{() => <Harness />}</Navigator>
      </SafeAreaProvider>,
    );
  });
  return renderer;
}

function tabNode(renderer: ReactTestRenderer, name: TabName) {
  return renderer.root.findByProps({ testID: `tab-${name}` });
}

/** Host-only lookup (RN renders a composite + host pair per View). */
function hostNodes(renderer: ReactTestRenderer, testID: string) {
  return renderer.root.findAll((n) => (n.type as string) === 'View' && n.props.testID === testID);
}

describe('bottom navigation (Phase 2L)', () => {
  it('renders five tabs with localized labels and tab roles', async () => {
    const renderer = await renderBar();
    const labels: Record<TabName, string> = {
      home: strings.tabs.home,
      routines: strings.tabs.routines,
      train: strings.tabs.train,
      progress: strings.tabs.progress,
      more: strings.tabs.more,
    };
    for (const name of Object.keys(labels) as TabName[]) {
      const node = tabNode(renderer, name);
      expect(node.props.accessibilityRole).toBe('tab');
      expect(node.props.accessibilityLabel).toBe(labels[name]);
    }
    expect(renderer.root.findAllByProps({ testID: 'tab-bar' }).length).toBeGreaterThanOrEqual(1);
  });

  it('marks the current tab selected and the others not', async () => {
    const renderer = await renderBar();
    expect(tabNode(renderer, 'home').props.accessibilityState).toEqual({ selected: true });
    for (const name of ['routines', 'train', 'progress', 'more'] as TabName[]) {
      expect(tabNode(renderer, name).props.accessibilityState).toEqual({ selected: false });
    }
    await act(async () => {
      nav.selectTab('progress');
    });
    expect(tabNode(renderer, 'progress').props.accessibilityState).toEqual({ selected: true });
    expect(tabNode(renderer, 'home').props.accessibilityState).toEqual({ selected: false });
  });

  it('switches tab on press', async () => {
    const renderer = await renderBar();
    await act(async () => {
      tabNode(renderer, 'routines').props.onPress();
    });
    expect(nav.tab).toBe('routines');
    expect(nav.route.name).toBe('routines');
  });

  it('shows a session dot on the Train tab only while a session is active', async () => {
    const renderer = await renderBar();
    expect(hostNodes(renderer, 'tab-train-session-dot')).toHaveLength(0);
    await act(async () => {
      useActiveSessionStore.getState().setSession('s1', 'Push Day');
    });
    expect(hostNodes(renderer, 'tab-train-session-dot')).toHaveLength(1);
    await act(async () => {
      useActiveSessionStore.getState().setSession(null, null);
    });
    expect(hostNodes(renderer, 'tab-train-session-dot')).toHaveLength(0);
  });

  it('uses non-color selected signaling (indicator bar on the active tab only)', async () => {
    const renderer = await renderBar();
    const indicator = (name: TabName) =>
      tabNode(renderer, name).findAll((n) => (n.type as string) === 'View' && n.props.testID === 'tab-indicator');
    expect(indicator('home')).toHaveLength(1);
    expect(indicator('progress')).toHaveLength(0);
    await act(async () => {
      nav.selectTab('progress');
    });
    expect(indicator('progress')).toHaveLength(1);
    expect(indicator('home')).toHaveLength(0);
  });
});
