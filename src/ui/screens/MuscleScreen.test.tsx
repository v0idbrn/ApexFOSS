import React from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Navigator, useNav } from '../navigation';
import { MuscleScreen } from './MuscleScreen';
import { loadAnalyticsSnapshot, type AnalyticsSnapshot } from '../../data/analytics';
import { strings } from '../../constants/strings';
import { EmptyState } from '../components';

jest.mock('../../data', () => ({ database: {} }));
jest.mock('../../data/analytics', () => ({
  loadAnalyticsSnapshot: jest.fn(),
}));

const mockedLoad = loadAnalyticsSnapshot as jest.MockedFunction<typeof loadAnalyticsSnapshot>;

function flatten(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(flatten).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return '';
}

function textsOf(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByType(Text).map((node) => flatten(node.props.children));
}

const BENCH_CONTRIBUTIONS = [
  ['chest', 6000],
  ['triceps', 2500],
  ['front_delts', 1500],
] as const;

function snapshotWith(sessionCount: number, exercises: AnalyticsSnapshot['sessions'][number]['exercises']): AnalyticsSnapshot {
  if (sessionCount === 0) return { sessions: [], exercises: [] };
  return {
    exercises: [],
    sessions: [
      {
        sessionId: 'session-1',
        name: 'Push day',
        timestampMs: Date.now(),
        startedAt: Date.now() - 3600_000,
        endedAt: Date.now(),
        exercises,
      },
    ],
  };
}

async function renderMuscleScreen(snapshot: AnalyticsSnapshot): Promise<ReactTestRenderer> {
  mockedLoad.mockResolvedValue(snapshot);
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <Navigator>{() => <MuscleScreen />}</Navigator>,
    );
  });
  await act(async () => {});
  return renderer;
}

function TabProbe() {
  const { tab } = useNav();
  return <Text testID="tab-probe">{tab}</Text>;
}

async function renderMuscleWithTabProbe(snapshot: AnalyticsSnapshot): Promise<ReactTestRenderer> {
  mockedLoad.mockResolvedValue(snapshot);
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <Navigator>
        {(route) => (
          <>
            {route.name === 'home' ? <MuscleScreen /> : null}
            <TabProbe />
          </>
        )}
      </Navigator>,
    );
  });
  await act(async () => {});
  return renderer;
}

function tabOf(renderer: ReactTestRenderer): string {
  return flatten(renderer.root.findByProps({ testID: 'tab-probe' }).props.children);
}

/** Pressable instance carrying onPress (the host view drops it). */
function pressableByTestID(renderer: ReactTestRenderer, testID: string) {
  const node = renderer.root
    .findAll((n) => n.props?.testID === testID && typeof n.props?.onPress === 'function')
    .pop();
  expect(node).toBeDefined();
  return node!;
}

