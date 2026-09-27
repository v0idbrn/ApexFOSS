import React, { useEffect, useRef } from 'react';
import { Alert, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Navigator, useNav } from '../navigation';
import { RoutineListScreen } from './RoutineListScreen';
import { Enter } from '../motion';
import { strings } from '../../constants/strings';
import { makeDbActions } from '../../data/actions';
import { loadDashboard, type DashboardData } from '../../data/dashboard';
import { startWorkoutSession } from '../../workout/runner';
import { useActiveSessionStore } from '../../state/activeSessionStore';
import { emptyPrescription, type RoutineDraft } from '../../types/draft';
import type { BlockKind } from '../../types/engine';

jest.mock('../../data', () => ({ database: {} }));
jest.mock('../../data/actions', () => ({ makeDbActions: jest.fn() }));
jest.mock('../../data/dashboard', () => ({ loadDashboard: jest.fn() }));
jest.mock('../../workout/runner', () => ({ startWorkoutSession: jest.fn() }));

const mockedMakeDbActions = makeDbActions as jest.MockedFunction<typeof makeDbActions>;
const mockedLoadDashboard = loadDashboard as jest.MockedFunction<typeof loadDashboard>;
const mockedStartWorkoutSession = startWorkoutSession as jest.MockedFunction<typeof startWorkoutSession>;

const CHECK_GLYPH = '✓';
const WARN_GLYPH = '⚠';

interface RowInput {
  id: string;
  name: string;
  blockCount: number;
  stepCount: number;
}

const PUSH_DAY: RowInput = { id: 'r1', name: 'Push day', blockCount: 2, stepCount: 4 };
const LEG_DAY: RowInput = { id: 'r3', name: 'Leg day', blockCount: 1, stepCount: 3 };

function flatten(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(flatten).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return '';
}

function textsOf(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByType(Text).map((node) => flatten(node.props.children));
}

function nodesByTestId(renderer: ReactTestRenderer, testID: string) {
  return renderer.root.findAll((node) => node.props?.testID === testID);
}

function actionNode(renderer: ReactTestRenderer, testID: string) {
  const node = renderer.root.findAll(
    (n) =>
      n.props?.testID === testID &&
      n.props?.accessibilityRole === 'button' &&
      typeof n.props?.onPress === 'function',
  )[0];
  expect(node).toBeDefined();
  return node!;
}

async function press(renderer: ReactTestRenderer, testID: string) {
  const node = actionNode(renderer, testID);
  await act(async () => {
    node.props.onPress();
  });
}

function buttonByLabel(renderer: ReactTestRenderer, label: string) {
  return renderer.root
    .findAll((n) => n.props?.accessibilityRole === 'button' && n.props?.accessibilityLabel === label)
    .find((n) => typeof n.props?.onPress === 'function');
}

function cardTexts(renderer: ReactTestRenderer, testID: string): string[] {
  const card = nodesByTestId(renderer, testID)[0];
  expect(card).toBeDefined();
  return card.findAllByType(Text).map((node) => flatten(node.props.children));
}

function makeDraft(
  id: string,
  name: string,
  exercises: string[],
  opts: { sets?: number | null; kind?: BlockKind } = {},
): RoutineDraft {
  return {
    id,
    name,
    blocks: [
      {
        localId: `${id}-b1`,
        name: 'Main',
        kind: opts.kind ?? 'normal',
        rounds: 1,
        steps: exercises.map((exerciseName, index) => ({
          localId: `${id}-s${index}`,
          exerciseId: `ex-${exerciseName}`,
          exerciseName,
          prescription: { ...emptyPrescription(), targetSets: opts.sets === undefined ? 3 : opts.sets },
          transition: { type: 'immediate' as const, delayMs: 0 },
        })),
        interval: null,
      },
    ],
  };
}

interface SetupOptions {
  rows?: RowInput[];
  drafts?: Record<string, RoutineDraft>;
  activeSession?: unknown;
  lastTrained?: { id: string; name: string; lastTrainedAt: number } | null;
}

