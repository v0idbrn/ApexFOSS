import React from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import {
  TAB_ORDER,
  TAB_ROOTS,
  Navigator,
  backAction,
  isImmersiveRoute,
  useNav,
  type Route,
} from './navigation';

type Nav = ReturnType<typeof useNav>;

let nav: Nav;

function Probe() {
  nav = useNav();
  return <Text testID="route">{nav.route.name}</Text>;
}

async function renderNav(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<Navigator>{() => <Probe />}</Navigator>);
  });
  return renderer;
}

describe('tab-aware navigator (Phase 2L)', () => {
  it('starts on the Home tab root', async () => {
    await renderNav();
    expect(nav.route.name).toBe('home');
    expect(nav.depth).toBe(1);
    expect(nav.tab).toBe('home');
  });

  it('exposes exactly the five primary tabs in order', () => {
    expect(TAB_ORDER).toEqual(['home', 'routines', 'train', 'progress', 'more']);
    expect(Object.keys(TAB_ROOTS)).toEqual([...TAB_ORDER]);
  });

  it('pushes and pops within the active tab', async () => {
    await renderNav();
    await act(async () => {
      nav.push({ name: 'exercises' });
    });
    expect(nav.route.name).toBe('exercises');
    expect(nav.depth).toBe(2);
    await act(async () => {
      nav.pop();
    });
    expect(nav.route.name).toBe('home');
    expect(nav.depth).toBe(1);
  });

  it('switches tabs and shows each tab root', async () => {
    await renderNav();
    for (const tab of TAB_ORDER) {
      await act(async () => {
        nav.selectTab(tab);
      });
      expect(nav.tab).toBe(tab);
      expect(nav.route.name).toBe(tab);
      expect(nav.depth).toBe(1);
    }
  });

  it('keeps independent stacks per tab', async () => {
    await renderNav();
    await act(async () => {
      nav.push({ name: 'exercises' });
    });
    expect(nav.depth).toBe(2);
    await act(async () => {
      nav.selectTab('progress');
    });
    expect(nav.route.name).toBe('progress');
    expect(nav.depth).toBe(1);
    await act(async () => {
      nav.selectTab('home');
    });
    expect(nav.route.name).toBe('exercises');
    expect(nav.depth).toBe(2);
  });

  it('pops the active tab back to its root when re-selected', async () => {
    await renderNav();
    await act(async () => {
      nav.selectTab('progress');
    });
    await act(async () => {
      nav.push({ name: 'records' });
    });
    expect(nav.depth).toBe(2);
    await act(async () => {
      nav.selectTab('progress');
    });
    expect(nav.route.name).toBe('progress');
    expect(nav.depth).toBe(1);
  });

  it('routes the workout to the train tab from any tab', async () => {
    await renderNav();
    await act(async () => {
      nav.push({ name: 'workout' });
    });
    expect(nav.tab).toBe('train');
    expect(nav.route.name).toBe('workout');
    expect(nav.depth).toBe(2); // train root + workout
  });

  it('preserves an active workout across tab switches', async () => {
    await renderNav();
    await act(async () => {
      nav.startWorkout();
    });
    expect(nav.tab).toBe('train');
    expect(nav.route.name).toBe('workout');
    await act(async () => {
      nav.selectTab('home');
    });
    expect(nav.route.name).toBe('home');
    await act(async () => {
      nav.selectTab('train');
    });
    expect(nav.route.name).toBe('workout');
    expect(nav.depth).toBe(2);
  });

  it('does not duplicate the workout entry when started twice', async () => {
    await renderNav();
    await act(async () => {
      nav.startWorkout();
    });
    await act(async () => {
      nav.selectTab('home');
    });
    await act(async () => {
      nav.startWorkout();
    });
    expect(nav.tab).toBe('train');
    expect(nav.route.name).toBe('workout');
    expect(nav.depth).toBe(2);
  });
});

describe('Android back behavior (Phase 2L)', () => {
  it('pops deep stacks regardless of tab', () => {
    expect(backAction(3, 'home')).toBe('pop');
    expect(backAction(2, 'train')).toBe('pop');
  });

  it('unwinds non-home tab roots to Home', () => {
    expect(backAction(1, 'routines')).toBe('home');
    expect(backAction(1, 'progress')).toBe('home');
    expect(backAction(1, 'more')).toBe('home');
    expect(backAction(1, 'train')).toBe('home');
  });

  it('exits the app only from the Home root', () => {
    expect(backAction(1, 'home')).toBe('exit');
  });
});

describe('immersive routes (Phase 2L)', () => {
  it('hides bottom navigation for workout and focused editors', () => {
    const immersive: Route[] = [
      { name: 'workout' },
      { name: 'routineEditor', routineId: null },
      { name: 'exerciseEditor', exerciseId: null },
      { name: 'portability' },
    ];
    for (const route of immersive) expect(isImmersiveRoute(route)).toBe(true);
  });

  it('keeps bottom navigation on tabs and detail screens', () => {
    const visible: Route[] = [
      { name: 'home' },
      { name: 'train' },
      { name: 'progress' },
      { name: 'more' },
      { name: 'routines' },
      { name: 'history' },
      { name: 'records' },
      { name: 'trust' },
      { name: 'historyDetail', sessionId: 's1' },
    ];
    for (const route of visible) expect(isImmersiveRoute(route)).toBe(false);
  });
});
