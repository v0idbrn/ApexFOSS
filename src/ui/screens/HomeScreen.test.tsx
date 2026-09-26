import React from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Navigator, useNav, type Route } from '../navigation';
import { HomeScreen } from './HomeScreen';
import { BarChart } from '../Charts';
import { EmptyState } from '../components';
import { strings } from '../../constants/strings';
import { loadDashboard, type DashboardData } from '../../data/dashboard';
import { loadActiveWorkout, type WorkoutRuntime } from '../../workout/runner';

jest.mock('../../data', () => ({ database: {} }));
jest.mock('../../workout/runner', () => ({
  loadActiveWorkout: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../data/dashboard', () => ({
  loadDashboard: jest.fn(),
}));

const mockedLoad = loadDashboard as jest.MockedFunction<typeof loadDashboard>;
const mockedActive = loadActiveWorkout as jest.MockedFunction<typeof loadActiveWorkout>;

const EMPTY_DASHBOARD: DashboardData = {
  recent: [],
  week: { sessionCount: 0, resistanceGramReps: 0, completedSetCount: 0, wallMs: 0 },
  daily: [],
  lastRoutine: null,
};

function flatten(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(flatten).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return '';
}

function pressableByText(renderer: ReactTestRenderer, label: string) {
  return renderer.root
    .findAll((node) => node.props?.accessibilityRole === 'button')
    .find((p) => p.findAllByType(Text).some((t) => flatten(t.props.children) === label));
}

function pressableByTestID(renderer: ReactTestRenderer, testID: string) {
  return renderer.root
    .findAll((node) => node.props?.testID === testID && typeof node.props?.onPress === 'function')
    .find((node) => node.props?.accessibilityRole === 'button');
}

function textsOf(node: { findAllByType: (t: typeof Text) => unknown[] }): string[] {
  return (node.findAllByType(Text) as unknown[]).map((t) => flatten((t as { props: { children: unknown } }).props.children));
}

function tabOf(renderer: ReactTestRenderer): string {
  return flatten(renderer.root.findByProps({ testID: 'tab-probe' }).props.children);
}

/** Renders the dashboard; every non-home route becomes a marker and is recorded. */
async function renderDashboard(routes?: Route[]): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <Navigator>
        {(route) => {
          routes?.push(route);
          return (
            <>
              {route.name === 'home' ? <HomeScreen /> : <Text testID={`route-${route.name}`} />}
              <TabProbe />
            </>
          );
        }}
      </Navigator>,
    );
  });
  await act(async () => {});
  return renderer;
}

function TabProbe() {
  const { tab } = useNav();
  return <Text testID="tab-probe">{tab}</Text>;
}

const activeRuntime = (): WorkoutRuntime =>
  ({
    sessionId: 'session-active',
    definition: { name: 'Push Day', blocks: [{}, {}] },
    cursor: { status: 'active', blockIndex: 0 },
  }) as unknown as WorkoutRuntime;

/** Week with two sessions, a last routine and seven populated daily buckets. */
function busyDashboard(): DashboardData {
  const now = Date.now();
  return {
    recent: [
      {
        id: 's1',
        name: 'Push Day',
        routineId: 'r9',
        startedAt: now - 3_600_000,
        endedAt: now,
        durationMs: 3_600_000,
        setCount: 12,
        resistanceGramReps: 250_000,
      },
      {
        id: 's2',
        name: 'Pull Day',
        routineId: 'r9',
        startedAt: now - 90_000_000,
        endedAt: now - 86_400_000,
        durationMs: 3_000_000,
        setCount: 10,
        resistanceGramReps: 180_000,
      },
    ],
    week: { sessionCount: 2, resistanceGramReps: 250_000, completedSetCount: 22, wallMs: 3_600_000 },
    daily: Array.from({ length: 7 }, (_, i) => ({
      dayStartMs: now - (6 - i) * 86_400_000,
      resistanceGramReps: (i + 1) * 100_000,
      sessionCount: 1,
    })),
    lastRoutine: { id: 'r9', name: 'Upper Power', lastTrainedAt: now - 86_400_000 },
  };
}

