import React from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Navigator, useNav, type Route } from '../navigation';
import { ProgressScreen } from './ProgressScreen';
import { strings } from '../../constants/strings';
import { loadDashboard, type DashboardData } from '../../data/dashboard';
import {
  loadProgressionSnapshot,
  summarizeProgression,
  summarizeTrends,
  type ProgressionOverview,
  type TrendOverview,
} from '../../data/progression';

jest.mock('../../data', () => ({ database: {} }));
jest.mock('../../data/dashboard', () => ({ loadDashboard: jest.fn() }));
jest.mock('../../data/progression', () => ({
  loadProgressionSnapshot: jest.fn(),
  summarizeProgression: jest.fn(),
  summarizeTrends: jest.fn(),
  analyzeStepEvidence: jest.fn(),
  progressionInputFor: jest.fn(),
  latestPrescriptionFor: jest.fn(),
}));

const mockedDashboard = loadDashboard as jest.MockedFunction<typeof loadDashboard>;
const mockedLoadSnap = loadProgressionSnapshot as jest.MockedFunction<typeof loadProgressionSnapshot>;
const mockedSummarize = summarizeProgression as jest.MockedFunction<typeof summarizeProgression>;
const mockedTrends = summarizeTrends as jest.MockedFunction<typeof summarizeTrends>;

function flatten(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(flatten).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return '';
}

function pressableByTestID(renderer: ReactTestRenderer, testID: string) {
  return renderer.root
    .findAll((node) => node.props?.testID === testID && typeof node.props?.onPress === 'function')
    .find((node) => node.props?.accessibilityRole === 'button');
}

const EMPTY_DASHBOARD: DashboardData = {
  recent: [],
  week: { sessionCount: 0, resistanceGramReps: 0, completedSetCount: 0, wallMs: 0 },
  daily: [],
  lastRoutine: null,
};

function overviewFixture(): ProgressionOverview {
  const mkEntry = (
    id: string,
    name: string,
    state: 'progress' | 'maintain' | 'insufficient_data',
    reason: 'REPS_RANGE_COMPLETED' | 'REPS_IN_RANGE' | 'INSUFFICIENT_HISTORY',
  ) => ({
    exercise: { id, name, category: 'push', equipment: 'barbell', metricFlags: 3 },
    evidence: {
      state,
      reason,
      explanation: 'test',
      comparableCount: 2,
      currentPrescription: { targetRepsMin: 8, targetRepsMax: 12, targetWeightGrams: 50000, targetRir: 2, tempo: null },
      atTargetWeight: true,
      repsVsRange: { achieved: 12, min: 8, max: 12 },
      weightIncrementSource: 'none' as const,
    },
  });
  return {
    progress: [mkEntry('ex1', 'Bench Press', 'progress', 'REPS_RANGE_COMPLETED')],
    maintain: [mkEntry('ex2', 'Squat', 'maintain', 'REPS_IN_RANGE')],
    insufficient: [mkEntry('ex3', 'Deadlift', 'insufficient_data', 'INSUFFICIENT_HISTORY')],
    analyzedCount: 3,
  };
}

function trendsFixture(): TrendOverview {
  const mk = (
    id: string,
    name: string,
    status: 'improving' | 'declining' | 'stable' | 'insufficient_data',
    reason: 'INSUFFICIENT_HISTORY' | 'E1RM_INCREASED' | 'E1RM_DECREASED' | 'E1RM_STABLE',
    plateau: boolean,
  ) => ({
    exercise: { id, name, category: 'push', equipment: 'barbell', metricFlags: 3 },
    evidence: {
      status,
      reason,
      plateau,
      baselineE1rmGrams: 60_000,
      recentE1rmGrams: 60_500,
      deltaGrams: 500,
      deltaPct: 0.8,
      sampleCount: 4,
      explanation: 'test',
    },
  });
  const stable = mk('ex1', 'Bench Press', 'stable', 'E1RM_STABLE', true);
  const insufficient = mk('ex3', 'Deadlift', 'insufficient_data', 'INSUFFICIENT_HISTORY', false);
  return { entries: [stable, insufficient], signals: [stable], analyzedCount: 2 };
}

/** The Navigator boots on Home; select the progress tab on mount. */
function GoToProgress() {
  const { selectTab } = useNav();
  React.useEffect(() => {
    selectTab('progress');
  }, [selectTab]);
  return null;
}

async function renderProgress(routes?: Route[]): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <Navigator>
        {(route) => {
          routes?.push(route);
          return (
            <>
              <GoToProgress />
              {route.name === 'progress' ? <ProgressScreen /> : <Text testID={`route-${route.name}`} />}
            </>
          );
        }}
      </Navigator>,
    );
  });
  await act(async () => {});
  return renderer;
}

