import React from 'react';
import { Alert, Modal, Text } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { database } from '../../data';
import { strings } from '../../constants/strings';
import { loadSessionDetail, type HistoryDetail } from '../../data/history';
import { saveSessionNote } from '../../data/notes';
import {
  applyWorkoutEvent,
  discardWorkout,
  isTimerExpired,
  loadActiveWorkout,
  reconcileTimerNotification,
  type WorkoutRuntime,
} from '../../workout/runner';
import type { ExecutionCursor, RoutineDefinition, TimerState } from '../../types/engine';
import {
  WorkoutScreen,
  prescriptionParts,
  prescriptionSummary,
  setPositionLabel,
  stepPositionLabel,
} from './WorkoutScreen';

jest.mock('../../data', () => ({ database: {} }));
const mockSubstitute = jest.fn(async () => 'se1');
jest.mock('../../data/actions', () => ({
  makeDbActions: () => ({ substituteSessionExercise: mockSubstitute }),
}));
jest.mock('./ExercisePickerScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    ExercisePickerScreen: ({ onPick, onCancel }: { onPick: (id: string, name: string) => void; onCancel: () => void }) => (
      <>
        <Text testID="mock-picker-pick" onPress={() => onPick('ex-db', 'DB Press')}>
          pick
        </Text>
        <Text testID="mock-picker-cancel" onPress={onCancel}>
          cancel
        </Text>
      </>
    ),
  };
});
jest.mock('../../workout/runner', () => ({
  loadActiveWorkout: jest.fn(),
  loadWorkoutRuntime: jest.fn(),
  applyWorkoutEvent: jest.fn(),
  discardWorkout: jest.fn(),
  isTimerExpired: jest.fn(),
  reconcileTimerNotification: jest.fn(),
}));
jest.mock('../../data/history', () => ({ loadSessionDetail: jest.fn() }));
jest.mock('../../data/notes', () => ({ saveSessionNote: jest.fn() }));
jest.mock('../../data/progression', () => ({
  loadProgressionSnapshot: jest.fn(),
  analyzeStepEvidence: jest.fn(),
  summarizeProgression: jest.fn(),
  progressionInputFor: jest.fn(),
  latestPrescriptionFor: jest.fn(),
}));
jest.mock('../navigation', () => {
  const nav = {
    route: { name: 'workout' },
    depth: 2,
    tab: 'train',
    push: jest.fn(),
    pop: jest.fn(),
    selectTab: jest.fn(),
    startWorkout: jest.fn(),
    setBackInterceptor: jest.fn(),
  };
  return { useNav: jest.fn(() => nav), __nav: nav };
});

import { loadProgressionSnapshot, analyzeStepEvidence } from '../../data/progression';
import type { ProgressionEvidence } from '../../analytics/progression';

const mockedProgSnap = loadProgressionSnapshot as jest.MockedFunction<typeof loadProgressionSnapshot>;
const mockedStepEvidence = analyzeStepEvidence as jest.MockedFunction<typeof analyzeStepEvidence>;

const mockedLoad = loadActiveWorkout as jest.MockedFunction<typeof loadActiveWorkout>;
const mockedApply = applyWorkoutEvent as jest.MockedFunction<typeof applyWorkoutEvent>;
const mockedDiscard = discardWorkout as jest.MockedFunction<typeof discardWorkout>;
const mockedDetail = loadSessionDetail as jest.MockedFunction<typeof loadSessionDetail>;
const mockedNote = saveSessionNote as jest.MockedFunction<typeof saveSessionNote>;
const mockedReconcile = reconcileTimerNotification as jest.MockedFunction<typeof reconcileTimerNotification>;
const mockedExpired = isTimerExpired as jest.MockedFunction<typeof isTimerExpired>;

interface NavMock {
  pop: jest.Mock;
  push: jest.Mock;
  selectTab: jest.Mock;
  startWorkout: jest.Mock;
  setBackInterceptor: jest.Mock;
}

function navMock(): NavMock {
  return (jest.requireMock('../navigation') as { __nav: NavMock }).__nav;
}

/* ---------------------------------------------------------------- fixtures */

const START = 1_700_000_000_000;

const prescription = {
  targetSets: 3,
  targetRepsMin: 5,
  targetRepsMax: null,
  targetDurationMs: null,
  targetWeightGrams: 60_000,
  targetRir: 2,
  tempo: { eccentricMs: null, pauseBottomMs: null, concentricMs: null, pauseTopMs: null },
};

const definition: RoutineDefinition = {
  id: 'r1',
  name: 'Push Day',
  blocks: [
    {
      id: 'b1',
      name: 'Main',
      kind: 'normal',
      rounds: 1,
      steps: [
        { id: 's1', role: 'work', exerciseId: null, exerciseName: 'Bench Press', prescription },
        {
          id: 's2',
          role: 'work',
          exerciseId: null,
          exerciseName: 'Overhead Press',
          prescription: { ...prescription, targetSets: 2 },
        },
      ],
      transitions: [],
    },
  ],
};

