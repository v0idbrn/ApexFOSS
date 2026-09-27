import React from 'react';
import { Alert, Text, TextInput } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Navigator } from '../navigation';
import { ProgramDetailScreen } from './ProgramDetailScreen';
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

interface RoutineInput {
  id: string;
  name: string;
  mesocycleId?: string | null;
}

interface MesocycleInput {
  id: string;
  name: string;
  sortOrder: number;
  routineCount: number;
}

const PROGRAM: ProgramInput = { id: 'p1', name: 'Block A', routineCount: 2 };
const MEMBER: RoutineInput = { id: 'r1', name: 'Day A', mesocycleId: null };
const MEMBER2: RoutineInput = { id: 'r2', name: 'Day B', mesocycleId: null };
const CANDIDATE: RoutineInput = { id: 'r3', name: 'Loose day', mesocycleId: null };
const MESO: MesocycleInput = { id: 'm1', name: 'Accumulation', sortOrder: 1, routineCount: 0 };

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

interface SetupOptions {
  programs?: ProgramInput[];
  members?: RoutineInput[];
  unassigned?: RoutineInput[];
  mesos?: MesocycleInput[];
}

function setup(opts: SetupOptions = {}) {
  const { programs = [PROGRAM], members = [MEMBER, MEMBER2], unassigned = [CANDIDATE], mesos = [] } = opts;
  const actions = {
    listProgramsWithCounts: jest.fn().mockResolvedValue(programs),
    listProgramRoutines: jest.fn().mockResolvedValue(members),
    listUnassignedRoutines: jest.fn().mockResolvedValue(unassigned),
    listMesocycles: jest.fn().mockResolvedValue(mesos),
    renameProgram: jest.fn().mockResolvedValue(undefined),
    assignRoutineToProgram: jest.fn().mockResolvedValue(undefined),
    removeRoutineFromProgram: jest.fn().mockResolvedValue(undefined),
    deleteProgram: jest.fn().mockResolvedValue(undefined),
    createMesocycle: jest.fn().mockResolvedValue('m-new'),
    renameMesocycle: jest.fn().mockResolvedValue(undefined),
    deleteMesocycle: jest.fn().mockResolvedValue(undefined),
    assignRoutineToMesocycle: jest.fn().mockResolvedValue(undefined),
    removeRoutineFromMesocycle: jest.fn().mockResolvedValue(undefined),
  };
  mockedMakeDbActions.mockReturnValue(actions as unknown as ReturnType<typeof makeDbActions>);
  return actions;
}

async function renderScreen(programId = 'p1'): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <Navigator>
        {() => <ProgramDetailScreen programId={programId} />}
      </Navigator>,
    );
  });
  await act(async () => {});
  return renderer;
}

/** Confirm helper: fires the destructive button of the last Alert.alert call. */
async function confirmLastAlert() {
  const calls = (Alert.alert as jest.Mock).mock.calls;
  const buttons = calls[calls.length - 1][2];
  await act(async () => {
    await buttons[1].onPress();
  });
}

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  alertSpy.mockRestore();
});

describe('ProgramDetailScreen (Phase 4A)', () => {
  it('renders members in order plus unassigned candidates', async () => {
    setup();
    const renderer = await renderScreen();
    const texts = textsOf(renderer);
    expect(texts).toContain('Block A');
    expect(texts).toContain('Day A');
    expect(texts).toContain('Day B');
    expect(texts).toContain('Loose day');
    expect(texts).toContain(strings.programs.members);
    expect(texts).toContain(strings.programs.addRoutine);
    expect(nodeByTestId(renderer, 'program-member-r1').type).toBeDefined();
    expect(nodeByTestId(renderer, 'program-candidate-r3').type).toBeDefined();
  });

  it('saves a renamed program and refreshes', async () => {
    const actions = setup();
    const renderer = await renderScreen();
    const input = nodeByTestId(renderer, 'program-rename-input').findByType(TextInput);
    await act(async () => {
      input.props.onChangeText('New block');
    });
    await act(async () => {
      buttonByLabel(renderer, strings.common.save).props.onPress();
    });
    expect(actions.renameProgram).toHaveBeenCalledWith('p1', 'New block');
    expect(actions.listProgramsWithCounts).toHaveBeenCalledTimes(2);
  });

  it('rejects a blank rename with the localized error', async () => {
    const actions = setup();
    const renderer = await renderScreen();
    const input = nodeByTestId(renderer, 'program-rename-input').findByType(TextInput);
    await act(async () => {
      input.props.onChangeText('   ');
    });
    await act(async () => {
      buttonByLabel(renderer, strings.common.save).props.onPress();
    });
    expect(actions.renameProgram).not.toHaveBeenCalled();
    expect(textsOf(renderer)).toContain(strings.programs.nameRequired);
  });

  it('assigns an unassigned routine to this program', async () => {
    const actions = setup();
    const renderer = await renderScreen();
    await act(async () => {
      buttonByLabel(renderer, strings.programs.addRoutine).props.onPress();
    });
    expect(actions.assignRoutineToProgram).toHaveBeenCalledWith('r3', 'p1');
    expect(actions.listProgramRoutines).toHaveBeenCalledTimes(2);
  });

  it('removes a member after confirmation', async () => {
    const actions = setup();
    const renderer = await renderScreen();
    await act(async () => {
      buttonByLabel(renderer, strings.programs.remove).props.onPress();
    });
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(actions.removeRoutineFromProgram).not.toHaveBeenCalled();
    await confirmLastAlert();
    expect(actions.removeRoutineFromProgram).toHaveBeenCalledWith('r1');
  });

  it('deletes the program after confirmation', async () => {
    const actions = setup();
    const renderer = await renderScreen();
    await act(async () => {
      buttonByLabel(renderer, strings.programs.delete).props.onPress();
    });
    expect(actions.deleteProgram).not.toHaveBeenCalled();
    await confirmLastAlert();
    expect(actions.deleteProgram).toHaveBeenCalledWith('p1');
  });

  it('shows the localized not-found state when the program is gone', async () => {
    setup({ programs: [] });
    const renderer = await renderScreen('missing');
    expect(textsOf(renderer)).toContain(strings.programs.notFound);
  });

  it('distinguishes empty members from no unassigned candidates', async () => {
    setup({ members: [], unassigned: [] });
    const renderer = await renderScreen();
    const texts = textsOf(renderer);
    expect(texts).toContain(strings.programs.noMembers);
    expect(texts).toContain(strings.programs.noUnassigned);
  });
});