describe('MuscleScreen UI', () => {
  it('renders mapped region grid with load and share', async () => {
    const renderer = await renderMuscleScreen(
      snapshotWith(1, [
        {
          exerciseName: 'Bench Press',
          contributions: [...BENCH_CONTRIBUTIONS],
          sets: [{ weightGrams: 60000, reps: 5, durationMs: null, isCompleted: true }],
        },
      ]),
    );
    const texts = textsOf(renderer);
    expect(texts).toContain(strings.muscles.title);
    expect(texts).toContain(strings.muscles.groups.chest);
    expect(texts).toContain(strings.muscles.groups.triceps);
    // Chest share = 60% of 300000 gram-reps → 180 kg·reps.
    expect(texts.some((t) => t.includes('180 kg·reps'))).toBe(true);
    expect(texts.some((t) => t.includes('60.0%'))).toBe(true);
    expect(texts.join(' ')).not.toContain(strings.muscles.noData);
  });

  it('shows unmapped note for exercises without a mapping', async () => {
    const renderer = await renderMuscleScreen(
      snapshotWith(1, [
        {
          exerciseName: 'Custom Lift',
          contributions: null,
          sets: [{ weightGrams: 40000, reps: 5, durationMs: null, isCompleted: true }],
        },
      ]),
    );
    const texts = textsOf(renderer);
    expect(texts.some((t) => t.includes(`${strings.muscles.unmappedFor} 1 ${strings.muscles.exerciseOne}`))).toBe(
      true,
    );
    expect(texts).toContain(strings.muscles.noData);
  });

  it('shows the neutral empty state when there is no resistance load', async () => {
    const renderer = await renderMuscleScreen(snapshotWith(0, []));
    const texts = textsOf(renderer);
    expect(texts).toContain(strings.muscles.noData);
    expect(texts).toContain(strings.muscles.mappedLoad);
  });

  it('opens region detail on tap and closes on second tap', async () => {
    const renderer = await renderMuscleScreen(
      snapshotWith(1, [
        {
          exerciseName: 'Bench Press',
          contributions: [...BENCH_CONTRIBUTIONS],
          sets: [{ weightGrams: 60000, reps: 5, durationMs: null, isCompleted: true }],
        },
      ]),
    );
    expect(textsOf(renderer)).not.toContain(strings.muscles.contributing);

    const chest = renderer.root.findByProps({ accessibilityLabel: strings.muscles.groups.chest });
    await act(async () => {
      chest.props.onPress();
    });
    let texts = textsOf(renderer);
    expect(texts).toContain(strings.muscles.contributing);
    expect(texts).toContain('Bench Press');

    await act(async () => {
      chest.props.onPress();
    });
    texts = textsOf(renderer);
    expect(texts).not.toContain(strings.muscles.contributing);
  });
});

describe('MuscleScreen discoverability and a11y (Phase 2L Stage H)', () => {
  const benchSnapshot = (): AnalyticsSnapshot =>
    snapshotWith(1, [
      {
        exerciseName: 'Bench Press',
        contributions: [...BENCH_CONTRIBUTIONS],
        sets: [{ weightGrams: 60000, reps: 5, durationMs: null, isCompleted: true }],
      },
    ]);

  it('offers a start-workout action on the empty state that switches to the train tab', async () => {
    const renderer = await renderMuscleWithTabProbe(snapshotWith(0, []));
    const empty = renderer.root
      .findAllByType(EmptyState)
      .find((node) => node.props.message === strings.muscles.noData);
    expect(empty).toBeDefined();
    expect(empty!.props.actionLabel).toBe(strings.home.startWorkout);
    expect(typeof empty!.props.onAction).toBe('function');
    expect(tabOf(renderer)).toBe('home');

    await act(async () => {
      empty!.props.onAction();
    });

    expect(tabOf(renderer)).toBe('train');
  });

  it('marks the active range and the selected region via accessibilityState.selected', async () => {
    const renderer = await renderMuscleScreen(benchSnapshot());

    const r7 = pressableByTestID(renderer, 'muscles-range-7d');
    const r28 = pressableByTestID(renderer, 'muscles-range-28d');
    expect(r7.props.accessibilityRole).toBe('button');
    expect(r7.props.accessibilityLabel).toBe(strings.load.last7);
    expect(r7.props.accessibilityState).toEqual({ selected: true });
    expect(r28.props.accessibilityLabel).toBe(strings.load.last28);
    expect(r28.props.accessibilityState).toEqual({ selected: false });

    const chest = pressableByTestID(renderer, 'muscles-region-chest');
    expect(chest.props.accessibilityRole).toBe('button');
    expect(chest.props.accessibilityLabel).toBe(strings.muscles.groups.chest);
    expect(chest.props.accessibilityState).toEqual({ selected: false });

    await act(async () => {
      chest.props.onPress();
    });
    expect(pressableByTestID(renderer, 'muscles-region-chest').props.accessibilityState).toEqual({ selected: true });

    await act(async () => {
      pressableByTestID(renderer, 'muscles-range-28d').props.onPress();
    });
    expect(pressableByTestID(renderer, 'muscles-range-28d').props.accessibilityState).toEqual({ selected: true });
    expect(pressableByTestID(renderer, 'muscles-range-7d').props.accessibilityState).toEqual({ selected: false });
  });
});