const emptyDefinition: RoutineDefinition = {
  id: 'r-empty',
  name: 'Empty Day',
  blocks: [{ id: 'b1', name: 'Main', kind: 'normal', rounds: 1, steps: [], transitions: [] }],
};

const activeCursor = (over: Partial<ExecutionCursor> = {}): ExecutionCursor => ({
  blockIndex: 0,
  stepIndex: 0,
  round: 1,
  setIndex: 1,
  status: 'active',
  timer: null,
  lastReversible: null,
  startedAt: START,
  ...over,
});

const restTimer = (expiresAt: number, over: Partial<TimerState> = {}): TimerState => ({
  kind: 'rest',
  durationMs: 90_000,
  expiresAt,
  target: { blockIndex: 0, stepIndex: 0, round: 1, setIndex: 2 },
  pausedAt: null,
  ...over,
});

interface FakeSession {
  id: string;
  update: jest.Mock;
  rec: { cursorJson: string; updatedAt: number };
}

function makeSession(): FakeSession {
  const rec = { cursorJson: '', updatedAt: 0 };
  const update = jest.fn((mutate: (r: typeof rec) => void | Promise<void>) => {
    void mutate(rec);
    return Promise.resolve();
  });
  return { id: 'sess_1', update, rec };
}

function makeRuntime(
  opts: { cursor?: ExecutionCursor; definition?: RoutineDefinition; session?: FakeSession; sessionId?: string } = {},
): WorkoutRuntime {
  return {
    sessionId: opts.sessionId ?? 'sess_1',
    session: (opts.session ?? makeSession()) as unknown as WorkoutRuntime['session'],
    definition: opts.definition ?? definition,
    cursor: opts.cursor ?? activeCursor(),
  };
}

const detailFixture: HistoryDetail = {
  id: 'sess_1',
  name: 'Push Day',
  startedAt: START,
  endedAt: START + 600_000,
  durationMs: 600_000,
  status: 'completed',
incompleteReason: null,
  note: '',
  definition,
  blocks: [
    {
      blockIndex: 0,
      name: 'Main',
      kind: 'normal',
      role: null,
      rounds: 1,
      steps: [
        {
          stepIndex: 0,
          exerciseName: 'Bench Press',
          targetSets: 3,
          targetRepsMin: 5,
          targetRepsMax: null,
          targetWeightGrams: 60_000,
          targetDurationMs: null,
          targetRir: 2,
          logs: [
            {
              blockIndex: 0,
              stepIndex: 0,
              round: 1,
              setIndex: 1,
              weightGrams: 60_000,
              reps: 5,
              durationMs: null,
              rir: 2,
            },
          ],
          skipped: [],
            exerciseNote: null,
            substitution: null,
        },
      ],
    },
  ],
  totalCompletedSets: 1,
};

/* ------------------------------------------------------------- render + DOM */

let mounted: ReactTestRenderer | null = null;
let alertSpy: jest.SpyInstance | null = null;

async function renderWorkout(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<WorkoutScreen />);
  });
  await act(async () => {});
  mounted = renderer;
  return renderer;
}

async function unmountWorkout(renderer: ReactTestRenderer): Promise<void> {
  await act(async () => {
    renderer.unmount();
  });
  if (mounted === renderer) mounted = null;
}

function flatten(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(flatten).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return '';
}

function textsOf(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByType(Text).map((node) => flatten(node.props.children));
}

function nodesWith(renderer: ReactTestRenderer, props: Record<string, unknown>) {
  return renderer.root.findAll(
    (node) =>
      typeof node.type === 'string' &&
      Object.entries(props).every(([key, value]) => node.props?.[key] === value),
  );
}

function nodeWith(renderer: ReactTestRenderer, props: Record<string, unknown>) {
  const node = nodesWith(renderer, props).pop();
  expect(node).toBeDefined();
  return node!;
}

