import React from 'react';
import { Alert, Pressable, Text, TextInput } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Navigator } from './navigation';
import { GoalSection } from './GoalSection';
import { strings } from '../constants/strings';
import { makeDbActions } from '../data/actions';
import { loadGoals, type GoalWithProgress } from '../data/goals';

jest.mock('../data', () => ({ database: {} }));
jest.mock('../data/actions', () => ({ makeDbActions: jest.fn() }));
jest.mock('../data/goals', () => ({ loadGoals: jest.fn() }));
jest.mock('./screens/ExercisePickerScreen', () => {
  const ReactLocal = require('react');
  const { Pressable } = require('react-native');
  return {
    ExercisePickerScreen: ({ onPick }: { onPick: (id: string, name: string) => void }) =>
      ReactLocal.createElement(Pressable, {
        accessibilityRole: 'button',
        accessibilityLabel: 'mock picker pick',
        testID: 'mock-picker-pick',
        onPress: () => onPick('ex-1', 'Bench Press'),
      }),
  };
});

const mockedMakeDbActions = makeDbActions as jest.MockedFunction<typeof makeDbActions>;
const mockedLoadGoals = loadGoals as jest.MockedFunction<typeof loadGoals>;

const GOAL: GoalWithProgress = {
  id: 'g1',
  exerciseId: 'ex-1',
  exerciseName: 'Bench Press',
  targetGrams: 100_000,
  currentGrams: 80_000,
  progress: 0.8,
  achieved: false,
};

let alertSpy: jest.SpyInstance;

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

function buttonByLabel(renderer: ReactTestRenderer, label: string) {
  const node = renderer.root
    .findAll((n) => n.props?.accessibilityRole === 'button' && n.props?.accessibilityLabel === label)
    .filter((n) => n.props.testID !== 'goals-add')[0];
  expect(node).toBeDefined();
  return node!;
}

function setup(goals: GoalWithProgress[], actions: Partial<Record<string, jest.Mock>> = {}) {
  mockedLoadGoals.mockResolvedValue(goals);
  mockedMakeDbActions.mockReturnValue({
    createGoal: jest.fn().mockResolvedValue('g1'),
    deleteGoal: jest.fn().mockResolvedValue(undefined),
    ...actions,
  } as unknown as ReturnType<typeof makeDbActions>);
}

async function renderSection(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <Navigator>
        {(route) =>
          route.name === 'exerciseEditor' ? (
            <Text testID={`editor:${route.exerciseId}`} />
          ) : (
            <GoalSection />
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
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  alertSpy.mockRestore();
});

describe('GoalSection (Phase 4D)', () => {
  it('lists goals with derived progress and achieved marker', async () => {
    setup([GOAL, { ...GOAL, id: 'g2', exerciseId: 'ex-2', exerciseName: 'Squat', currentGrams: null, progress: null, achieved: false }]);
    const renderer = await renderSection();
    expect(mockedLoadGoals).toHaveBeenCalledTimes(1);
    const texts = textsOf(renderer);
    expect(texts).toContain(strings.goals.title);
    expect(texts).toContain('Bench Press');
    expect(texts).toContain('80 / 100 kg · 80%');
    expect(texts).toContain('Squat');
    expect(texts).toContain(`100 kg · ${strings.goals.noData}`);
  });

  it('shows the achieved marker when the target is reached', async () => {
    setup([{ ...GOAL, currentGrams: 105_000, progress: 1, achieved: true }]);
    const renderer = await renderSection();
    expect(textsOf(renderer).some((t) => t.includes(strings.goals.achieved))).toBe(true);
  });

  it('shows the empty state when no goals exist', async () => {
    setup([]);
    const renderer = await renderSection();
    expect(textsOf(renderer)).toContain(strings.goals.emptyBody);
    expect(renderer.root.findAll((n) => n.props?.testID?.startsWith?.('goal-row-'))).toHaveLength(0);
  });

  it('opens the picker, then saves a new goal', async () => {
    const createGoal = jest.fn().mockResolvedValue('g1');
    setup([], { createGoal });
    const renderer = await renderSection();
    await act(async () => {
      nodeByTestId(renderer, 'goals-add').props.onPress();
    });
    await act(async () => {
      nodeByTestId(renderer, 'mock-picker-pick').props.onPress();
    });
    expect(nodeByTestId(renderer, 'goals-form').type).toBeDefined();
    await act(async () => {
      renderer.root.findAllByType(TextInput)[0].props.onChangeText('100');
    });
    await act(async () => {
      buttonByLabel(renderer, strings.goals.add).props.onPress();
    });
    expect(createGoal).toHaveBeenCalledWith('ex-1', 100_000);
    expect(mockedLoadGoals).toHaveBeenCalledTimes(2);
  });

  it('requires a positive target before saving', async () => {
    const createGoal = jest.fn();
    setup([], { createGoal });
    const renderer = await renderSection();
    await act(async () => {
      nodeByTestId(renderer, 'goals-add').props.onPress();
    });
    await act(async () => {
      nodeByTestId(renderer, 'mock-picker-pick').props.onPress();
    });
    await act(async () => {
      buttonByLabel(renderer, strings.goals.add).props.onPress();
    });
    expect(createGoal).not.toHaveBeenCalled();
    expect(textsOf(renderer)).toContain(strings.goals.targetRequired);
  });

  it('surfaces the duplicate-goal error', async () => {
    const createGoal = jest.fn().mockRejectedValue(new Error('exercise already has a goal'));
    setup([], { createGoal });
    const renderer = await renderSection();
    await act(async () => {
      nodeByTestId(renderer, 'goals-add').props.onPress();
    });
    await act(async () => {
      nodeByTestId(renderer, 'mock-picker-pick').props.onPress();
    });
    await act(async () => {
      renderer.root.findAllByType(TextInput)[0].props.onChangeText('80');
    });
    await act(async () => {
      buttonByLabel(renderer, strings.goals.add).props.onPress();
    });
    expect(textsOf(renderer)).toContain(strings.goals.exists);
  });

  it('deletes a goal after destructive confirmation', async () => {
    const deleteGoal = jest.fn().mockResolvedValue(undefined);
    setup([GOAL], { deleteGoal });
    const renderer = await renderSection();
    await act(async () => {
      nodeByTestId(renderer, 'goal-delete-g1').props.onPress();
    });
    expect(alertSpy).toHaveBeenCalledWith(strings.common.delete, strings.goals.deleteConfirm, expect.any(Array));
    const buttons = (alertSpy.mock.calls[0][2] ?? []) as Array<{ onPress?: () => void }>;
    await act(async () => {
      buttons[1].onPress?.();
    });
    expect(deleteGoal).toHaveBeenCalledWith('g1');
    expect(mockedLoadGoals).toHaveBeenCalledTimes(2);
  });

  it('opens the exercise editor from a row', async () => {
    setup([GOAL]);
    const renderer = await renderSection();
    await act(async () => {
      nodeByTestId(renderer, 'goal-row-g1').props.onPress();
    });
    expect(
      renderer.root.findAll((n) => n.props?.testID === 'editor:ex-1').length,
    ).toBeGreaterThanOrEqual(1);
  });
});