function setup(opts: SetupOptions = {}) {
  const { rows = [], drafts = {}, activeSession = null, lastTrained = null } = opts;
  const actions = {
    listRoutinesWithCounts: jest.fn().mockResolvedValue(rows),
    loadRoutineDraft: jest.fn((id: string) =>
      drafts[id] ? Promise.resolve(drafts[id]) : Promise.reject(new Error('draft missing')),
    ),
    deleteRoutine: jest.fn().mockResolvedValue(undefined),
    getActiveSession: jest.fn().mockResolvedValue(activeSession),
  };
  mockedMakeDbActions.mockReturnValue(actions as unknown as ReturnType<typeof makeDbActions>);
  mockedLoadDashboard.mockResolvedValue({ lastRoutine: lastTrained } as unknown as DashboardData);
  mockedStartWorkoutSession.mockResolvedValue('sess-1');
  return actions;
}

/** Selects the routines tab once so the screen renders at its real tab root. */
function TabLauncher() {
  const { tab, selectTab } = useNav();
  const launched = useRef(false);
  useEffect(() => {
    if (launched.current) return;
    launched.current = true;
    if (tab !== 'routines') selectTab('routines');
  }, [tab, selectTab]);
  return null;
}

async function renderScreen(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <Navigator>
        {(route) => (
          <>
            <TabLauncher />
            {route.name === 'routines' ? (
              <RoutineListScreen />
            ) : route.name === 'programs' ? (
              <Text testID="programs-route" />
            ) : route.name === 'routineEditor' ? (
              <Text testID={route.routineId === null ? 'editor-new' : `editor:${route.routineId}`} />
            ) : route.name === 'routinePreview' ? (
              <Text testID={`preview:${route.draft.id ?? ''}`} />
            ) : route.name === 'workout' ? (
              <Text testID="workout-route" />
            ) : null}
          </>
        )}
      </Navigator>,
    );
  });
  await act(async () => {});
  await act(async () => {});
  return renderer;
}

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  useActiveSessionStore.setState({ sessionId: null, routineName: null });
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  alertSpy.mockRestore();
});