beforeEach(() => {
  mockedActive.mockReset();
  mockedActive.mockResolvedValue(null);
  mockedLoad.mockReset();
  mockedLoad.mockResolvedValue(EMPTY_DASHBOARD);
});

describe('Home navigation (Phase 2F)', () => {
  it('lists the muscle distribution entry among athlete tools', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <Navigator>{(route) => (route.name === 'home' ? <HomeScreen /> : null)}</Navigator>,
      );
    });
    await act(async () => {});
    const entry = pressableByText(renderer, strings.athleteTools.muscles);
    expect(entry).toBeDefined();
    expect(pressableByText(renderer, strings.athleteTools.load)).toBeDefined();
  });

  it('pushes the muscles route when the muscle distribution entry is pressed', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <Navigator>
          {(route) =>
            route.name === 'home' ? (
              <HomeScreen />
            ) : route.name === 'muscles' ? (
              <Text testID="muscles-route" />
            ) : null
          }
        </Navigator>,
      );
    });
    await act(async () => {});
    const entry = pressableByText(renderer, strings.athleteTools.muscles);
    expect(entry).toBeDefined();
    await act(async () => {
      entry!.props.onPress();
    });
    expect(renderer.root.findAllByProps({ testID: 'muscles-route' }).length).toBeGreaterThanOrEqual(1);
  });
});

describe('Home recent-training empty state (Phase 2K V1)', () => {
  async function renderHome(): Promise<ReactTestRenderer> {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <Navigator>{(route) => (route.name === 'home' ? <HomeScreen /> : null)}</Navigator>,
      );
    });
    await act(async () => {});
    return renderer;
  }

  it('renders a single explanatory copy for recent training', async () => {
    const renderer = await renderHome();
    const empty = renderer.root
      .findAllByType(EmptyState)
      .find((n) => n.props.title === strings.home.recentEmptyTitle);
    expect(empty).toBeDefined();
    expect(empty!.props.message).toBe(strings.home.recentEmptyBody);
    expect(empty!.props.description).toBeUndefined();
  });

  it('keeps the start-workout action on the recent empty state', async () => {
    const renderer = await renderHome();
    const empty = renderer.root
      .findAllByType(EmptyState)
      .find((n) => n.props.title === strings.home.recentEmptyTitle);
    expect(empty!.props.actionLabel).toBe(strings.home.startWorkout);
    expect(typeof empty!.props.onAction).toBe('function');
  });
});

