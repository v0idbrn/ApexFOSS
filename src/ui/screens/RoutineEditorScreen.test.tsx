import React from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Navigator } from '../navigation';
import { RoutineEditorScreen } from './RoutineEditorScreen';
import { strings } from '../../constants/strings';
import { makeDbActions } from '../../data/actions';
import { emptyPrescription } from '../../types/draft';

jest.mock('../../data', () => ({ database: {} }));
jest.mock('../../data/actions', () => ({ makeDbActions: jest.fn() }));
const mockedMakeDbActions = makeDbActions as jest.MockedFunction<typeof makeDbActions>;

function flatten(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(flatten).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return '';
}

function textsOf(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByType(Text).map((t) => flatten(t.props.children));
}

function draftFixture(role?: 'main' | 'warmup' | 'cooldown' | null) {
  return {
    id: 'r1',
    name: 'Push',
    blocks: [
      {
        localId: 'b1',
        name: 'Main',
        kind: 'normal' as const,
        role: role ?? null,
        rounds: 1,
        steps: [],
        interval: null,
      },
    ],
  };
}

function setup(draft: ReturnType<typeof draftFixture>) {
  const actions = {
    loadRoutineDraft: jest.fn().mockResolvedValue(JSON.parse(JSON.stringify(draft))),
    saveRoutineDraft: jest.fn().mockResolvedValue('r1'),
  };
  mockedMakeDbActions.mockReturnValue(actions as never);
  return actions;
}

async function renderEditor(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <Navigator>{() => <RoutineEditorScreen routineId="r1" />}</Navigator>,
    );
  });
  await act(async () => {});
  return renderer;
}

function chipByLabel(renderer: ReactTestRenderer, label: string) {
  const node = renderer.root
    .findAll(
      (n) =>
        typeof n.props?.onPress === 'function' &&
        n.findAllByType(Text).some((t) => flatten(t.props.children) === label),
    )
    .pop();
  expect(node).toBeDefined();
  return node!;
}

function buttonByLabel(renderer: ReactTestRenderer, label: string) {
  const node = renderer.root
    .findAll(
      (n) =>
        n.props?.accessibilityRole === 'button' &&
        n.props?.accessibilityLabel === label &&
        typeof n.props?.onPress === 'function',
    )
    .shift();
  expect(node).toBeDefined();
  return node!;
}

describe('RoutineEditorScreen block role (1.1.0)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows Main active by default and switches role on tap', async () => {
    setup(draftFixture(null));
    const renderer = await renderEditor();
    expect(textsOf(renderer)).toContain(strings.routines.blockRole);
    expect(textsOf(renderer)).toContain(strings.routines.blockRoleMain);
    expect(textsOf(renderer)).toContain(strings.routines.blockRoleWarmup);
    expect(textsOf(renderer)).toContain(strings.routines.blockRoleCooldown);
    await act(async () => {
      chipByLabel(renderer, strings.routines.blockRoleWarmup).props.onPress();
    });
    await act(async () => {});
    const texts = textsOf(renderer);
    expect(texts.some((t) => t.includes(strings.routines.blockRoleWarmup))).toBe(true);
  });

  it('persists the chosen role on save', async () => {
    const actions = setup(draftFixture(null));
    const renderer = await renderEditor();
    await act(async () => {
      chipByLabel(renderer, strings.routines.blockRoleCooldown).props.onPress();
    });
    await act(async () => {});
    await act(async () => {
      buttonByLabel(renderer, strings.common.save).props.onPress();
    });
    await act(async () => {});
    expect(actions.saveRoutineDraft).toHaveBeenCalled();
    const saved = actions.saveRoutineDraft.mock.calls[0][0];
    expect(saved.blocks[0].role).toBe('cooldown');
  });
});