describe('RoutineListScreen presentation (Phase 2L STAGE F)', () => {
  it('renders the routines title and a new-routine header action', async () => {
    setup({ rows: [PUSH_DAY], drafts: { r1: makeDraft('r1', 'Push day', ['Bench']) } });
    const renderer = await renderScreen();

    expect(textsOf(renderer)).toContain(strings.routines.title);

    const cta = buttonByLabel(renderer, strings.routines.newRoutine);
    expect(cta).toBeDefined();
    expect(cta!.props.accessibilityRole).toBe('button');
    expect(cta!.props.accessibilityState).toEqual({ disabled: false });

    await act(async () => {
      cta!.props.onPress();
    });
    expect(nodesByTestId(renderer, 'editor-new').length).toBeGreaterThanOrEqual(1);
  });

  it('shows the empty state with a create-routine action', async () => {
    setup({ rows: [] });
    const renderer = await renderScreen();

    expect(textsOf(renderer)).toContain(strings.routines.empty);

    const action = buttonByLabel(renderer, strings.routines.emptyAction);
    expect(action).toBeDefined();
    await act(async () => {
      action!.props.onPress();
    });
    expect(nodesByTestId(renderer, 'editor-new').length).toBeGreaterThanOrEqual(1);
  });

  it('shows the programs entry card even when there are no routines (Phase 4A)', async () => {
    setup({ rows: [] });
    const renderer = await renderScreen();

    expect(nodesByTestId(renderer, 'programs-entry').length).toBeGreaterThanOrEqual(1);
    const texts = textsOf(renderer);
    expect(texts).toContain(strings.programs.title);
    expect(texts).toContain(strings.programs.subtitle);
    expect(texts).toContain(strings.routines.empty); // empty state stays reachable

    await press(renderer, 'programs-entry-open');
    expect(nodesByTestId(renderer, 'programs-route').length).toBeGreaterThanOrEqual(1);
  });

  it('shows exercise, block and step counts on the routine card', async () => {
    setup({
      rows: [PUSH_DAY],
      drafts: { r1: makeDraft('r1', 'Push day', ['Bench Press', 'Overhead Press', 'Dips']) },
    });
    const renderer = await renderScreen();

    expect(nodesByTestId(renderer, 'routine-card-r1').length).toBeGreaterThanOrEqual(1);
    const joined = cardTexts(renderer, 'routine-card-r1').join(' ');
    expect(joined).toContain('Push day');
    expect(joined).toContain(`${strings.routines.exercises}: 3`);
    expect(joined).toContain(`${strings.routines.blocks}: 2`);
    expect(joined).toContain(`${strings.routines.steps}: 4`);
  });

  it('falls back to the untitled label when a routine has no name', async () => {
    setup({ rows: [{ id: 'r9', name: '', blockCount: 0, stepCount: 0 }], drafts: {} });
    const renderer = await renderScreen();
    expect(cardTexts(renderer, 'routine-card-r9').join(' ')).toContain(strings.routines.untitledRoutine);
  });

  it('marks a routine that passes every check with the integrity badge', async () => {
    setup({ rows: [PUSH_DAY], drafts: { r1: makeDraft('r1', 'Push day', ['Bench Press']) } });
    const renderer = await renderScreen();

    expect(nodesByTestId(renderer, 'routine-integrity-r1').length).toBeGreaterThanOrEqual(1);
    const joined = cardTexts(renderer, 'routine-card-r1').join(' ');
    expect(joined).toContain(strings.routines.integrityOk);
    expect(joined).toContain(CHECK_GLYPH);
    expect(joined).not.toContain(strings.integrity.warning);
    expect(joined).not.toContain(WARN_GLYPH);
  });

  it('shows a warning integrity state with a glyph when checks fail', async () => {
    setup({ rows: [PUSH_DAY], drafts: { r1: makeDraft('r1', 'Push day', ['Bench Press'], { sets: null }) } });
    const renderer = await renderScreen();

    const joined = cardTexts(renderer, 'routine-card-r1').join(' ');
    expect(joined).toContain(strings.integrity.warning);
    expect(joined).toContain(WARN_GLYPH);
    expect(joined).not.toContain(strings.routines.integrityOk);
    expect(joined).not.toContain(CHECK_GLYPH);
  });

  it('warns about a routine whose draft cannot be read', async () => {
    setup({ rows: [PUSH_DAY], drafts: {} });
    const renderer = await renderScreen();

    const joined = cardTexts(renderer, 'routine-card-r1').join(' ');
    expect(joined).toContain(strings.integrity.warning);
    expect(joined).toContain(WARN_GLYPH);
    expect(joined).not.toContain(strings.routines.exercises);
  });

  it('labels routines that share a name as duplicates', async () => {
    setup({
      rows: [PUSH_DAY, { id: 'r2', name: 'push day', blockCount: 1, stepCount: 2 }, LEG_DAY],
      drafts: {
        r1: makeDraft('r1', 'Push day', ['Bench']),
        r2: makeDraft('r2', 'push day', ['Bench']),
        r3: makeDraft('r3', 'Leg day', ['Squat']),
      },
    });
    const renderer = await renderScreen();

    expect(nodesByTestId(renderer, 'routine-duplicate-r1').length).toBeGreaterThanOrEqual(1);
    expect(nodesByTestId(renderer, 'routine-duplicate-r2').length).toBeGreaterThanOrEqual(1);
    expect(cardTexts(renderer, 'routine-card-r1').join(' ')).toContain(strings.routines.duplicate);
    expect(nodesByTestId(renderer, 'routine-duplicate-r3')).toHaveLength(0);
  });

  it('surfaces non-default block kinds as labeled badges', async () => {
    setup({
      rows: [PUSH_DAY],
      drafts: { r1: makeDraft('r1', 'Push day', ['Bench Press'], { kind: 'superset' }) },
    });
    const renderer = await renderScreen();

    expect(nodesByTestId(renderer, 'routine-kind-r1-superset').length).toBeGreaterThanOrEqual(1);
    expect(cardTexts(renderer, 'routine-card-r1').join(' ')).toContain(strings.routines.blockKind.superset);
  });

  it('shows the last-trained date when the dashboard reports one', async () => {
    setup({
      rows: [PUSH_DAY, LEG_DAY],
      drafts: {
        r1: makeDraft('r1', 'Push day', ['Bench']),
        r3: makeDraft('r3', 'Leg day', ['Squat']),
      },
      lastTrained: { id: 'r3', name: 'Leg day', lastTrainedAt: Date.now() },
    });
    const renderer = await renderScreen();

    expect(cardTexts(renderer, 'routine-card-r3').join(' ')).toContain(`${strings.home.lastTrained}:`);
    expect(cardTexts(renderer, 'routine-card-r1').join(' ')).not.toContain(`${strings.home.lastTrained}:`);
  });

  it('wraps the card list in the motion entrance', async () => {
    setup({ rows: [PUSH_DAY], drafts: { r1: makeDraft('r1', 'Push day', ['Bench Press']) } });
    const renderer = await renderScreen();

    expect(renderer.root.findAllByType(Enter).length).toBeGreaterThanOrEqual(1);
    expect(nodesByTestId(renderer, 'routine-card-r1').length).toBeGreaterThanOrEqual(1);
  });
});