function textOf(renderer: ReactTestRenderer, testID: string): string {
  return flatten(nodeWith(renderer, { testID }).props.children);
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

function pressByTestID(renderer: ReactTestRenderer, testID: string) {
  const node = renderer.root
    .findAll((n) => n.props?.testID === testID && typeof n.props?.onPress === 'function')
    .shift();
  expect(node).toBeDefined();
  return node!;
}

function fieldDisplay(renderer: ReactTestRenderer, testID: string): string {
  const node = renderer.root
    .findAll((n) => n.props?.testID === testID && typeof n.props?.display === 'string')
    .shift();
  expect(node).toBeDefined();
  return node!.props.display as string;
}

async function pressButton(renderer: ReactTestRenderer, label: string): Promise<void> {
  const node = buttonByLabel(renderer, label);
  await act(async () => {
    node.props.onPress();
  });
}

/* ----------------------------------------------------------------- lifecycle */

beforeEach(() => {
  jest.clearAllMocks();
  mockedLoad.mockResolvedValue(makeRuntime());
  mockedApply.mockResolvedValue(makeRuntime());
  mockedDiscard.mockResolvedValue(undefined);
  mockedDetail.mockResolvedValue(detailFixture);
  mockedNote.mockResolvedValue('');
  mockedReconcile.mockResolvedValue(undefined);
  // Phase 3B defaults: no analyzable progression unless a test opts in.
  mockedProgSnap.mockResolvedValue({
    analytics: { sessions: [], exercises: [] },
    timestamps: new Map(),
    historicalPrescriptions: new Map(),
    equipmentItems: [],
  });
  mockedStepEvidence.mockReturnValue(null);
  mockedExpired.mockReturnValue(false);
});

afterEach(async () => {
  if (alertSpy) {
    alertSpy.mockRestore();
    alertSpy = null;
  }
  if (mounted) {
    const renderer = mounted;
    mounted = null;
    await act(async () => {
      renderer.unmount();
    });
  }
  jest.useRealTimers();
});

/* --------------------------------------------------------------------- tests */

describe('WorkoutScreen step hierarchy (Phase 2L STAGE G)', () => {
  it('renders the current exercise with block, step and round position', async () => {
    const renderer = await renderWorkout();

    expect(textsOf(renderer)).toContain('Bench Press');

    const header = nodeWith(renderer, { testID: 'step-header' });
    expect(header.props.accessibilityRole).toBe('header');
    expect(header.props.accessibilityLiveRegion).toBe('polite');
    expect(header.props.accessibilityLabel).toBe(
      `Bench Press, ${strings.routines.step} 1/2`,
    );

    expect(textOf(renderer, 'step-position')).toBe(`${strings.routines.step} 1/2`);
    expect(textOf(renderer, 'set-position')).toBe(`${strings.workout.set} 1 ${strings.workout.of} 3`);

    const blockLine = textsOf(renderer).find((t) => t.startsWith(`${strings.workout.block} `));
    expect(blockLine).toBe(`${strings.workout.block} 1/1 · Main`);
    expect(textsOf(renderer).some((t) => t === `${strings.workout.round} 1/1`)).toBe(true);
  });

  it('keeps the prescription visible while logging (tiles + inline target strip)', async () => {
    const renderer = await renderWorkout();
    const texts = textsOf(renderer);

    expect(texts).toContain(strings.routines.prescription.sets);
    expect(texts).toContain(strings.routines.prescription.reps);
    expect(texts).toContain(strings.workout.rir);
    expect(texts).toContain('0-0-0-0'); // tempo tile from the step prescription
    // Inline strip sits next to the Actual fields (sets × reps @ weight RIR).
    expect(textOf(renderer, 'target-summary')).toBe('3 × 5 @ 60 kg RIR 2');

    const tile = nodeWith(renderer, { testID: 'field-weight' });
    expect(tile.props.accessibilityState).toEqual({ selected: true });
    expect(fieldDisplay(renderer, 'field-weight')).toBe('60');
    expect(fieldDisplay(renderer, 'field-reps')).toBe('5');
  });

  it('shows session progress as completed vs total planned sets', async () => {
    const renderer = await renderWorkout();

    expect(textOf(renderer, 'session-progress-count')).toBe(`0/5 ${strings.workout.plannedSets}`);
    const bar = nodeWith(renderer, { testID: 'session-progress' });
    expect(bar.props.accessibilityRole).toBe('progressbar');
    expect(bar.props.accessibilityValue).toEqual({
      min: 0,
      max: 100,
      now: 0,
      text: `0 ${strings.workout.of} 5 ${strings.workout.plannedSets}`,
    });
  });

  it('renders the empty state when the routine has no steps', async () => {
    mockedLoad.mockResolvedValue(makeRuntime({ definition: emptyDefinition }));
    const renderer = await renderWorkout();

    expect(textsOf(renderer)).toContain(strings.workout.emptyRoutine);
    expect(nodesWith(renderer, { testID: 'step-header' })).toHaveLength(0);
    expect(nodesWith(renderer, { testID: 'session-progress-panel' })).toHaveLength(0);
    expect(nodesWith(renderer, { testID: 'athlete-numpad' })).toHaveLength(0);
  });
});

describe('WorkoutScreen set logging (mocked runner)', () => {
  it('dispatches COMPLETE_SET with the entered payload and advances the counts', async () => {
    const after = makeRuntime({
      cursor: activeCursor({
        setIndex: 2,
        timer: restTimer(Date.now() + 90_000),
        lastReversible: {
          kind: 'set',
          setLogId: 'log_1',
          blockIndex: 0,
          stepIndex: 0,
          round: 1,
          setIndex: 1,
        },
      }),
    });
    mockedApply.mockResolvedValue(after);
    const renderer = await renderWorkout();

    await pressButton(renderer, strings.workout.completeSet);

    expect(mockedApply).toHaveBeenCalledTimes(1);
    expect(mockedApply).toHaveBeenCalledWith(
      database,
      expect.anything(),
      expect.objectContaining({
        type: 'COMPLETE_SET',
        set: { weightGrams: 60_000, reps: 5, durationMs: null, distanceMm: null, rir: 2, overrideReason: null },
      }),
    );

    expect(textOf(renderer, 'set-position')).toBe(`${strings.workout.set} 2 ${strings.workout.of} 3`);
    expect(textOf(renderer, 'session-progress-count')).toBe(`1/5 ${strings.workout.plannedSets}`);
    expect(nodeWith(renderer, { testID: 'session-progress' }).props.accessibilityValue).toEqual({
      min: 0,
      max: 100,
      now: 20,
      text: `1 ${strings.workout.of} 5 ${strings.workout.plannedSets}`,
    });
    // Undo only becomes available after a logged set (runner-provided cursor).
    expect(buttonByLabel(renderer, strings.workout.undo).props.disabled).toBe(false);
  });
});

describe('WorkoutScreen adaptive execution (Phase 3C)', () => {
  it('dispatches SKIP_SET and keeps the step when skipping the current set', async () => {
    mockedApply.mockResolvedValue(makeRuntime());
    const renderer = await renderWorkout();

    await pressButton(renderer, strings.workout.skipSet);

    expect(mockedApply).toHaveBeenCalledTimes(1);
    expect(mockedApply).toHaveBeenCalledWith(
      database,
      expect.anything(),
      expect.objectContaining({ type: 'SKIP_SET' }),
    );
  });

  it('dispatches LOG_EXTRA_SET as extra with the current inputs and no reason by default', async () => {
    mockedApply.mockResolvedValue(makeRuntime());
    const renderer = await renderWorkout();

    await pressButton(renderer, strings.workout.extraSet);

    expect(mockedApply).toHaveBeenCalledTimes(1);
    expect(mockedApply).toHaveBeenCalledWith(
      database,
      expect.anything(),
      expect.objectContaining({
        type: 'LOG_EXTRA_SET',
        executionType: 'extra',
        set: { weightGrams: 60_000, reps: 5, durationMs: null, distanceMm: null, rir: 2, overrideReason: null },
      }),
    );
  });

  it('dispatches LOG_EXTRA_SET as drop', async () => {
    mockedApply.mockResolvedValue(makeRuntime());
    const renderer = await renderWorkout();

    await pressButton(renderer, strings.workout.dropSet);

    expect(mockedApply).toHaveBeenCalledWith(
      database,
      expect.anything(),
      expect.objectContaining({ type: 'LOG_EXTRA_SET', executionType: 'drop' }),
    );
  });

  it('hides the reason row while inputs match the prescription', async () => {
    const renderer = await renderWorkout();
    expect(nodesWith(renderer, { testID: 'override-reasons' })).toHaveLength(0);
  });

  it('shows reason chips when inputs differ and attaches the chosen reason', async () => {
    mockedApply.mockResolvedValue(makeRuntime());
    const renderer = await renderWorkout();

    // Diverge weight 60 → 55 so the set counts as modified.
    await act(async () => {
      pressByTestID(renderer, 'key-clear').props.onPress();
    });
    await act(async () => {
      pressByTestID(renderer, 'key-5').props.onPress();
    });
    await act(async () => {
      pressByTestID(renderer, 'key-5').props.onPress();
    });
    expect(fieldDisplay(renderer, 'field-weight')).toBe('55');
    expect(nodesWith(renderer, { testID: 'override-reasons' })).toHaveLength(1);
    expect(pressByTestID(renderer, 'reason-load_reduced')).toBeDefined();

    await act(async () => {
      pressByTestID(renderer, 'reason-load_reduced').props.onPress();
    });
    await pressButton(renderer, strings.workout.completeSet);

    expect(mockedApply).toHaveBeenCalledWith(
      database,
      expect.anything(),
      expect.objectContaining({
        type: 'COMPLETE_SET',
        set: {
          weightGrams: 55_000,
          reps: 5,
          durationMs: null,
          distanceMm: null,
          rir: 2,
          overrideReason: 'load_reduced',
        },
      }),
    );
  });

  it('toggling a selected reason clears it', async () => {
    const renderer = await renderWorkout();

    await act(async () => {
      pressByTestID(renderer, 'key-clear').props.onPress();
    });
    await act(async () => {
      pressByTestID(renderer, 'key-5').props.onPress();
    });
    expect(nodesWith(renderer, { testID: 'override-reasons' })).toHaveLength(1);

    const chip = (reason: string) => pressByTestID(renderer, `reason-${reason}`);
    expect(chip('load_reduced').props.accessibilityState).toEqual({ checked: false });
    await act(async () => {
      chip('load_reduced').props.onPress();
    });
    expect(pressByTestID(renderer, 'reason-load_reduced').props.accessibilityState).toEqual({
      checked: true,
    });
    await act(async () => {
      pressByTestID(renderer, 'reason-load_reduced').props.onPress();
    });
    expect(pressByTestID(renderer, 'reason-load_reduced').props.accessibilityState).toEqual({
      checked: false,
    });
  });
});

describe('WorkoutScreen rest timer', () => {
  it('shows a labelled countdown state with controls after a logged set', async () => {
    jest.useFakeTimers();
    const expiresAt = Date.now() + 90_000;
    mockedApply.mockResolvedValue(
      makeRuntime({ cursor: activeCursor({ setIndex: 2, timer: restTimer(expiresAt) }) }),
    );
    const renderer = await renderWorkout();

    await pressButton(renderer, strings.workout.completeSet);

    expect(nodesWith(renderer, { testID: 'rest-card' })).toHaveLength(1);
    expect(textOf(renderer, 'rest-countdown')).toBe('01:30');
    expect(textOf(renderer, 'rest-state-dot')).toBe('');

    const countdown = nodeWith(renderer, { testID: 'rest-countdown' });
    expect(countdown.props.accessibilityRole).toBe('timer');
    expect(countdown.props.accessibilityLiveRegion).toBe('polite');
    expect(countdown.props.accessibilityValue).toEqual({ text: '01:30' });
    expect(countdown.props.accessibilityLabel).toBe(`${strings.timer.rest} 01:30`);

    expect(textsOf(renderer)).toContain(strings.timer.rest);
    expect(textsOf(renderer).some((t) => t.startsWith(`${strings.workout.nextUp}:`))).toBe(true);
    expect(buttonByLabel(renderer, strings.workout.pause).props.accessibilityLabel).toBe(
      strings.workout.pause,
    );
    expect(buttonByLabel(renderer, strings.workout.skipRest)).toBeDefined();
    // Rest owns the bottom edge: the athlete numpad is hidden while resting.
    expect(nodesWith(renderer, { testID: 'athlete-numpad' })).toHaveLength(0);
  });

  it('ticks the countdown down from the canonical expiry', async () => {
    jest.useFakeTimers();
    const expiresAt = Date.now() + 90_000;
    mockedApply.mockResolvedValue(
      makeRuntime({ cursor: activeCursor({ setIndex: 2, timer: restTimer(expiresAt) }) }),
    );
    const renderer = await renderWorkout();

    await pressButton(renderer, strings.workout.completeSet);
    expect(textOf(renderer, 'rest-countdown')).toBe('01:30');

    await act(async () => {
      jest.advanceTimersByTime(5_000);
    });
    expect(textOf(renderer, 'rest-countdown')).toBe('01:25');
  });

  it('freezes the countdown while paused and resumes from the canonical cursor', async () => {
    jest.useFakeTimers();
    const session = makeSession();
    const runtime = makeRuntime({
      session,
      cursor: activeCursor({ timer: restTimer(Date.now() + 90_000) }),
    });
    mockedLoad.mockResolvedValue(runtime);
    const renderer = await renderWorkout();

    expect(textOf(renderer, 'rest-countdown')).toBe('01:30');
    expect(nodesWith(renderer, { testID: 'rest-paused' })).toHaveLength(0);

    await pressButton(renderer, strings.workout.pause);
    expect(nodesWith(renderer, { testID: 'rest-paused' })).toHaveLength(1);
    expect(buttonByLabel(renderer, strings.workout.resume)).toBeDefined();

    // Pause is an application-layer write to the canonical cursor — no second source.
    const written = JSON.parse(session.rec.cursorJson) as ExecutionCursor;
    expect(typeof written.timer?.pausedAt).toBe('number');

    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });
    expect(textOf(renderer, 'rest-countdown')).toBe('01:30'); // frozen

    await pressButton(renderer, strings.workout.resume);
    expect(nodesWith(renderer, { testID: 'rest-paused' })).toHaveLength(0);
    expect(buttonByLabel(renderer, strings.workout.pause)).toBeDefined();
    expect(textOf(renderer, 'rest-countdown')).toBe('01:30');
  });
});