describe('Home dashboard hierarchy (Phase 2L Stage E)', () => {
  it('renders the typographic header with app title, tagline and today', async () => {
    const renderer = await renderDashboard();
    expect(renderer.root.findAll((n) => n.props?.testID === 'home-header').length).toBeGreaterThanOrEqual(1);
    const texts = textsOf(renderer.root);
    expect(texts).toContain(strings.home.title);
    expect(texts).toContain(strings.home.tagline);
    expect(texts).toContain(strings.home.today);
    const headers = renderer.root.findAll((n) => n.props?.accessibilityRole === 'header');
    expect(headers.some((h) => flatten(h.props.children) === strings.home.title)).toBe(true);
  });

  it('shows the start-workout hero CTA when no session is active', async () => {
    const renderer = await renderDashboard();
    const hero = pressableByTestID(renderer, 'home-hero-start');
    expect(hero).toBeDefined();
    expect(hero!.props.accessibilityLabel).toBe(strings.home.startWorkout);
    expect(hero!.props.accessibilityState).toBeDefined();
    expect(renderer.root.findAllByProps({ testID: 'home-hero-active' })).toHaveLength(0);
  });

  it('routes the idle hero CTA to the routines destination', async () => {
    const routes: Route[] = [];
    const renderer = await renderDashboard(routes);
    await act(async () => {
      pressableByTestID(renderer, 'home-hero-start')!.props.onPress();
    });
    expect(routes).toContainEqual(expect.objectContaining({ name: 'routines' }));
    expect(tabOf(renderer)).toBe('routines');
  });

  it('shows the resume hero when a session is active', async () => {
    mockedActive.mockResolvedValue(activeRuntime());
    const renderer = await renderDashboard();
    const hero = pressableByTestID(renderer, 'home-hero-active');
    expect(hero).toBeDefined();
    expect(hero!.props.accessibilityLabel).toBe(`${strings.home.activeSession}: Push Day`);
    expect(textsOf(hero!)).toContain(strings.home.resume);
    expect(textsOf(hero!).some((t) => t.includes(`${strings.workout.block} 1/2`))).toBe(true);
    expect(renderer.root.findAllByProps({ testID: 'home-hero-start' })).toHaveLength(0);
  });

  it('resumes an active session into the workout on the train tab', async () => {
    mockedActive.mockResolvedValue(activeRuntime());
    const routes: Route[] = [];
    const renderer = await renderDashboard(routes);
    await act(async () => {
      pressableByTestID(renderer, 'home-hero-active')!.props.onPress();
    });
    expect(routes).toContainEqual(expect.objectContaining({ name: 'workout' }));
    expect(tabOf(renderer)).toBe('train');
  });

  it('renders the week metric strip with sessions, volume and time', async () => {
    mockedLoad.mockResolvedValue(busyDashboard());
    const renderer = await renderDashboard();
    const sessions = renderer.root.findAllByProps({ testID: 'home-week-sessions' })[0];
    const volume = renderer.root.findAllByProps({ testID: 'home-week-volume' })[0];
    const time = renderer.root.findAllByProps({ testID: 'home-week-time' })[0];
    expect(sessions).toBeDefined();
    expect(volume).toBeDefined();
    expect(time).toBeDefined();
    expect(textsOf(sessions)).toEqual(expect.arrayContaining([strings.home.weekSessions, '2']));
    expect(textsOf(volume)).toEqual(expect.arrayContaining([strings.home.weekVolume, '250', strings.load.kgReps]));
    expect(textsOf(time)).toEqual(expect.arrayContaining([strings.home.weekTime, '60', strings.home.weekTimeUnit]));
  });

  it('renders seven daily volume bars when the dashboard has data', async () => {
    mockedLoad.mockResolvedValue(busyDashboard());
    const renderer = await renderDashboard();
    const charts = renderer.root.findAllByType(BarChart);
    expect(charts).toHaveLength(1);
    expect(charts[0].props.label).toBe(strings.home.chartCaption);
    expect(charts[0].props.data).toHaveLength(7);
    expect(charts[0].props.data.every((d: { value: number }) => d.value > 0)).toBe(true);
  });

  it('shows the chart empty hint when the week has no volume', async () => {
    const renderer = await renderDashboard();
    expect(textsOf(renderer.root)).toContain(strings.home.chartEmpty);
    const charts = renderer.root.findAllByType(BarChart);
    expect(charts[0].props.data.every((d: { value: number }) => d.value === 0)).toBe(true);
  });

  it('opens the current routine editor from its card', async () => {
    mockedLoad.mockResolvedValue(busyDashboard());
    const routes: Route[] = [];
    const renderer = await renderDashboard(routes);
    const card = pressableByTestID(renderer, 'home-current-routine');
    expect(card).toBeDefined();
    expect(card!.props.accessibilityLabel).toBe(`${strings.home.currentRoutine}: Upper Power`);
    await act(async () => {
      card!.props.onPress();
    });
    expect(routes).toContainEqual(expect.objectContaining({ name: 'routineEditor', routineId: 'r9' }));
  });

  it('pushes the history detail route for a recent session', async () => {
    mockedLoad.mockResolvedValue(busyDashboard());
    const routes: Route[] = [];
    const renderer = await renderDashboard(routes);
    const row = pressableByTestID(renderer, 'home-recent-s1');
    expect(row).toBeDefined();
    expect(textsOf(row!)).toContain('Push Day');
    await act(async () => {
      row!.props.onPress();
    });
    expect(routes).toContainEqual(expect.objectContaining({ name: 'historyDetail', sessionId: 's1' }));
  });

  it('links to the full history from recent training only when sessions exist', async () => {
    mockedLoad.mockResolvedValue(busyDashboard());
    const withSessions = await renderDashboard();
    const viewAll = pressableByTestID(withSessions, 'home-view-all');
    expect(viewAll).toBeDefined();
    expect(viewAll!.props.accessibilityLabel).toBe(strings.common.viewAll);

    mockedLoad.mockResolvedValue(EMPTY_DASHBOARD);
    const empty = await renderDashboard();
    expect(pressableByTestID(empty, 'home-view-all')).toBeUndefined();
  });

  it('sends the recent-empty action to the routines destination', async () => {
    const routes: Route[] = [];
    const renderer = await renderDashboard(routes);
    const empty = renderer.root
      .findAllByType(EmptyState)
      .find((n) => n.props.title === strings.home.recentEmptyTitle);
    expect(empty).toBeDefined();
    await act(async () => {
      empty!.props.onAction();
    });
    expect(routes).toContainEqual(expect.objectContaining({ name: 'routines' }));
    expect(tabOf(renderer)).toBe('routines');
  });
});

