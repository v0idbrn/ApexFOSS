import React from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Navigator } from '../navigation';
import { TrainScreen } from './TrainScreen';
import { strings } from '../../constants/strings';
import { makeDbActions } from '../../data/actions';
import { loadDashboard } from '../../data/dashboard';
import { loadNextUp } from '../../data/scheduling';
import { loadActiveWorkout, startWorkoutSession } from '../../workout/runner';

jest.mock('../../data', () => ({ database: {} }));
jest.mock('../../data/actions', () => ({ makeDbActions: jest.fn() }));
jest.mock('../../data/dashboard', () => ({ loadDashboard: jest.fn() }));
jest.mock('../../data/scheduling', () => ({ loadNextUp: jest.fn() }));
jest.mock('../../workout/runner', () => ({ loadActiveWorkout: jest.fn(), startWorkoutSession: jest.fn() }));

const mockedMakeDbActions = makeDbActions as jest.MockedFunction<typeof makeDbActions>;
const mockedLoadDashboard = loadDashboard as jest.MockedFunction<typeof loadDashboard>;
const mockedLoadNextUp = loadNextUp as jest.MockedFunction<typeof loadNextUp>;
const mockedLoadActiveWorkout = loadActiveWorkout as jest.MockedFunction<typeof loadActiveWorkout>;
const mockedStartSession = startWorkoutSession as jest.MockedFunction<typeof startWorkoutSession>;

const NEXT_UP = {
  programId: 'p1',
  programName: 'Block A',
  routineId: 'r2',
  routineName: 'Day B',
  neverTrained: true,
  memberCount: 2,
};

function flatten(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(flatten).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return '';
}

function textsOf(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByType(Text).map((node) => flatten(node.props.children));
}

function nodeByTestId(renderer: ReactTestRenderer, testID: string) {
  const node = renderer.root.findAll((n) => n.props?.testID === testID)[0];
  expect(node).toBeDefined();
  return node!;
}

function setup(nextUp: typeof NEXT_UP | null) {
  mockedMakeDbActions.mockReturnValue({
    listRoutinesWithCounts: jest.fn().mockResolvedValue([]),
  } as unknown as ReturnType<typeof makeDbActions>);
  mockedLoadDashboard.mockResolvedValue({ recent: [] } as never);
  mockedLoadActiveWorkout.mockResolvedValue(null);
  mockedLoadNextUp.mockResolvedValue(nextUp);
  mockedStartSession.mockResolvedValue('sess-1');
}

async function renderScreen(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <Navigator>
        {(route) =>
          route.name === 'workout' ? (
            <Text testID="workout-route" />
          ) : route.name === 'programDetail' ? (
            <Text testID={`detail:${route.programId}`} />
          ) : (
            <TrainScreen />
          )
        }
      </Navigator>,
    );
  });
  await act(async () => {});
  return renderer;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('TrainScreen next up (Phase 4C flexible scheduling)', () => {
  it('shows the program suggestion with routine, program and never-trained hint', async () => {
    setup(NEXT_UP);
    const renderer = await renderScreen();
    expect(mockedLoadNextUp).toHaveBeenCalledTimes(1);
    expect(nodeByTestId(renderer, 'train-next-up').type).toBeDefined();
    const texts = textsOf(renderer);
    expect(texts).toContain(strings.workout.nextUp);
    expect(texts).toContain('Day B');
    expect(texts).toContain('Block A');
    expect(texts).toContain(strings.train.nextUpNew);
  });

  it('renders no card when the athlete has no program', async () => {
    setup(null);
    const renderer = await renderScreen();
    expect(renderer.root.findAll((n) => n.props?.testID === 'train-next-up')).toHaveLength(0);
  });

  it('starts the suggested routine and enters the workout', async () => {
    setup(NEXT_UP);
    const renderer = await renderScreen();
    await act(async () => {
      nodeByTestId(renderer, 'train-next-up-start').props.onPress();
    });
    expect(mockedStartSession).toHaveBeenCalledWith(expect.anything(), 'r2');
    expect(nodeByTestId(renderer, 'workout-route').type).toBeDefined();
  });

  it('tapping the suggestion opens its program detail', async () => {
    setup(NEXT_UP);
    const renderer = await renderScreen();
    await act(async () => {
      nodeByTestId(renderer, 'train-next-up-program').props.onPress();
    });
    expect(nodeByTestId(renderer, 'detail:p1').type).toBeDefined();
  });

  it('shows the start-failed message when the session cannot start', async () => {
    setup(NEXT_UP);
    mockedStartSession.mockRejectedValue(new Error('active session'));
    const renderer = await renderScreen();
    await act(async () => {
      nodeByTestId(renderer, 'train-next-up-start').props.onPress();
    });
    expect(textsOf(renderer)).toContain(strings.workout.startFailed);
  });
});