describe('RoutineListScreen actions (Phase 2L STAGE F)', () => {
  it('pushes the routine preview route with the loaded draft', async () => {
    setup({ rows: [PUSH_DAY], drafts: { r1: makeDraft('r1', 'Push day', ['Bench Press']) } });
    const renderer = await renderScreen();

    await press(renderer, 'routine-preview-r1');

    expect(nodesByTestId(renderer, 'preview:r1').length).toBeGreaterThanOrEqual(1);
  });

  it('starts the routine and navigates to the workout', async () => {
    setup({ rows: [PUSH_DAY], drafts: { r1: makeDraft('r1', 'Push day', ['Bench Press']) } });
    const renderer = await renderScreen();

    await press(renderer, 'routine-start-r1');
    await act(async () => {});

    expect(mockedStartWorkoutSession).toHaveBeenCalledWith(expect.anything(), 'r1');
    expect(nodesByTestId(renderer, 'workout-route').length).toBeGreaterThanOrEqual(1);
    expect(useActiveSessionStore.getState()).toMatchObject({ sessionId: 'sess-1', routineName: 'Push day' });
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('confirms before starting when another session is already active', async () => {
    setup({
      rows: [PUSH_DAY],
      drafts: { r1: makeDraft('r1', 'Push day', ['Bench Press']) },
      activeSession: { id: 'other-session' },
    });
    const renderer = await renderScreen();

    await press(renderer, 'routine-start-r1');

    expect(mockedStartWorkoutSession).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(strings.workout.start, strings.workout.activeConflict, expect.any(Array));

    const buttons = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    const confirm = buttons.find((b) => b.text === strings.routines.start);
    expect(confirm).toBeDefined();
    await act(async () => {
      confirm!.onPress?.();
    });
    await act(async () => {});

    expect(mockedStartWorkoutSession).toHaveBeenCalledWith(expect.anything(), 'r1');
    expect(nodesByTestId(renderer, 'workout-route').length).toBeGreaterThanOrEqual(1);
  });

  it('opens the routine editor from the card body', async () => {
    setup({ rows: [PUSH_DAY], drafts: { r1: makeDraft('r1', 'Push day', ['Bench Press']) } });
    const renderer = await renderScreen();

    await press(renderer, 'routine-open-r1');

    expect(nodesByTestId(renderer, 'editor:r1').length).toBeGreaterThanOrEqual(1);
  });

  it('opens the routine editor from the edit action', async () => {
    setup({ rows: [PUSH_DAY], drafts: { r1: makeDraft('r1', 'Push day', ['Bench Press']) } });
    const renderer = await renderScreen();

    await press(renderer, 'routine-edit-r1');

    expect(nodesByTestId(renderer, 'editor:r1').length).toBeGreaterThanOrEqual(1);
  });

  it('confirms deletion with the routine copy, deletes, and reloads', async () => {
    const actions = setup({ rows: [PUSH_DAY], drafts: { r1: makeDraft('r1', 'Push day', ['Bench Press']) } });
    actions.listRoutinesWithCounts.mockResolvedValueOnce([PUSH_DAY]).mockResolvedValueOnce([]);
    const renderer = await renderScreen();

    await press(renderer, 'routine-delete-r1');

    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [, message] = alertSpy.mock.calls[0];
    expect(message).toContain(strings.routines.deleteConfirm);
    expect(message).toContain(PUSH_DAY.name);

    const buttons = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    const confirm = buttons.find((b) => b.text === strings.common.delete);
    expect(confirm).toBeDefined();
    await act(async () => {
      confirm!.onPress?.();
    });
    await act(async () => {});
    await act(async () => {});

    expect(actions.deleteRoutine).toHaveBeenCalledWith('r1');
    expect(textsOf(renderer)).toContain(strings.routines.empty);
  });

  it('keeps the cancel side of the delete confirmation side-effect free', async () => {
    const actions = setup({ rows: [PUSH_DAY], drafts: { r1: makeDraft('r1', 'Push day', ['Bench']) } });
    const renderer = await renderScreen();

    await press(renderer, 'routine-delete-r1');

    const buttons = alertSpy.mock.calls[0][2] as { text: string; style?: string }[];
    const cancel = buttons.find((b) => b.style === 'cancel');
    expect(cancel).toBeDefined();
    expect(cancel!.text).toBe(strings.common.cancel);
    expect(actions.deleteRoutine).not.toHaveBeenCalled();
    expect(nodesByTestId(renderer, 'routine-card-r1').length).toBeGreaterThanOrEqual(1);
  });

  it('shows an error state and recovers through retry', async () => {
    const actions = setup({ rows: [PUSH_DAY], drafts: { r1: makeDraft('r1', 'Push day', ['Bench']) } });
    actions.listRoutinesWithCounts.mockRejectedValueOnce(new Error('db down'));
    const renderer = await renderScreen();

    expect(textsOf(renderer).join(' ')).toContain('db down');

    const retry = buttonByLabel(renderer, strings.common.retry);
    expect(retry).toBeDefined();
    await act(async () => {
      retry!.props.onPress();
    });
    await act(async () => {});

    expect(textsOf(renderer).join(' ')).not.toContain('db down');
    expect(nodesByTestId(renderer, 'routine-card-r1').length).toBeGreaterThanOrEqual(1);
  });
});

describe('RoutineListScreen accessibility (Phase 2L STAGE F)', () => {
  it('gives every card action a role, label and state', async () => {
    setup({ rows: [PUSH_DAY], drafts: { r1: makeDraft('r1', 'Push day', ['Bench Press']) } });
    const renderer = await renderScreen();

    const expected: Record<string, string> = {
      'routine-preview-r1': `${strings.routines.previewAction} Push day`,
      'routine-start-r1': `${strings.routines.start} Push day`,
      'routine-edit-r1': `${strings.common.edit} Push day`,
      'routine-delete-r1': `${strings.common.delete} Push day`,
      'routine-open-r1': `${strings.common.edit} Push day`,
      'routines-new': strings.routines.newRoutine,
    };
    for (const [testID, label] of Object.entries(expected)) {
      const node = actionNode(renderer, testID);
      expect(node.props.accessibilityRole).toBe('button');
      expect(node.props.accessibilityLabel).toBe(label);
      expect(node.props.accessibilityState).toEqual({ disabled: false });
    }
  });

  it('disables the start action while the session is being created', async () => {
    setup({ rows: [PUSH_DAY], drafts: { r1: makeDraft('r1', 'Push day', ['Bench Press']) } });
    let resolveStart: (value: string) => void = () => undefined;
    mockedStartWorkoutSession.mockReturnValue(new Promise<string>((resolve) => (resolveStart = resolve)));
    const renderer = await renderScreen();

    await press(renderer, 'routine-start-r1');

    const pending = actionNode(renderer, 'routine-start-r1');
    expect(pending.props.accessibilityState).toEqual({ disabled: true });
    expect(pending.props.disabled).toBe(true);
    expect(nodesByTestId(renderer, 'workout-route')).toHaveLength(0);

    await act(async () => {
      resolveStart('sess-1');
    });
    await act(async () => {});

    expect(nodesByTestId(renderer, 'workout-route').length).toBeGreaterThanOrEqual(1);
  });
});