describe('WorkoutScreen finish and discard paths', () => {
  it('confirms before finishing, then shows the saved-session summary', async () => {
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const renderer = await renderWorkout();

    await pressButton(renderer, strings.workout.finish);

    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [title, message, buttons] = alertSpy.mock.calls[0] as unknown as [
      string,
      string,
      Array<{ text: string; onPress?: () => void }>,
    ];
    expect(title).toBe(strings.workout.finish);
    expect(message).toBe(strings.workout.finishConfirm);
    const confirm = buttons.find((b) => b.text === strings.workout.finish);
    expect(confirm).toBeDefined();

    mockedApply.mockResolvedValue(
      makeRuntime({ cursor: activeCursor({ status: 'completed',
incompleteReason: null, timer: null, lastReversible: null }) }),
    );
    await act(async () => {
      confirm!.onPress!();
    });

    expect(mockedApply).toHaveBeenCalledWith(
      database,
      expect.anything(),
      expect.objectContaining({ type: 'COMPLETE_SESSION' }),
    );
    const texts = textsOf(renderer);
    expect(texts).toContain(strings.workout.sessionSaved);
    expect(texts).toContain(strings.workout.summary);
    expect(texts).toContain(strings.load.kgReps);
    expect(texts).toContain('300'); // 60 kg × 5 reps → 300 kg·reps
    expect(texts).toContain(strings.notes.label);
    expect(buttonByLabel(renderer, strings.common.done)).toBeDefined();
    expect(nodesWith(renderer, { testID: 'athlete-numpad' })).toHaveLength(0);
  });

  it('lands on the summary when the last set completes the session (no dialog)', async () => {
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockedApply.mockResolvedValue(
      makeRuntime({ cursor: activeCursor({ status: 'completed',
incompleteReason: null, timer: null }) }),
    );
    const renderer = await renderWorkout();

    await pressButton(renderer, strings.workout.completeSet);

    expect(alertSpy).not.toHaveBeenCalled();
    expect(textsOf(renderer)).toContain(strings.workout.sessionSaved);
    expect(mockedNote).not.toHaveBeenCalled(); // note is only written on Done
    expect(buttonByLabel(renderer, strings.common.done)).toBeDefined();
  });

  it('confirms before discarding and then leaves the screen', async () => {
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const nav = navMock();
    const renderer = await renderWorkout();

    await pressButton(renderer, strings.workout.discard);

    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [title, message, buttons] = alertSpy.mock.calls[0] as unknown as [
      string,
      string,
      Array<{ text: string; style?: string; onPress?: () => void }>,
    ];
    expect(title).toBe(strings.common.delete);
    expect(message).toBe(strings.workout.discardConfirm);
    const confirm = buttons.find((b) => b.style === 'destructive');
    expect(confirm).toBeDefined();

    mockedDiscard.mockResolvedValue(undefined);
    await act(async () => {
      confirm!.onPress!();
    });

    expect(mockedDiscard).toHaveBeenCalledTimes(1);
    expect(mockedDiscard.mock.calls[0][0]).toBe(database);
    expect(nav.pop).toHaveBeenCalledTimes(1);
  });
});

