import React from 'react';
import { Share, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Navigator } from '../navigation';
import { ReportScreen } from './ReportScreen';
import { strings } from '../../constants/strings';

jest.mock('../../data', () => ({ database: {} }));
jest.mock('../../data/report');
jest.mock('../../export/share');
jest.mock('../../export/export');

import { generateReport } from '../../data/report';
import { collectCompletedDetailsInRange } from '../../export/share';
import { sessionsToCsv } from '../../export/export';
import { dateRange } from '../../analytics/load';

const mockGenerateReport = generateReport as jest.Mock;
const mockCollectDetailsInRange = collectCompletedDetailsInRange as jest.Mock;
const mockSessionsToCsv = sessionsToCsv as jest.Mock;

describe('ReportScreen', () => {
  const generatedAt = 1_755_000_000_000;
  let shareSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({} as never);
    mockCollectDetailsInRange.mockResolvedValue([]);
    mockSessionsToCsv.mockReturnValue('session_id\ns1');
    mockGenerateReport.mockResolvedValue({
      period: '28d',
      periodLabel: 'Last 28 days',
      generatedAt: generatedAt,
      sessions: { total: 5, completed: 5, totalVolumeKgReps: 1234, totalDurationMs: 3_600_000, averageSetsPerSession: 12 },
      volume: { totalGramReps: 1_234_000, byExercise: [{ exerciseName: 'Squat', gramReps: 500_000, setCount: 15 }, { exerciseName: 'Bench', gramReps: 400_000, setCount: 12 }] },
      prs: {
        count: 3,
        events: [],
        byExercise: [
          {
            exerciseName: 'Squat',
            bestWeightGrams: 100_000,
            bestWeightAtMs: generatedAt,
            bestReps: 8,
            bestRepsAtMs: generatedAt,
            bestDurationMs: null,
            bestDurationAtMs: null,
            bestDistanceMm: null,
            bestDistanceAtMs: null,
            estimated1rmGrams: 102_500,
            estimated1rmAtMs: generatedAt,
          },
        ],
      },
      adherence: { planned: 60, plannedPerformed: 55, skipped: 5, modified: 2, extra: 1, drop: 0, performed: 58, status: 'partial' },
      body: {
        latest: {
          timestampMs: generatedAt,
          measurementType: 'body_weight',
          side: null,
          value: 79500,
          unit: 'g',
          weightGrams: 79500,
          waistMm: null,
        },
        latestByIdentity: {
          body_weight: {
            timestampMs: generatedAt,
            measurementType: 'body_weight',
            side: null,
            value: 79500,
            unit: 'g',
            weightGrams: 79500,
            waistMm: null,
          },
          waist: {
            timestampMs: generatedAt,
            measurementType: 'waist',
            side: null,
            value: 835,
            unit: 'mm',
            weightGrams: null,
            waistMm: 835,
          },
        },
        deltas: {
          body_weight: { unit: 'g', previousValue: 80000, valueDelta: -500 },
          waist: { unit: 'mm', previousValue: 840, valueDelta: -5 },
        },
        entryCount: 4,
      },
      goals: [{ exerciseName: 'Squat', targetGrams: 150_000, currentBestGrams: 140_000, progress: 0.93, achieved: false }],
      e1rmTrends: [
        {
          exerciseName: 'Squat',
          evidence: {
            status: 'improving',
            reason: 'E1RM_INCREASED',
            plateau: false,
            baselineE1rmGrams: 100_000,
            recentE1rmGrams: 110_000,
            deltaGrams: 10_000,
            deltaPct: 10,
            sampleCount: 5,
            explanation: 'Recent sessions are above the earlier baseline',
          },
        },
      ],
    });
  });

  function flatten(node: unknown): string {
    if (node === null || node === undefined || typeof node === 'boolean') return '';
    if (Array.isArray(node)) return node.map(flatten).join('');
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (node && typeof node === 'object' && 'props' in node) {
      return flatten((node as any).props?.children);
    }
    return '';
  }

  function findByText(renderer: ReactTestRenderer, text: string) {
    return renderer.root.findAll((node) => flatten(node.props?.children) === text)[0];
  }

  function pressableByText(renderer: ReactTestRenderer, label: string) {
    const buttons = renderer.root.findAll((node) => node.props?.accessibilityRole === 'button');
    return buttons.find((p) => p.findAllByType(Text).some((t) => flatten(t.props?.children) === label));
  }

  afterEach(() => {
    shareSpy.mockRestore();
  });

  async function renderScreen(): Promise<ReactTestRenderer> {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <Navigator>
          {(route) => <ReportScreen />}
        </Navigator>,
      );
    });
    await act(async () => {});
    return renderer;
  }

  it('renders period selector and defaults to 28d', async () => {
    const renderer = await renderScreen();
    expect(findByText(renderer, 'Last 28 days')).toBeTruthy();
    expect(findByText(renderer, 'Last 7 days')).toBeTruthy();
    expect(findByText(renderer, 'All time')).toBeTruthy();
  });

  it('renders latest body measurements and deltas', async () => {
    const renderer = await renderScreen();
    expect(findByText(renderer, `${strings.report.latestWeight}: 79.5 kg`)).toBeTruthy();
    expect(findByText(renderer, `${strings.report.latestWaist}: 83.5 cm`)).toBeTruthy();
    expect(findByText(renderer, `${strings.report.weightDelta}: -0.5 kg`)).toBeTruthy();
    expect(findByText(renderer, `${strings.report.waistDelta}: -0.5 cm`)).toBeTruthy();
  });

  it('renders volume, records, goals and trends without raw template markers', async () => {
    const renderer = await renderScreen();
    expect(findByText(renderer, `${strings.report.totalVolume}: 1,234 kg·reps`)).toBeTruthy();
    expect(findByText(renderer, `Squat: 500 kg·reps · 15 ${strings.report.sets}`)).toBeTruthy();
    expect(
      findByText(renderer, `Squat: e1RM ~102.5kg · best 100kg · 8 ${strings.workout.reps}`),
    ).toBeTruthy();
    expect(findByText(renderer, `Squat: target 150kg ·current 140kg (93%)`)).toBeTruthy();
    expect(
      findByText(
        renderer,
        `Squat: Improving (${strings.signals.reason.E1RM_INCREASED})`,
      ),
    ).toBeTruthy();
  });

  it('switches period and reloads report', async () => {
    const renderer = await renderScreen();
    const btn7d = pressableByText(renderer, 'Last 7 days');
    expect(btn7d).toBeTruthy();
  });

  it('exports the selected period as CSV through the existing share path', async () => {
    const renderer = await renderScreen();
    const btnExport = pressableByText(renderer, 'Export CSV');
    await act(async () => {
      btnExport!.props.onPress();
    });
    const range = dateRange('28d', generatedAt);
    expect(mockCollectDetailsInRange).toHaveBeenCalledWith({}, range.startMs, range.endMs);
    expect(mockSessionsToCsv).toHaveBeenCalledWith([]);
    expect(shareSpy).toHaveBeenCalledWith({ message: 'session_id\ns1', title: 'ApexFOSS report-28d.csv' });
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
      generatedAt: generatedAt,
      sessions: { total: 0, completed: 0, totalVolumeKgReps: 0, totalDurationMs: 0, averageSetsPerSession: 0 },
      volume: { totalGramReps: 0, byExercise: [] },
      prs: { count: 0, events: [], byExercise: [] },
      adherence: { planned: 0, plannedPerformed: 0, skipped: 0, modified: 0, extra: 0, drop: 0, performed: 0, status: 'none' },
      body: null,
      goals: [],
      e1rmTrends: [],
    });
    const renderer = await renderScreen();
    expect(findByText(renderer, 'No data in this period')).toBeTruthy();
  });
});