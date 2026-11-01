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

function setup(draft: { id: string; name: string; blocks: unknown[] }) {
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

describe('RoutineEditorScreen reordering (D-068)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /** Two blocks; the first holds two steps so both levels can move. */
  function twoBlockFixture() {
    return {
      id: 'r1',
      name: 'Mixed',
      blocks: [
        {
          localId: 'b1',
          name: 'Warm',
          kind: 'normal' as const,
          role: 'warmup' as const,
          rounds: 1,
          steps: [
            {
              localId: 's1',
              exerciseId: 'e1',
              exerciseName: 'Row',
              prescription: emptyPrescription(),
              transition: { type: 'rest' as const, delayMs: 60_000 },
            },
            {
              localId: 's2',
              exerciseId: 'e2',
              exerciseName: 'Press',
              prescription: emptyPrescription(),
              transition: { type: 'rest' as const, delayMs: 60_000 },
            },
          ],
          interval: null,
        },
        {
          localId: 'b2',
          name: 'Main',
          kind: 'normal' as const,
          role: null,
          rounds: 1,
          steps: [],
          interval: null,
        },
      ],
    };
  }

  function buttonCount(renderer: ReactTestRenderer, label: string): number {
    return renderer.root.findAll(
      (n) =>
        n.props?.accessibilityRole === 'button' &&
        n.props?.accessibilityLabel === label &&
        typeof n.props?.onPress === 'function',
    ).length;
  }

  it('shows move controls only where the move is possible', async () => {
    setup(twoBlockFixture());
    const renderer = await renderEditor();

    // Per-position block labels (RN Text renders composite + host nodes, so
    // counts are never exact — absent vs present is the reliable signal).
    const up = (level: 'block' | 'step', n: number) =>
      `${strings.routines.moveUp} ${strings.routines[level]} ${n}`;
    const down = (level: 'block' | 'step', n: number) =>
      `${strings.routines.moveDown} ${strings.routines[level]} ${n}`;

    expect(buttonCount(renderer, up('block', 1))).toBe(0); // first block cannot move up
    expect(buttonCount(renderer, down('block', 2))).toBe(0); // last block cannot move down
    expect(buttonCount(renderer, down('block', 1))).toBeGreaterThan(0);
    expect(buttonCount(renderer, up('block', 2))).toBeGreaterThan(0);

    expect(buttonCount(renderer, up('step', 1))).toBe(0); // first step cannot move up
    expect(buttonCount(renderer, down('step', 2))).toBe(0); // last step cannot move down
    expect(buttonCount(renderer, down('step', 1))).toBeGreaterThan(0);
    expect(buttonCount(renderer, up('step', 2))).toBeGreaterThan(0);
  });

  it('moves a step down and persists the new order on save', async () => {
    const actions = setup(twoBlockFixture());
    const renderer = await renderEditor();

    await act(async () => {
      buttonByLabel(renderer, `${strings.routines.moveDown} ${strings.routines.step} 1`).props.onPress();
    });
    await act(async () => {});
    await act(async () => {
      buttonByLabel(renderer, strings.common.save).props.onPress();
    });
    await act(async () => {});

    expect(actions.saveRoutineDraft).toHaveBeenCalled();
    const saved = actions.saveRoutineDraft.mock.calls[0][0];
    expect(saved.blocks[0].steps.map((s: { exerciseName: string }) => s.exerciseName)).toEqual([
      'Press',
      'Row',
    ]);
  });

  it('moves a block down and persists the new block order on save', async () => {
    const actions = setup(twoBlockFixture());
    const renderer = await renderEditor();

    await act(async () => {
      buttonByLabel(renderer, `${strings.routines.moveDown} ${strings.routines.block} 1`).props.onPress();
    });
    await act(async () => {});
    await act(async () => {
      buttonByLabel(renderer, strings.common.save).props.onPress();
    });
    await act(async () => {});

    expect(actions.saveRoutineDraft).toHaveBeenCalled();
    const saved = actions.saveRoutineDraft.mock.calls[0][0];
    expect(saved.blocks.map((b: { name: string }) => b.name)).toEqual(['Main', 'Warm']);
  });
});