describe('Home progress snapshot (Phase 2L Stage E)', () => {
  it('switches to the progress tab from the snapshot card', async () => {
    const routes: Route[] = [];
    const renderer = await renderDashboard(routes);
    const card = pressableByTestID(renderer, 'home-progress-snapshot');
    expect(card).toBeDefined();
    expect(card!.props.accessibilityLabel).toBe(
      `${strings.home.progressSnapshot}: ${strings.home.snapshotSub}`,
    );
    await act(async () => {
      card!.props.onPress();
    });
    expect(tabOf(renderer)).toBe('progress');
    expect(routes).toContainEqual(expect.objectContaining({ name: 'progress' }));
  });

  it('pairs a glyph and a chevron affordance on the snapshot card', async () => {
    const renderer = await renderDashboard();
    const card = pressableByTestID(renderer, 'home-progress-snapshot')!;
    const glyphs = textsOf(card);
    expect(glyphs).toContain('▲');
    expect(glyphs).toContain('›');
    expect(glyphs).toContain(strings.home.progressSnapshot);
    expect(glyphs).toContain(strings.home.snapshotSub);
  });
});

describe('Home condensed quick tools (Phase 2L Stage E)', () => {
  const ALL_TOOLS: { label: string; route: string }[] = [
    { label: strings.home.exercises, route: 'exercises' },
    { label: strings.home.routines, route: 'routines' },
    { label: strings.history.title, route: 'history' },
    { label: strings.athleteTools.records, route: 'records' },
    { label: strings.athleteTools.load, route: 'load' },
    { label: strings.athleteTools.muscles, route: 'muscles' },
    { label: strings.athleteTools.readiness, route: 'readiness' },
    { label: strings.athleteTools.inventory, route: 'inventory' },
    { label: strings.portability.title, route: 'portability' },
    { label: strings.trust.title, route: 'trust' },
  ];

  async function pressTool(label: string): Promise<Route[]> {
    const routes: Route[] = [];
    const renderer = await renderDashboard(routes);
    const entry = pressableByText(renderer, label);
    expect(entry).toBeDefined();
    await act(async () => {
      entry!.props.onPress();
    });
    return routes;
  }

  it('keeps every former quick-tool destination reachable', async () => {
    const renderer = await renderDashboard();
    for (const tool of ALL_TOOLS) {
      expect({ label: tool.label, found: pressableByText(renderer, tool.label) !== undefined }).toEqual({
        label: tool.label,
        found: true,
      });
    }
    expect(renderer.root.findAll((n) => n.props?.testID === 'home-trust').length).toBeGreaterThanOrEqual(1);
    expect(pressableByTestID(renderer, 'home-trust')).toBeDefined();
  });

  it('groups the tools under authoring, training and app captions', async () => {
    const renderer = await renderDashboard();
    const groups: Record<string, string> = {
      'home-group-authoring': strings.home.authoring,
      'home-group-training': strings.home.training,
      'home-group-app': strings.home.appSection,
    };
    for (const [testID, caption] of Object.entries(groups)) {
      const group = renderer.root
        .findAll((n) => n.props?.testID === testID)
        .find((n) => typeof n.props?.onPress !== 'function');
      expect(group).toBeDefined();
      expect(textsOf(group!)).toContain(caption);
    }
    const sectionTitles = renderer.root
      .findAll((n) => n.props?.accessibilityRole === 'header')
      .map((n) => flatten(n.props.children));
    expect(sectionTitles).toContain(strings.home.tools);
  });

  it('opens the authoring destinations (exercises and routines)', async () => {
    expect(await pressTool(strings.home.exercises)).toContainEqual(
      expect.objectContaining({ name: 'exercises' }),
    );
    const routes = await pressTool(strings.home.routines);
    expect(routes).toContainEqual(expect.objectContaining({ name: 'routines' }));
  });

  it('opens every training destination', async () => {
    for (const name of ['history', 'records', 'load', 'muscles', 'readiness', 'inventory'] as const) {
      const tool = ALL_TOOLS.find((t) => t.route === name)!;
      const routes = await pressTool(tool.label);
      expect({ route: name, reached: routes.some((r) => r.name === name) }).toEqual({
        route: name,
        reached: true,
      });
    }
  });

  it('opens the app destinations and keeps the stable trust testID', async () => {
    expect(await pressTool(strings.portability.title)).toContainEqual(
      expect.objectContaining({ name: 'portability' }),
    );
    const routes = await pressTool(strings.trust.title);
    expect(routes).toContainEqual(expect.objectContaining({ name: 'trust' }));
  });
});

