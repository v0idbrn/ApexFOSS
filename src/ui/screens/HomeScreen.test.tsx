import React from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Navigator } from '../navigation';
import { HomeScreen } from './HomeScreen';
import { EmptyState } from '../components';
import { strings } from '../../constants/strings';

jest.mock('../../data', () => ({ database: {} }));
jest.mock('../../workout/runner', () => ({
  loadActiveWorkout: jest.fn().mockResolvedValue(null),
}));

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