describe('WorkoutScreen numpad accessibility', () => {
  it('exposes button roles and labels on every key', async () => {
    const renderer = await renderWorkout();

    expect(nodesWith(renderer, { testID: 'athlete-numpad' })).toHaveLength(1);

    for (const key of ['7', '8', '9', '4', '5', '6', '1', '2', '3', '0', '.']) {
      const node = nodeWith(renderer, { testID: `key-${key}` });
      expect(node.props.accessibilityRole).toBe('button');
      expect(node.props.accessibilityLabel).toBe(key);
    }
    expect(nodeWith(renderer, { testID: 'key-clear' }).props.accessibilityLabel).toBe(
      strings.numpad.clear,
    );
    expect(nodeWith(renderer, { testID: 'key-backspace' }).props.accessibilityLabel).toBe(
      strings.numpad.backspace,
    );
    expect(nodeWith(renderer, { testID: 'mod-kg+1.25' }).props.accessibilityLabel).toBe(
      `${strings.numpad.modifierPrefix} +1.25`,
    );

    expect(nodeWith(renderer, { testID: 'field-weight' }).props.accessibilityState).toEqual({
      selected: true,
    });
    expect(nodeWith(renderer, { testID: 'field-rir' }).props.accessibilityState).toEqual({
      selected: false,
    });
    expect(nodeWith(renderer, { testID: 'field-rir' }).props.accessibilityRole).toBe('button');
  });

  it('edits the active field through the numpad keys', async () => {
    const renderer = await renderWorkout();
    expect(fieldDisplay(renderer, 'field-weight')).toBe('60');

    await act(async () => {
      pressByTestID(renderer, 'key-7').props.onPress();
    });
    expect(fieldDisplay(renderer, 'field-weight')).toBe('607');

    await act(async () => {
      pressByTestID(renderer, 'key-backspace').props.onPress();
    });
    expect(fieldDisplay(renderer, 'field-weight')).toBe('60');
  });
});