describe('Home accessibility (Phase 2L Stage E)', () => {
  it('gives every interactive element a role, a label and state', async () => {
    mockedLoad.mockResolvedValue(busyDashboard());
    const renderer = await renderDashboard();
    const interactive = renderer.root.findAll(
      (n) => typeof n.type === 'function' && n.type.name === 'Pressable' && typeof n.props?.onPress === 'function',
    );
    expect(interactive.length).toBeGreaterThanOrEqual(12);
    for (const node of interactive) {
      expect(node.props.accessibilityRole).toBe('button');
      const label =
        typeof node.props.accessibilityLabel === 'string' && node.props.accessibilityLabel.length > 0
          ? node.props.accessibilityLabel
          : textsOf(node).join('');
      expect(label.length).toBeGreaterThan(0);
      if (typeof node.props.testID === 'string' && node.props.testID.startsWith('home-')) {
        expect(node.props.accessibilityState).toBeDefined();
      }
    }
  });

  it('announces the screen and section titles as headings', async () => {
    const renderer = await renderDashboard();
    const headers = renderer.root
      .findAll((n) => n.props?.accessibilityRole === 'header')
      .map((n) => flatten(n.props.children));
    for (const expected of [
      strings.home.title,
      strings.home.weekSection,
      strings.home.recent,
      strings.home.tools,
      strings.home.authoring,
      strings.home.training,
      strings.home.appSection,
    ]) {
      expect(headers).toContain(expected);
    }
  });

  it('exposes large touch targets on rows, hero and snapshot', async () => {
    mockedLoad.mockResolvedValue(busyDashboard());
    const renderer = await renderDashboard();
    for (const testID of [
      'home-hero-start',
      'home-progress-snapshot',
      'home-tool-muscles',
      'home-recent-s1',
      'home-current-routine',
    ]) {
      const node = renderer.root
        .findAll((n) => n.props?.testID === testID && typeof n.props?.className === 'string')
        .find((n) => typeof n.props?.onPress === 'function');
      expect(node).toBeDefined();
      expect(/\bmin-h-(12|14|16|20|24|32)\b/.test(node!.props.className)).toBe(true);
    }
  });
});
