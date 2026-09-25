import React from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Navigator } from '../navigation';
import { LoadScreen } from './LoadScreen';
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

const BENCH_CONTRIBUTIONS = [
  ['chest', 6000],
  ['triceps', 2500],
  ['front_delts', 1500],
] as const;

function daysAgoAtNoon(days: number): number {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(12, 0, 0, 0);
  return d.getTime();
}

/** Current 7d: one bench set (60 kg × 5 = 300000 gram-reps). Previous 7d: 50 kg × 3 = 150000. */
function trendSnapshot(): AnalyticsSnapshot {
  return {
    exercises: [],
    sessions: [
      {
        sessionId: 's-current',
        name: 'Current week',
        timestampMs: Date.now(),
        startedAt: Date.now() - 3600_000,
        endedAt: Date.now(),
        exercises: [
          {
            exerciseName: 'Bench Press',
            contributions: [...BENCH_CONTRIBUTIONS],
            sets: [{ weightGrams: 60000, reps: 5, durationMs: null, isCompleted: true }],
          },
        ],
      },
      {
        sessionId: 's-previous',
        name: 'Previous week',
        timestampMs: daysAgoAtNoon(10),
        startedAt: daysAgoAtNoon(10) - 3600_000,
        endedAt: daysAgoAtNoon(10),
        exercises: [
          {
            exerciseName: 'Bench Press',
            contributions: [...BENCH_CONTRIBUTIONS],
            sets: [{ weightGrams: 50000, reps: 3, durationMs: null, isCompleted: true }],
          },
        ],
      },
    ],
  };
}

async function renderLoadScreen(snapshot: AnalyticsSnapshot): Promise<ReactTestRenderer> {
  mockedLoad.mockResolvedValue(snapshot);
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<Navigator>{() => <LoadScreen />}</Navigator>);
  });
  await act(async () => {});
  return renderer;
}

describe('LoadScreen trends (Phase 2F)', () => {
  it('renders aggregate card and 7d/28d trend comparison cards', async () => {
    const renderer = await renderLoadScreen(trendSnapshot());
    const texts = textsOf(renderer);
    expect(texts).toContain(strings.load.title);
    expect(texts).toContain(strings.load.trends.section);
    expect(texts).toContain(strings.load.trends.current7);
    expect(texts).toContain(strings.load.trends.current28);
    expect(texts.some((t) => t.includes(strings.load.trends.previous7))).toBe(true);
    expect(texts.some((t) => t.includes(strings.load.trends.previous28))).toBe(true);
    // 300000 vs 150000 gram-reps in the 7d windows → +100%.
    expect(texts).toContain(`${strings.load.trends.change}: +100%`);
    // Previous 28d window (days -55..-28) has no sessions → neutral label.
    expect(texts.some((t) => t.includes(strings.load.trends.noPrevious))).toBe(true);
  });

  it('keeps the existing aggregate card semantics', async () => {
    const renderer = await renderLoadScreen(trendSnapshot());
    const texts = textsOf(renderer);
    expect(texts.some((t) => t.startsWith(strings.load.completedSets))).toBe(true);
    // Default range = 7d: only the current-week session (300 kg·reps).
    expect(texts).toContain(`300 ${strings.load.kgReps}`);
  });

  it('shows the neutral empty state without crashing on no sessions', async () => {
    const renderer = await renderLoadScreen({ sessions: [], exercises: [] });
    const texts = textsOf(renderer);
    expect(texts).toContain(strings.load.noData);
    expect(texts.some((t) => t.includes(strings.load.trends.noPrevious))).toBe(true);
  });

  it('renders the descriptive 7d/28d load ratio when a baseline exists', async () => {
    const renderer = await renderLoadScreen({
      exercises: [],
      sessions: [
        {
          sessionId: 's-current',
          name: 'Current week',
          timestampMs: Date.now(),
          startedAt: Date.now() - 3600_000,
          endedAt: Date.now(),
          exercises: [
            {
              exerciseName: 'Bench Press',
              contributions: [...BENCH_CONTRIBUTIONS],
              sets: [{ weightGrams: 60000, reps: 5, durationMs: null, isCompleted: true }],
            },
          ],
        },
        {
          sessionId: 's-baseline',
          name: 'Baseline week',
          timestampMs: daysAgoAtNoon(35),
          startedAt: daysAgoAtNoon(35) - 3600_000,
          endedAt: daysAgoAtNoon(35),
          exercises: [
            {
              exerciseName: 'Bench Press',
              contributions: [...BENCH_CONTRIBUTIONS],
              sets: [{ weightGrams: 100000, reps: 8, durationMs: null, isCompleted: true }],
            },
          ],
        },
      ],
    });
    const texts = textsOf(renderer);
    expect(texts).toContain(strings.load.ratio.label);
    // Acute 300000 gram-reps; baseline 800000 ÷ 4 = 200000 → ratio 1.50.
    expect(texts).toContain('1.50');
    expect(texts.some((t) => t.includes(strings.load.ratio.baselineWeek))).toBe(true);
    expect(texts.join(' ')).not.toContain(strings.load.ratio.noBaseline);
  });

  it('shows the insufficient-baseline state instead of a ratio value', async () => {
    const renderer = await renderLoadScreen(trendSnapshot());
    const texts = textsOf(renderer);
    expect(texts).toContain(strings.load.ratio.label);
    expect(texts.some((t) => t.includes(strings.load.ratio.noBaseline))).toBe(true);
    expect(texts.some((t) => /^\d+\.\d\d$/.test(t))).toBe(false);
  });
});