describe('WorkoutScreen back interception and load resilience', () => {
  it('registers a back interceptor for the immersive route and clears it on unmount', async () => {
    const nav = navMock();
    const renderer = await renderWorkout();

    expect(nav.setBackInterceptor).toHaveBeenCalled();
    const calls = nav.setBackInterceptor.mock.calls;
    const registered = calls[calls.length - 1][0] as () => boolean;
    expect(typeof registered).toBe('function');
    // Keep the session alive: the interceptor never swallows system back.
    expect(registered()).toBe(false);

    await unmountWorkout(renderer);
    expect(nav.setBackInterceptor).toHaveBeenLastCalledWith(null);
  });

  it('surfaces a load failure and recovers through the retry action', async () => {
    let attempts = 0;
    mockedLoad.mockImplementation(() => {
      attempts += 1;
      return attempts === 1 ? Promise.reject(new Error('boom')) : Promise.resolve(makeRuntime());
    });
    const renderer = await renderWorkout();

    expect(textsOf(renderer)).toContain('boom');
    expect(buttonByLabel(renderer, strings.common.retry)).toBeDefined();

    await pressButton(renderer, strings.common.retry);
    expect(mockedLoad).toHaveBeenCalledTimes(2);
    expect(textsOf(renderer)).toContain('Bench Press');
  });
});

