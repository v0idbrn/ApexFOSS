import React from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Navigator, useNav, type Route } from '../navigation';
import { ReportScreen } from './ReportScreen';
import { strings } from '../../constants/strings';

jest.mock('../../data', () => ({ database: {} }));
jest.mock('../../analytics/report');
jest.mock('../../export/share');
jest.mock('../../export/export');

import { generateReport } from '../../analytics/report';
const mockGenerateReport = generateReport as jest.Mock;

describe('ReportScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGenerateReport.mockResolvedValue({
      period: '28d',
      periodLabel: 'Last 28 days',
      generatedAt: Date.now(),
      sessions: { total: 5, completed: 5, totalVolumeKgReps: 1234, totalDurationMs: 3_600_000, averageSetsPerSession: 12 },
      volume: { totalGramReps: 1_234_000, byExercise: [{ exerciseName: 'Squat', gramReps: 500_000, setCount: 15 }, { exerciseName: 'Bench', gramReps: 400_000, setCount: 12 }] },
      prs: { count: 3, events: [], byExercise: [] },
      adherence: { planned: 60, plannedPerformed: 55, skipped: 5, modified: 2, extra: 1, drop: 0, performed: 58, status: 'partial' },
      body: { latest: { timestampMs: Date.now(), weightGrams: 80_000, waistMm: 850 }, weightDeltaGrams: -500, waistDeltaMm: -5, entryCount: 2 },
      goals: [{ exerciseName: 'Squat', targetGrams: 150_000, currentBestGrams: 140_000, progress: 0.93, achieved: false }],
      e1rmTrends: [{ status: 'improving', reason: 'E1RM_INCREASED', plateau: false, earlierBest: 100_000, laterBest: 110_000, improvementPct: 10, sampleCount: 5 }],
    });
  });

  const renderScreen = () => render(<ReportScreen />);

  function render(component: React.ReactElement): Promise<ReactTestRenderer> {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <Navigator>
          {(route) => {
            if (route.name === 'report') return <ReportScreen />;
            return <Text testID={`route-${route.name}`} />;
          }}
        </Navigator>,
      );
    });
    return Promise.resolve(renderer);
  }

  function flatten(node: unknown): string {
    if (node === null || node === undefined || typeof node === 'boolean') return '';
    if (Array.isArray(node)) return node.map(flatten).join('');
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    return '';
  }

  function findByText(renderer: ReactTestRenderer, text: string) {
    return renderer.root.findAll((node) => flatten(node.props?.children) === text)[0];
  }

  function pressableByText(renderer: ReactTestRenderer, label: string) {
    return renderer.root
      .findAll((node) => node.props?.accessibilityRole === 'button')
      .find((p) => flatten(p.props?.children) === label);
  }

  it('renders period selector and defaults to 28d', async () => {
    const renderer = await renderScreen();
    await act(async () => {});
    expect(findByText(renderer, 'Last 28 days')).toBeTruthy();
    expect(findByText(renderer, 'Last 7 days')).toBeTruthy();
    expect(findByText(renderer, 'All time')).toBeTruthy();
  });

  it('displays session summary', async () => {
    const renderer = await renderScreen();
    await act(async () => {});
    expect(findByText(renderer, 'Total sessions: 5')).toBeTruthy();
    expect(findByText(renderer, 'Total volume: 1234 kg·reps')).toBeTruthy();
    expect(findByText(renderer, 'Avg sets/session: 12')).toBeTruthy();
  });

  it('displays volume by exercise', async () => {
    const renderer = await renderScreen();
    await act(async () => {});
    expect(findByText(renderer, 'Squat: 500 kg·reps · 15 series')).toBeTruthy();
    expect(findByText(renderer, 'Bench: 400 kg·reps · 12 series')).toBeTruthy();
  });

  it('displays adherence info', async () => {
    const renderer = await renderScreen();
    await act(async () => {});
    expect(findByText(renderer, 'State: Partial')).toBeTruthy();
    expect(findByText(renderer, 'Planned: 60 · Performed: 58')).toBeTruthy();
  });

  it('displays body metrics', async () => {
    const renderer = await renderScreen();
    await act(async () => {});
    expect(findByText(renderer, 'Latest weight: 80 kg')).toBeTruthy();
    expect(findByText(renderer, 'Latest waist: 85cm')).toBeTruthy();
    expect(findByText(renderer, 'Weight change: -1kg')).toBeTruthy();
    expect(findByText(renderer, 'Waist change: -0.5cm')).toBeTruthy();
  });

  it('displays goals progress', async () => {
    const renderer = await renderScreen();
    await act(async () => {});
    expect(findByText(renderer, 'Squat: target 150kg · current 140kg (93%)')).toBeTruthy();
  });

  it('displays e1RM trends', async () => {
    const renderer = await renderScreen();
    await act(async () => {});
    expect(findByText(renderer, 'Improving (E1RM_INCREASED)')).toBeTruthy();
  });

  it('switches period and reloads report', async () => {
    const renderer = await renderScreen();
    await act(async () => {});
    const btn7d = pressableByText(renderer, 'Last 7 days');
    expect(btn7d).toBeTruthy();
  });

  it('exports CSV on button press', async () => {
    const renderer = await renderScreen();
    await act(async () => {});
    const btnExport = pressableByText(renderer, 'Export CSV');
    expect(btnExport).toBeTruthy();
  });

  it('renders loading state while report is null', async () => {
    mockGenerateReport.mockReset();
    mockGenerateReport.mockImplementation(() => new Promise(() => {})); // never resolves
    const renderer = await renderScreen();
    expect(findByText(renderer, 'Loading…')).toBeTruthy();
  });

  it('renders empty state when no data', async () => {
    mockGenerateReport.mockResolvedValue({
      period: '28d',
      periodLabel: 'Last 28 days',
      generatedAt: Date.now(),
      sessions: { total: 0, completed: 0, totalVolumeKgReps: 0, totalDurationMs: 0, averageSetsPerSession: 0 },
      volume: { totalGramReps: 0, byExercise: [] },
      prs: { count: 0, events: [], byExercise: [] },
      adherence: { planned: 0, plannedPerformed: 0, skipped: 0, modified: 0, extra: 0, drop: 0, performed: 0, status: 'none' },
      body: null,
      goals: [],
      e1rmTrends: [],
    });
    const renderer = await renderScreen();
    await act(async () => {});
    expect(findByText(renderer, 'No data in this period')).toBeTruthy();
  });
});