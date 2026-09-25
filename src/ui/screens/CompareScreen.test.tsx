import React from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Navigator } from '../navigation';
import { CompareScreen } from './CompareScreen';
import { loadAnalyticsSnapshot, type AnalyticsSnapshot } from '../../data/analytics';
import { strings } from '../../constants/strings';

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

function session(
  sessionId: string,
  timestampMs: number,
  exercises: AnalyticsSnapshot['sessions'][number]['exercises'],
): AnalyticsSnapshot['sessions'][number] {
  return {
    sessionId,
    name: `Session ${sessionId}`,
    timestampMs,
    startedAt: timestampMs - 3_600_000,
    endedAt: timestampMs,
    exercises,
  };
}

async function renderCompareScreen(sessionId: string, snapshot: AnalyticsSnapshot): Promise<ReactTestRenderer> {
  mockedLoad.mockResolvedValue(snapshot);
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<Navigator>{() => <CompareScreen sessionId={sessionId} />}</Navigator>);
  });
  await act(async () => {});
  return renderer;
}

describe('CompareScreen (Phase 2J §13)', () => {
  it('shows an empty state when the selected session is the first ever', async () => {
    const snapshot: AnalyticsSnapshot = {
      exercises: [],
      sessions: [
        session('first', Date.now(), [
          {
            exerciseName: 'Bench Press',
            contributions: null,
            sets: [{ weightGrams: 60_000, reps: 5, durationMs: null, isCompleted: true }],
          },
        ]),
      ],
    };
    const renderer = await renderCompareScreen('first', snapshot);
    const texts = textsOf(renderer);
    expect(texts).toContain(strings.compare.noBaseline);
    expect(texts).toContain(strings.compare.noBaselineBody);
  });

  it('renders totals and per-exercise deltas against the previous session', async () => {
    const snapshot: AnalyticsSnapshot = {
      exercises: [],
      sessions: [
        session('older', Date.now() - 86_400_000, [
          {
            exerciseName: 'Bench Press',
            contributions: null,
            sets: [{ weightGrams: 60_000, reps: 5, durationMs: null, isCompleted: true }],
          },
        ]),
        session('selected', Date.now(), [
          {
            exerciseName: 'Bench Press',
            contributions: null,
            sets: [{ weightGrams: 70_000, reps: 5, durationMs: null, isCompleted: true }],
          },
        ]),
      ],
    };
    const renderer = await renderCompareScreen('selected', snapshot);
    const joined = textsOf(renderer).join(' ');
    expect(joined).toContain(strings.compare.totals);
    expect(joined).toContain(strings.compare.volume);
    expect(joined).toContain('300 kg·reps'); // previous volume
    expect(joined).toContain('350 kg·reps'); // selected volume
    expect(joined).toContain('Bench Press');
    expect(joined).toContain(strings.compare.bestWeight);
    expect(joined).toContain('60 kg'); // previous best
    expect(joined).toContain('70 kg'); // selected best
    expect(joined).toContain('+16.7%'); // 350k vs 300k gram-reps
  });

  it('flags exercises that exist on only one side', async () => {
    const snapshot: AnalyticsSnapshot = {
      exercises: [],
      sessions: [
        session('older', Date.now() - 86_400_000, [
          {
            exerciseName: 'Bench Press',
            contributions: null,
            sets: [{ weightGrams: 60_000, reps: 5, durationMs: null, isCompleted: true }],
          },
        ]),
        session('selected', Date.now(), [
          {
            exerciseName: 'Row',
            contributions: null,
            sets: [{ durationMs: 60_000, weightGrams: null, reps: null, isCompleted: true }],
          },
        ]),
      ],
    };
    const renderer = await renderCompareScreen('selected', snapshot);
    const joined = textsOf(renderer).join(' ');
    expect(joined).toContain(strings.compare.onlyPrevious);
    expect(joined).toContain(strings.compare.onlySelected);
    expect(joined).not.toContain('+');
  });

  it('shows an error when the selected session no longer exists', async () => {
    const renderer = await renderCompareScreen('ghost', { exercises: [], sessions: [] });
    expect(textsOf(renderer).join(' ')).toContain(strings.history.detailMissing);
  });
});