describe('WorkoutScreen view-model helpers', () => {
  it('formats step, set and prescription labels from strings keys', () => {
    expect(stepPositionLabel(1, 4)).toBe(`${strings.routines.step} 2/4`);
    expect(stepPositionLabel(0, 0)).toBe('');
    expect(setPositionLabel(1, 3)).toBe(`${strings.workout.set} 1 ${strings.workout.of} 3`);
    expect(setPositionLabel(9, 3)).toBe(`${strings.workout.set} 3 ${strings.workout.of} 3`);

    expect(prescriptionParts(prescription)).toEqual(['3 ×', '5', '@ 60 kg', 'RIR 2']);
    expect(prescriptionSummary(prescription)).toBe('3 × 5 @ 60 kg RIR 2');
    expect(
      prescriptionSummary({
        ...prescription,
        targetSets: null,
        targetRepsMin: null,
        targetWeightGrams: null,
        targetRir: null,
      }),
    ).toBe(strings.common.none);
  });
});

describe('WorkoutScreen post-workout progression (Phase 3B)', () => {
  const postEvidence: ProgressionEvidence = {
    state: 'progress',
    reason: 'REPS_RANGE_COMPLETED',
    explanation: 'test-only',
    baseline: {
      exerciseName: 'Bench Press',
      exerciseId: null,
      timestampMs: START - 86_400_000,
      sessionId: 's0',
      weightGrams: 60_000,
      reps: 5,
      actualRir: null,
      actualTempo: null,
      equipmentClass: 'barbell',
      isSubstitution: false,
      prescription,
      estimated1rmGrams: null,
    },
    current: {
      exerciseName: 'Bench Press',
      exerciseId: null,
      timestampMs: START,
      sessionId: 'sess_1',
      weightGrams: 60_000,
      reps: 5,
      actualRir: null,
      actualTempo: null,
      equipmentClass: 'barbell',
      isSubstitution: false,
      prescription,
      estimated1rmGrams: null,
    },
    comparableCount: 2,
    currentPrescription: prescription,
    comparability: {
      comparable: true,
      mismatches: [],
      identityMatch: 'name_only',
      prescriptionMatch: true,
      equipmentMatch: true,
      rirAvailable: false,
      tempoAvailable: false,
    },
    atTargetWeight: true,
    repsVsRange: { achieved: 5, min: 5, max: 5 },
    suggestedWeightGrams: undefined,
    weightIncrementSource: 'none',
  };

  it('shows the engine verdict for the trained exercise after completion', async () => {
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockedStepEvidence.mockReturnValue(postEvidence);
    const renderer = await renderWorkout();

    await pressButton(renderer, strings.workout.finish);
    const [, , buttons] = alertSpy.mock.calls[0] as unknown as [
      string,
      string,
      Array<{ text: string; onPress?: () => void }>,
    ];
    mockedApply.mockResolvedValue(
      makeRuntime({ cursor: activeCursor({ status: 'completed',
incompleteReason: null, timer: null, lastReversible: null }) }),
    );
    await act(async () => {
      buttons.find((b) => b.text === strings.workout.finish)!.onPress!();
    });

    expect(renderer.root.findAllByProps({ testID: 'post-progression-0' }).length).toBeGreaterThanOrEqual(1);
    const texts = textsOf(renderer);
    expect(texts).toContain(strings.progression.stateProgress);
  });

  it('shows no progression section when the engine has no comparable evidence', async () => {
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const renderer = await renderWorkout();

    await pressButton(renderer, strings.workout.finish);
    const [, , buttons] = alertSpy.mock.calls[0] as unknown as [
      string,
      string,
      Array<{ text: string; onPress?: () => void }>,
    ];
    mockedApply.mockResolvedValue(
      makeRuntime({ cursor: activeCursor({ status: 'completed',
incompleteReason: null, timer: null, lastReversible: null }) }),
    );
    await act(async () => {
      buttons.find((b) => b.text === strings.workout.finish)!.onPress!();
    });

    expect(renderer.root.findAllByProps({ testID: 'post-progression-0' })).toHaveLength(0);
    expect(textsOf(renderer)).toContain(strings.workout.sessionSaved);
  });
});

