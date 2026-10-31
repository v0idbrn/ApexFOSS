import React from 'react';
import { BackHandler, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Navigator, type Route } from '../navigation';
import { HomeScreen } from './HomeScreen';
import { strings } from '../../constants/strings';
import { loadDashboard, type DashboardData } from '../../data/dashboard';
import { loadActiveWorkout } from '../../workout/runner';
import { loadLearnProgress, saveLearnProgress } from '../../learn/progress';

jest.mock('../../data', () => ({ database: {} }));
jest.mock('../../data/dashboard', () => ({ loadDashboard: jest.fn() }));
jest.mock('../../workout/runner', () => ({ loadActiveWorkout: jest.fn() }));
jest.mock('../../learn/progress', () => ({
  loadLearnProgress: jest.fn(),
  saveLearnProgress: jest.fn(() => Promise.resolve()),
}));

const mockedLoad = loadDashboard as jest.MockedFunction<typeof loadDashboard>;
const mockedActive = loadActiveWorkout as jest.MockedFunction<typeof loadActiveWorkout>;
const mockedProgress = loadLearnProgress as jest.MockedFunction<typeof loadLearnProgress>;
const mockedSave = saveLearnProgress as jest.MockedFunction<typeof saveLearnProgress>;

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

function textContents(renderer: ReactTestRenderer): string[] {
  return renderer.root
    .findAllByType(Text)
    .map((t) => flatten(t.props.children))
    .filter((s) => s.length > 0);
}

function pressableByTestID(renderer: ReactTestRenderer, testID: string) {
  return renderer.root
    .findAll((node) => node.props?.testID === testID && typeof node.props?.onPress === 'function')
    .find((node) => node.props?.accessibilityRole === 'button');
}

async function renderHome(routes?: Route[]): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <Navigator>
        {(route) => {
          routes?.push(route);
          return route.name === 'home' ? (
            <HomeScreen />
          ) : (
            <Text testID={`route-${route.name}`} />
          );
        }}
      </Navigator>,
    );
  });
  await act(async () => {});
  return renderer;
}

beforeEach(() => {
  mockedLoad.mockReset();
  mockedLoad.mockResolvedValue(EMPTY_DASHBOARD);
  mockedActive.mockReset();
  mockedActive.mockResolvedValue(null);
  mockedProgress.mockReset();
  mockedProgress.mockResolvedValue({ version: 1, welcomeDone: false, completed: [] });
  mockedSave.mockReset();
  mockedSave.mockResolvedValue(undefined);
});

describe('Home first-run welcome', () => {
  it('shows the welcome instead of the dashboard on first launch', async () => {
    const renderer = await renderHome();
    const texts = textContents(renderer);
    expect(texts).toContain(strings.learn.welcome.title);
    expect(texts).toContain(strings.learn.welcome.learn);
    expect(texts).toContain(strings.learn.welcome.known);
    expect(renderer.root.findAll((n) => n.props?.testID === 'home-header')).toHaveLength(0);
  });

  it('skips to the app and records welcomeDone', async () => {
    const renderer = await renderHome();
    await act(async () => {
      pressableByTestID(renderer, 'welcome-known')!.props.onPress();
    });
    await act(async () => {});

    expect(mockedSave).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ welcomeDone: true, completed: [] }),
    );
    expect(textContents(renderer)).not.toContain(strings.learn.welcome.title);
    expect(renderer.root.findAll((n) => n.props?.testID === 'home-header').length).toBeGreaterThanOrEqual(1);
  });

  it('opens the learn center from the learn path and records welcomeDone', async () => {
    const routes: Route[] = [];
    const renderer = await renderHome(routes);
    await act(async () => {
      pressableByTestID(renderer, 'welcome-learn')!.props.onPress();
    });
    await act(async () => {});

    expect(mockedSave).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ welcomeDone: true }),
    );
    expect(routes).toContainEqual(expect.objectContaining({ name: 'learn' }));
  });

  it('leaves the welcome via hardware back and records welcomeDone', async () => {
    const listeners: Array<() => boolean | null | undefined> = [];
    const spy = jest.spyOn(BackHandler, 'addEventListener').mockImplementation(((
      _event: string,
      cb: () => boolean | null | undefined,
    ) => {
      listeners.push(cb);
      return { remove: jest.fn() } as never;
    }) as never);

    const renderer = await renderHome();
    expect(listeners.length).toBeGreaterThan(0);
    let handled = false;
    await act(async () => {
      handled = listeners.some((fn) => fn() === true);
    });
    await act(async () => {});

    expect(handled).toBe(true);
    expect(mockedSave).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ welcomeDone: true }),
    );
    expect(textContents(renderer)).not.toContain(strings.learn.welcome.title);
    spy.mockRestore();
  });

  it('does not show the welcome once it was completed', async () => {
    mockedProgress.mockResolvedValue({ version: 1, welcomeDone: true, completed: [] });
    const renderer = await renderHome();
    expect(textContents(renderer)).not.toContain(strings.learn.welcome.title);
    expect(renderer.root.findAll((n) => n.props?.testID === 'home-header').length).toBeGreaterThanOrEqual(1);
  });

  it('fails open when progress cannot be read (never traps the athlete)', async () => {
    mockedProgress.mockRejectedValue(new Error('db unavailable'));
    const renderer = await renderHome();
    expect(textContents(renderer)).not.toContain(strings.learn.welcome.title);
    expect(renderer.root.findAll((n) => n.props?.testID === 'home-header').length).toBeGreaterThanOrEqual(1);
  });
});
