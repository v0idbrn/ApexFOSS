import React from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Navigator, useNav } from '../navigation';
import { RecordsScreen } from './RecordsScreen';
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

function snapshotWith(exercises: AnalyticsSnapshot['sessions']): AnalyticsSnapshot {
  return { exercises: [], sessions: exercises };
}

function benchSession(): AnalyticsSnapshot['sessions'][number] {
  return {
    sessionId: 's1',
    name: 'Day',
    timestampMs: Date.now(),
    startedAt: Date.now() - 3600_000,
    endedAt: Date.now(),
    exercises: [
      {
        exerciseName: 'Bench Press',
        contributions: null,
        sets: [{ weightGrams: 80_000, reps: 3, durationMs: null, isCompleted: true }],
      },
    ],
  };
}

async function renderRecordsScreen(snapshot: AnalyticsSnapshot): Promise<ReactTestRenderer> {
  mockedLoad.mockResolvedValue(snapshot);
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<Navigator>{() => <RecordsScreen />}</Navigator>);
  });
  await act(async () => {});
  return renderer;
}

function TabProbe() {
  const { tab } = useNav();
  return <Text testID="tab-probe">{tab}</Text>;
}

/** Renders the screen on the home route with a live tab probe beside it. */
async function renderRecordsWithTabProbe(snapshot: AnalyticsSnapshot): Promise<ReactTestRenderer> {
  mockedLoad.mockResolvedValue(snapshot);
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <Navigator>
        {(route) => (
          <>
            {route.name === 'home' ? <RecordsScreen /> : null}
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

describe('RecordsScreen (Phase 2J §12)', () => {
  it('shows an empty state when there are no records', async () => {
    const renderer = await renderRecordsScreen(snapshotWith([]));
    const texts = textsOf(renderer);
    expect(texts).toContain(strings.records.emptyTitle);
    expect(texts).toContain(strings.records.emptyBody);
  });

  it('renders best weight, reps and estimated 1RM for an exercise', async () => {
    const renderer = await renderRecordsScreen(snapshotWith([benchSession()]));
    const texts = textsOf(renderer);
    expect(texts).toContain('Bench Press');
    expect(texts).toContain(strings.records.weight);
    expect(texts).toContain(`80 ${strings.records.kg}`); // best weight
    expect(texts).toContain(strings.records.reps);
    expect(texts).toContain('3');
    expect(texts).toContain(strings.records.est1rm);
    expect(texts).toContain(`88 ${strings.records.kg}`); // Epley: 80 × (1 + 3/30)
    expect(texts).toContain(strings.records.estimateBadge);
    expect(texts).toContain(strings.records.estimateHint);
  });

  it('lists exercises alphabetically', async () => {
    const squat = benchSession();
    squat.sessionId = 's2';
    squat.exercises = [
      {
        exerciseName: 'Squat',
        contributions: null,
        sets: [{ weightGrams: 100_000, reps: 5, durationMs: null, isCompleted: true }],
      },
    ];
    const renderer = await renderRecordsScreen(snapshotWith([squat, benchSession()]));
    const texts = textsOf(renderer);
    expect(texts.indexOf('Bench Press')).toBeLessThan(texts.indexOf('Squat'));
  });

  it('toggles record history showing previous values', async () => {
    const older = benchSession();
    older.timestampMs = Date.now() - 86_400_000;
    older.startedAt = older.timestampMs - 3600_000;
    const newer = benchSession();
    newer.exercises[0].sets = [{ weightGrams: 90_000, reps: 3, durationMs: null, isCompleted: true }];
    const renderer = await renderRecordsScreen(snapshotWith([older, newer]));

    expect(textsOf(renderer)).not.toContain(strings.records.history);
    // Locate the header pressable by walking up from its label text — the
    // Pressable identity differs across module instances in this setup.
    const label = renderer.root
      .findAll((n) => typeof n.props?.children === 'string' && n.props.children === strings.records.showHistory)
      .pop();
    expect(label).toBeDefined();
    let toggle = label!;
    while (toggle && typeof toggle.props.onPress !== 'function') toggle = toggle.parent!;
    expect(toggle).toBeDefined();
    expect(typeof toggle.props.onPress).toBe('function');
    await act(async () => {
      toggle.props.onPress();
    });
    const texts = textsOf(renderer);
    expect(texts).toContain(strings.records.history);
    expect(texts.join(' ')).toContain(strings.records.previously);
    expect(texts).toContain(strings.records.hideHistory);
  });

  it('shows an error state when the snapshot fails', async () => {
    mockedLoad.mockRejectedValueOnce(new Error('db down'));
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<Navigator>{() => <RecordsScreen />}</Navigator>);
    });
    await act(async () => {});
    expect(textsOf(renderer).join(' ')).toContain('db down');
  });
});

describe('RecordsScreen empty state (Phase 2L Stage H)', () => {
  it('offers a start-workout action that switches to the train tab', async () => {
    const renderer = await renderRecordsWithTabProbe(snapshotWith([]));
    const empty = renderer.root
      .findAllByType(EmptyState)
      .find((node) => node.props.title === strings.records.emptyTitle);
    expect(empty).toBeDefined();
    expect(empty!.props.message).toBe(strings.records.emptyBody);
    expect(empty!.props.actionLabel).toBe(strings.home.startWorkout);
    expect(typeof empty!.props.onAction).toBe('function');
    expect(tabOf(renderer)).toBe('home');

    await act(async () => {
      empty!.props.onAction();
    });

    expect(tabOf(renderer)).toBe('train');
  });
});
