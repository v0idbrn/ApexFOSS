import React from 'react';
import { Text, TextInput } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Navigator } from '../navigation';
import { ProgramsScreen } from './ProgramsScreen';
import { strings } from '../../constants/strings';
import { makeDbActions } from '../../data/actions';

jest.mock('../../data', () => ({ database: {} }));
jest.mock('../../data/actions', () => ({ makeDbActions: jest.fn() }));

const mockedMakeDbActions = makeDbActions as jest.MockedFunction<typeof makeDbActions>;

interface ProgramInput {
  id: string;
  name: string;
  routineCount: number;
}

const STRENGTH: ProgramInput = { id: 'p1', name: 'Strength base', routineCount: 2 };
const HYPE: ProgramInput = { id: 'p2', name: 'Hypertrophy', routineCount: 0 };

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
    .find((n) => typeof n.props?.onPress === 'function');
  expect(node).toBeDefined();
  return node!;
}

function setup(programs: ProgramInput[]) {
  const actions = {
    listProgramsWithCounts: jest.fn().mockResolvedValue(programs),
    createProgram: jest.fn().mockResolvedValue('p-new'),
  };
  mockedMakeDbActions.mockReturnValue(actions as unknown as ReturnType<typeof makeDbActions>);
  return actions;
}

async function renderScreen(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <Navigator>
        {(route) =>
          route.name === 'programDetail' ? (
            <Text testID={`detail:${route.programId}`} />
          ) : (
            <ProgramsScreen />
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

describe('ProgramsScreen (Phase 4A)', () => {
  it('lists programs with their routine counts', async () => {
    setup([STRENGTH, HYPE]);
    const renderer = await renderScreen();
    const texts = textsOf(renderer);
    expect(texts).toContain(strings.programs.title);
    expect(texts).toContain('Strength base');
    expect(texts).toContain(`2 ${strings.programs.routinesLabel}`);
    expect(texts).toContain('Hypertrophy');
    expect(texts).not.toContain(strings.programs.empty);
  });

  it('shows the empty state when no programs exist', async () => {
    setup([]);
    const renderer = await renderScreen();
    expect(textsOf(renderer)).toContain(strings.programs.empty);
  });

  it('creates a trimmed program and refreshes the list', async () => {
    const actions = setup([]);
    const renderer = await renderScreen();
    const input = nodeByTestId(renderer, 'programs-name-input').findByType(TextInput);
    await act(async () => {
      input.props.onChangeText('  Mass block  ');
    });
    await act(async () => {
      buttonByLabel(renderer, strings.programs.create).props.onPress();
    });
    expect(actions.createProgram).toHaveBeenCalledWith('Mass block');
    expect(actions.listProgramsWithCounts).toHaveBeenCalledTimes(2);
    const cleared = nodeByTestId(renderer, 'programs-name-input').findByType(TextInput);
    expect(cleared.props.value).toBe('');
  });

  it('blocks empty names with a localized error instead of creating', async () => {
    const actions = setup([]);
    const renderer = await renderScreen();
    await act(async () => {
      buttonByLabel(renderer, strings.programs.create).props.onPress();
    });
    expect(actions.createProgram).not.toHaveBeenCalled();
    expect(textsOf(renderer)).toContain(strings.programs.nameRequired);
  });

  it('opens program detail with the program id', async () => {
    setup([STRENGTH]);
    const renderer = await renderScreen();
    await act(async () => {
      nodeByTestId(renderer, 'program-row-p1').props.onPress();
    });
    expect(renderer.root.findAll((n) => n.props?.testID === 'detail:p1').length).toBeGreaterThanOrEqual(1);
  });
});