describe('WorkoutScreen stop-early and substitution (1.1.0)', () => {
  function openModal(renderer: ReactTestRenderer) {
    const modal = renderer.root.findAllByType(Modal).find((m) => m.props.visible);
    expect(modal).toBeDefined();
    return modal!;
  }

  function chipIn(modal: ReactTestInstance, label: string) {
    const node = modal
      .findAll(
        (n) =>
          typeof n.props?.onPress === 'function' &&
          n.findAllByType(Text).some((t) => flatten(t.props.children) === label),
      )
      .pop();
    expect(node).toBeDefined();
    return node!;
  }

  function pressableByTestID(renderer: ReactTestRenderer, testID: string) {
    const node = renderer.root
      .findAll((n) => n.props?.testID === testID && typeof n.props?.onPress === 'function')
      .shift();
    expect(node).toBeDefined();
    return node!;
  }

  function modalButton(modal: ReactTestInstance, label: string) {
    const node = modal
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

  async function openEndReasonModal(renderer: ReactTestRenderer) {
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await pressButton(renderer, strings.workout.finish);
    const [, , buttons] = alertSpy.mock.calls[0] as unknown as [
      string,
      string,
      Array<{ text: string; onPress?: () => void }>,
    ];
    const stopEarly = buttons.find((b) => b.text === strings.workout.finishEarly);
    expect(stopEarly).toBeDefined();
    await act(async () => {
      stopEarly!.onPress!();
    });
  }

  it('offers Stop early with all eight reasons; confirm dispatches the reason', async () => {
    const renderer = await renderWorkout();
    await openEndReasonModal(renderer);
    expect(textsOf(renderer)).toContain(strings.workout.finishEarlyTitle);
    expect(textsOf(renderer)).toContain(strings.workout.finishEarlyBody);
    const modal = openModal(renderer);
    const labels = [
      strings.sessionEnd.userStopped,
      strings.sessionEnd.timeConstraint,
      strings.sessionEnd.fatigue,
      strings.sessionEnd.pain,
      strings.sessionEnd.equipmentUnavailable,
      strings.sessionEnd.interruption,
      strings.sessionEnd.technicalIssue,
      strings.sessionEnd.other,
    ];
    for (const label of labels) chipIn(modal, label);
    const confirm = buttonByLabel(renderer, strings.workout.finishEarly);
    expect(confirm.props.disabled).toBe(true);
    await act(async () => {
      chipIn(modal, strings.sessionEnd.fatigue).props.onPress();
    });
    expect(buttonByLabel(renderer, strings.workout.finishEarly).props.disabled).toBe(false);
    await pressButton(renderer, strings.workout.finishEarly);
    expect(mockedApply).toHaveBeenCalledWith(
      database,
      expect.anything(),
      expect.objectContaining({ type: 'COMPLETE_SESSION', incompleteReason: 'fatigue' }),
    );
    await unmountWorkout(renderer);
  });

  it('substitution flow picks an exercise, a reason, and records actuals', async () => {
    const renderer = await renderWorkout();
    const swap = pressableByTestID(renderer, 'step-substitute');
    await act(async () => {
      swap.props.onPress();
    });
    // Picker phase: no reason modal yet.
    expect(textsOf(renderer)).not.toContain(strings.workout.substituteTitle);
    expect(renderer.root.findAllByProps({ testID: 'mock-picker-pick' }).length).toBeGreaterThanOrEqual(1);
    await act(async () => {
      renderer.root.findAllByProps({ testID: 'mock-picker-pick' })[0].props.onPress();
    });
    expect(textsOf(renderer)).toContain(strings.workout.substituteTitle);
    const modal = openModal(renderer);
    await act(async () => {
      chipIn(modal, strings.workout.reasonEquipment).props.onPress();
    });
    await act(async () => {
      modalButton(modal, strings.workout.substitute).props.onPress();
    });
    expect(mockSubstitute).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Number),
      expect.any(Number),
      'Bench Press',
      'ex-db',
      'DB Press',
      'equipment_unavailable',
    );
    expect(textsOf(renderer)).toContain('DB Press');
    expect(renderer.root.findAllByProps({ testID: 'step-substituted' }).length).toBeGreaterThanOrEqual(1);
    await unmountWorkout(renderer);
  });

  it('cancelling the picker records nothing', async () => {
    const renderer = await renderWorkout();
    const swap = pressableByTestID(renderer, 'step-substitute');
    await act(async () => {
      swap.props.onPress();
    });
    await act(async () => {
      renderer.root.findAllByProps({ testID: 'mock-picker-cancel' })[0].props.onPress();
    });
    expect(mockSubstitute).not.toHaveBeenCalled();
    expect(renderer.root.findAllByProps({ testID: 'mock-picker-pick' })).toHaveLength(0);
    await unmountWorkout(renderer);
  });
});