beforeEach(() => {
  mockedDashboard.mockReset().mockResolvedValue(EMPTY_DASHBOARD);
  mockedLoadSnap.mockReset().mockResolvedValue({
    analytics: { sessions: [], exercises: [] },
    timestamps: new Map(),
    historicalPrescriptions: new Map(),
    equipmentItems: [],
  });
  mockedSummarize.mockReset().mockReturnValue({
    progress: [],
    maintain: [],
    insufficient: [],
    analyzedCount: 0,
  });
  mockedTrends.mockReset().mockReturnValue({ entries: [], signals: [], analyzedCount: 0 });
});

describe('Progress tab progression overview (Phase 3B)', () => {
  it('renders the three engine groups with one row per exercise', async () => {
    mockedSummarize.mockReturnValue(overviewFixture());
    const renderer = await renderProgress();
    expect(renderer.root.findAllByProps({ testID: 'progression-row-ex1' }).length).toBeGreaterThanOrEqual(1);
    expect(renderer.root.findAllByProps({ testID: 'progression-row-ex2' }).length).toBeGreaterThanOrEqual(1);
    expect(renderer.root.findAllByProps({ testID: 'progression-row-ex3' }).length).toBeGreaterThanOrEqual(1);
  });

  it('carries the engine reason as the row subtitle, never a raw reason code', async () => {
    mockedSummarize.mockReturnValue(overviewFixture());
    const renderer = await renderProgress();
    const texts = renderer.root.findAllByType(Text).map((t) => flatten(t.props.children));
    expect(texts).toContain(strings.progression.reason.REPS_RANGE_COMPLETED);
    expect(texts).not.toContain('REPS_RANGE_COMPLETED');
  });

  it('pushes the exercise editor when a progression row is opened', async () => {
    mockedSummarize.mockReturnValue(overviewFixture());
    const routes: Route[] = [];
    const renderer = await renderProgress(routes);
    const row = pressableByTestID(renderer, 'progression-row-ex1');
    expect(row).toBeDefined();
    await act(async () => {
      row!.props.onPress();
    });
    expect(routes).toContainEqual(expect.objectContaining({ name: 'exerciseEditor', exerciseId: 'ex1' }));
  });

  it('shows the explanatory empty state when nothing is analyzable', async () => {
    const renderer = await renderProgress();
    const texts = renderer.root.findAllByType(Text).map((t) => flatten(t.props.children));
    expect(texts).toContain(strings.progression.emptyTitle);
    expect(texts).toContain(strings.progression.emptyBody);
    expect(renderer.root.findAllByProps({ testID: 'progression-row-ex1' })).toHaveLength(0);
  });

  it('keeps the overview hidden (not crashing) when the snapshot fails', async () => {
    mockedLoadSnap.mockRejectedValue(new Error('db locked'));
    const renderer = await renderProgress();
    const texts = renderer.root.findAllByType(Text).map((t) => flatten(t.props.children));
    expect(texts).toContain(strings.progression.emptyTitle);
  });
});

describe('Progress tab regressions (Phase 2L)', () => {
  it('keeps week metrics and the analytics destination rows intact', async () => {
    mockedSummarize.mockReturnValue(overviewFixture());
    const renderer = await renderProgress();
    for (const testID of ['progress-week-sessions', 'progress-week-volume', 'progress-history', 'progress-records', 'progress-load', 'progress-muscles', 'progress-report']) {
      expect({ testID, found: renderer.root.findAllByProps({ testID }).length > 0 }).toEqual({ testID, found: true });
    }
  });
});

describe('Progress tab performance signals (Phase 3D)', () => {
  it('renders only gate-cleared signals with a localized reason and state', async () => {
    mockedTrends.mockReturnValue(trendsFixture());
    const renderer = await renderProgress();
    expect(renderer.root.findAllByProps({ testID: 'signal-row-ex1' }).length).toBeGreaterThanOrEqual(1);
    expect(renderer.root.findAllByProps({ testID: 'signal-row-ex3' })).toHaveLength(0);
    const texts = renderer.root.findAllByType(Text).map((t) => flatten(t.props.children));
    expect(texts).toContain(strings.signals.section);
    expect(texts).toContain(strings.signals.reason.E1RM_STABLE);
    expect(texts).toContain(strings.signals.state.stable);
    expect(texts).not.toContain('E1RM_STABLE');
  });

  it('renders no signal section when nothing cleared the sample gate', async () => {
    const renderer = await renderProgress();
    expect(renderer.root.findAllByProps({ testID: 'signal-row-ex1' })).toHaveLength(0);
    const texts = renderer.root.findAllByType(Text).map((t) => flatten(t.props.children));
    expect(texts).not.toContain(strings.signals.section);
  });

  it('pushes the exercise editor when a signal row is opened', async () => {
    mockedTrends.mockReturnValue(trendsFixture());
    const routes: Route[] = [];
    const renderer = await renderProgress(routes);
    const row = pressableByTestID(renderer, 'signal-row-ex1');
    expect(row).toBeDefined();
    await act(async () => {
      row!.props.onPress();
    });
    expect(routes).toContainEqual(expect.objectContaining({ name: 'exerciseEditor', exerciseId: 'ex1' }));
  });
});
