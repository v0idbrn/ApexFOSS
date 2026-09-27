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
  type ProgressionOverview,
} from '../../data/progression';

jest.mock('../../data', () => ({ database: {} }));
jest.mock('../../data/dashboard', () => ({ loadDashboard: jest.fn() }));
jest.mock('../../data/progression', () => ({
  loadProgressionSnapshot: jest.fn(),
  summarizeProgression: jest.fn(),
  analyzeStepEvidence: jest.fn(),
  progressionInputFor: jest.fn(),
  latestPrescriptionFor: jest.fn(),
}));

const mockedDashboard = loadDashboard as jest.MockedFunction<typeof loadDashboard>;
const mockedLoadSnap = loadProgressionSnapshot as jest.MockedFunction<typeof loadProgressionSnapshot>;
const mockedSummarize = summarizeProgression as jest.MockedFunction<typeof summarizeProgression>;

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
    for (const testID of ['progress-week-sessions', 'progress-week-volume', 'progress-history', 'progress-records', 'progress-load', 'progress-muscles']) {
      expect({ testID, found: renderer.root.findAllByProps({ testID }).length > 0 }).toEqual({ testID, found: true });
    }
  });
});