describe('ProgramDetailScreen mesocycles (Phase 4B)', () => {
  it('creates a mesocycle and refreshes phases', async () => {
    const actions = setup();
    const renderer = await renderScreen();
    const input = nodeByTestId(renderer, 'meso-name-input').findByType(TextInput);
    await act(async () => {
      input.props.onChangeText('Weeks 1-4');
    });
    await act(async () => {
      buttonByLabel(renderer, strings.programs.createMesocycle).props.onPress();
    });
    expect(actions.createMesocycle).toHaveBeenCalledWith('p1', 'Weeks 1-4');
    expect(actions.listMesocycles).toHaveBeenCalledTimes(2);
    expect(actions.listMesocycles).toHaveBeenCalledWith('p1');
  });

  it('blocks empty mesocycle names with the localized error', async () => {
    const actions = setup();
    const renderer = await renderScreen();
    await act(async () => {
      buttonByLabel(renderer, strings.programs.createMesocycle).props.onPress();
    });
    expect(actions.createMesocycle).not.toHaveBeenCalled();
    expect(textsOf(renderer)).toContain(strings.programs.nameRequired);
  });

  it('lists mesocycles with rename and delete controls', async () => {
    setup({ mesos: [MESO] });
    const renderer = await renderScreen();
    const texts = textsOf(renderer);
    expect(texts).toContain(strings.programs.mesocycles);
    expect(texts).toContain('Accumulation');
    expect(nodeByTestId(renderer, 'meso-card-m1').type).toBeDefined();
    expect(buttonByLabel(renderer, strings.programs.deleteMesocycle)).toBeDefined();
  });

  it('stages a routine into a mesocycle via its chip', async () => {
    const actions = setup({ mesos: [MESO] });
    const renderer = await renderScreen();
    await act(async () => {
      nodeByTestId(renderer, 'stage-r1-m1').props.onPress();
    });
    expect(actions.assignRoutineToMesocycle).toHaveBeenCalledWith('r1', 'm1');
    expect(actions.removeRoutineFromMesocycle).not.toHaveBeenCalled();
    expect(actions.listProgramRoutines).toHaveBeenCalledTimes(2);
  });

  it('unstages via the no-phase chip when the routine is staged', async () => {
    const actions = setup({ mesos: [MESO], members: [{ ...MEMBER, mesocycleId: 'm1' }] });
    const renderer = await renderScreen();
    await act(async () => {
      nodeByTestId(renderer, 'stage-none-r1').props.onPress();
    });
    expect(actions.removeRoutineFromMesocycle).toHaveBeenCalledWith('r1');
    expect(actions.assignRoutineToMesocycle).not.toHaveBeenCalled();
  });

  it('renames a mesocycle from its card', async () => {
    const actions = setup({ mesos: [MESO] });
    const renderer = await renderScreen();
    const input = nodeByTestId(renderer, 'meso-rename-input-m1').findByType(TextInput);
    await act(async () => {
      input.props.onChangeText('Accumulation v2');
    });
    const saves = renderer.root
      .findAll((n) => n.props?.accessibilityRole === 'button' && n.props?.accessibilityLabel === strings.common.save)
      .filter((n) => typeof n.props?.onPress === 'function');
    await act(async () => {
      saves[saves.length - 1].props.onPress();
    });
    expect(actions.renameMesocycle).toHaveBeenCalledWith('m1', 'Accumulation v2');
    expect(actions.renameProgram).not.toHaveBeenCalled();
  });

  it('deletes a mesocycle after confirmation', async () => {
    const actions = setup({ mesos: [MESO] });
    const renderer = await renderScreen();
    await act(async () => {
      buttonByLabel(renderer, strings.programs.deleteMesocycle).props.onPress();
    });
    expect(actions.deleteMesocycle).not.toHaveBeenCalled();
    await confirmLastAlert();
    expect(actions.deleteMesocycle).toHaveBeenCalledWith('m1');
  });
});
