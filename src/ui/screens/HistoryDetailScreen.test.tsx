import React from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Navigator } from '../navigation';
import { HistoryDetailScreen } from './HistoryDetailScreen';
import { strings, setStringsLocale, getActiveStringsLocale, type Locale } from '../../constants/strings';
import { loadSessionDetail } from '../../data/history';
import { saveSessionNote } from '../../data/notes';
import type { HistoryDetail } from '../../data/history';
import {
  loadProgressionSnapshot,
  analyzeStepEvidence,
} from '../../data/progression';
import type { ProgressionEvidence } from '../../analytics/progression';

jest.mock('../../data', () => ({ database: {} }));
jest.mock('../../data/history', () => ({ loadSessionDetail: jest.fn() }));
jest.mock('../../data/notes', () => ({ saveSessionNote: jest.fn() }));
jest.mock('../../data/progression', () => ({
  loadProgressionSnapshot: jest.fn(),
  analyzeStepEvidence: jest.fn(),
  summarizeProgression: jest.fn(),
  progressionInputFor: jest.fn(),
  latestPrescriptionFor: jest.fn(),
}));

const mockedLoad = loadSessionDetail as jest.MockedFunction<typeof loadSessionDetail>;
const mockedSave = saveSessionNote as jest.MockedFunction<typeof saveSessionNote>;

function flatten(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(flatten).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return '';
}

function textsOf(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByType(Text).map((node) => flatten(node.props.children));
}

/** Field values live on TextInput props (host Text nodes only carry labels). */
function noteField(renderer: ReactTestRenderer) {
  const node = renderer.root
    .findAll((n) => typeof n.props?.value === 'string' && typeof n.props?.onChangeText === 'function')
    .pop();
  expect(node).toBeDefined();
  return node!;
}

function pressableByLabel(renderer: ReactTestRenderer, label: string) {
  const node = renderer.root
    .findAll((n) => n.props?.accessibilityLabel === label && typeof n.props?.onPress === 'function')
    .pop();
  expect(node).toBeDefined();
  return node!;
}

const detail: HistoryDetail = {
  id: 'sess_1',
  name: 'Push Day',
  startedAt: 1_700_000_000_000,
  endedAt: 1_700_000_600_000,
  durationMs: 600_000,
  status: 'completed',
  note: 'Solid bench PR',
  definition: { id: 'r1', name: 'Push Day', blocks: [] },
  blocks: [],
  totalCompletedSets: 3,
};

async function renderDetail(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <Navigator>
        {() => <HistoryDetailScreen sessionId="sess_1" />}
      </Navigator>,
    );
  });
  await act(async () => {});
  return renderer;
}

describe('HistoryDetailScreen session note (Phase 2J)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads the session note into the editor field', async () => {
    mockedLoad.mockResolvedValue(detail);
    const renderer = await renderDetail();
    expect(mockedLoad).toHaveBeenCalledTimes(1);
    expect(noteField(renderer).props.value).toBe('Solid bench PR');
    expect(textsOf(renderer)).toContain(strings.notes.label);
  });

  it('starts with an empty field when the session has no note', async () => {
    mockedLoad.mockResolvedValue({ ...detail, note: null });
    const renderer = await renderDetail();
    expect(noteField(renderer).props.value).toBe('');
  });

  it('saves an edited note and shows the confirmation', async () => {
    mockedLoad.mockResolvedValue(detail);
    mockedSave.mockResolvedValue('Even better than last week');
    const renderer = await renderDetail();

    const field = noteField(renderer);
    await act(async () => {
      field.props.onChangeText('Even better than last week');
    });
    await act(async () => {
      pressableByLabel(renderer, strings.notes.save).props.onPress();
    });

    expect(mockedSave).toHaveBeenCalledTimes(1);
    expect(mockedSave.mock.calls[0][1]).toBe('sess_1');
    expect(mockedSave.mock.calls[0][2]).toBe('Even better than last week');
    expect(textsOf(renderer)).toContain(strings.notes.saved);
    expect(noteField(renderer).props.value).toBe('Even better than last week');
  });

  it('keeps the field when the save fails and hides the confirmation', async () => {
    mockedLoad.mockResolvedValue(detail);
    mockedSave.mockRejectedValue(new Error('db gone'));
    const renderer = await renderDetail();

    await act(async () => {
      noteField(renderer).props.onChangeText('Attempted note');
    });
    await act(async () => {
      pressableByLabel(renderer, strings.notes.save).props.onPress();
    });

    expect(textsOf(renderer)).not.toContain(strings.notes.saved);
    expect(noteField(renderer).props.value).toBe('Attempted note');
  });

  it('renders the compare action alongside the note editor', async () => {
    mockedLoad.mockResolvedValue(detail);
    const renderer = await renderDetail();
    expect(renderer.root.findByProps({ accessibilityLabel: strings.history.compare })).toBeDefined();
  });
});

const detailWithBlock: HistoryDetail = {
  ...detail,
  // The immutable snapshot must mirror the view model (production invariant).
  definition: {
    id: 'r1',
    name: 'Push Day',
    blocks: [
      {
        id: 'b0',
        name: 'Main',
        kind: 'superset',
        rounds: 2,
        steps: [
          {
            id: 's0',
            role: 'work',
            exerciseId: 'ex_bench',
            exerciseName: 'Bench Press',
            prescription: {
              targetSets: 3,
              targetRepsMin: 5,
              targetRepsMax: 8,
              targetWeightGrams: 80_000,
              targetDurationMs: null,
              targetRir: 2,
              tempo: { eccentricMs: null, pauseBottomMs: null, concentricMs: null, pauseTopMs: null },
            },
          },
        ],
        transitions: [],
      },
    ],
  },
  blocks: [
    {
      blockIndex: 0,
      name: 'Main',
      kind: 'superset',
      rounds: 2,
      steps: [
        {
          stepIndex: 0,
          exerciseName: 'Bench Press',
          targetSets: 3,
          targetRepsMin: 5,
          targetRepsMax: 8,
          targetWeightGrams: 80_000,
          targetDurationMs: null,
          targetRir: 2,
          logs: [
            {
              blockIndex: 0,
              stepIndex: 0,
              round: 1,
              setIndex: 1,
              weightGrams: 80_000,
              reps: 5,
              durationMs: null,
              rir: 2,
            },
          ],
          skipped: [],
        },
      ],
    },
  ],
};

const mockedLoadSnap = loadProgressionSnapshot as jest.MockedFunction<typeof loadProgressionSnapshot>;
const mockedStepEvidence = analyzeStepEvidence as jest.MockedFunction<typeof analyzeStepEvidence>;

// Module-level default: the Phase 2J describe above never configures the
// progression mocks, so every test in the file gets a safe no-op snapshot.
mockedLoadSnap.mockResolvedValue({
  analytics: { sessions: [], exercises: [] },
  timestamps: new Map(),
  historicalPrescriptions: new Map(),
  equipmentItems: [],
});
mockedStepEvidence.mockReturnValue(null);

const stepEvidence: ProgressionEvidence = {
  state: 'progress',
  reason: 'REPS_RANGE_COMPLETED',
  explanation: 'test-only',
  baseline: {
    exerciseName: 'Bench Press',
    exerciseId: 'ex_bench',
    timestampMs: 1_699_913_600_000,
    sessionId: 's1',
    weightGrams: 80_000,
    reps: 8,
    actualRir: null,
    actualTempo: null,
    equipmentClass: 'barbell',
    isSubstitution: false,
    prescription: { targetRepsMin: 8, targetRepsMax: 12, targetWeightGrams: 50_000, targetRir: 2, tempo: null },
    estimated1rmGrams: null,
  },
  current: {
    exerciseName: 'Bench Press',
    exerciseId: 'ex_bench',
    timestampMs: 1_700_000_000_000,
    sessionId: 's2',
    weightGrams: 80_000,
    reps: 8,
    actualRir: null,
    actualTempo: null,
    equipmentClass: 'barbell',
    isSubstitution: false,
    prescription: { targetRepsMin: 8, targetRepsMax: 12, targetWeightGrams: 50_000, targetRir: 2, tempo: null },
    estimated1rmGrams: null,
  },
  comparableCount: 2,
  currentPrescription: { targetRepsMin: 8, targetRepsMax: 12, targetWeightGrams: 50_000, targetRir: 2, tempo: null },
  atTargetWeight: true,
  repsVsRange: { achieved: 12, min: 8, max: 12 },
  suggestedWeightGrams: 55_000,
  weightIncrementSource: 'equipment_inventory',
};

describe('HistoryDetailScreen progression intelligence (Phase 3B)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedLoadSnap.mockResolvedValue({
      analytics: { sessions: [], exercises: [] },
      timestamps: new Map(),
      historicalPrescriptions: new Map(),
      equipmentItems: [],
    });
  });

  it('renders the engine verdict with the inventory-backed next weight for a comparable step', async () => {
    mockedLoad.mockResolvedValue(detailWithBlock);
    mockedStepEvidence.mockReturnValue(stepEvidence);
    const renderer = await renderDetail();
    const card = renderer.root.findAllByProps({ testID: 'history-progression-0-0' })[0];
    expect(card).toBeDefined();
    const texts = textsOf(renderer);
    expect(texts).toContain(strings.progression.stateProgress);
    expect(texts.join(' ')).toContain('55');
  });

  it('renders no progression card when the engine returns no evidence for the step', async () => {
    mockedLoad.mockResolvedValue(detailWithBlock);
    mockedStepEvidence.mockReturnValue(null);
    const renderer = await renderDetail();
    expect(renderer.root.findAllByProps({ testID: 'history-progression-0-0' })).toHaveLength(0);
  });

  it('localizes the verdict to Spanish under the es locale', async () => {
    const original: Locale = getActiveStringsLocale();
    try {
      setStringsLocale('es');
      mockedLoad.mockResolvedValue(detailWithBlock);
      mockedStepEvidence.mockReturnValue(stepEvidence);
      const renderer = await renderDetail();
      expect(textsOf(renderer)).toContain(strings.progression.stateProgress);
    } finally {
      setStringsLocale(original);
    }
  });

  it('survives a progression snapshot failure without breaking the session view', async () => {
    mockedLoad.mockResolvedValue(detailWithBlock);
    mockedLoadSnap.mockRejectedValue(new Error('db locked'));
    const renderer = await renderDetail();
    expect(renderer.root.findAllByProps({ testID: 'history-progression-0-0' })).toHaveLength(0);
    expect(textsOf(renderer)).toContain('Bench Press');
  });
});

describe('HistoryDetailScreen adaptive execution markers (Phase 3C)', () => {
  const detailWithExecution: HistoryDetail = {
    ...detailWithBlock,
    blocks: [
      {
        ...detailWithBlock.blocks[0],
        steps: [
          {
            ...detailWithBlock.blocks[0].steps[0],
            logs: [
              {
                ...detailWithBlock.blocks[0].steps[0].logs[0],
                executionType: 'modified',
                overrideReason: 'load_reduced',
              },
              {
                blockIndex: 0,
                stepIndex: 0,
                round: 1,
                setIndex: 4,
                weightGrams: 60_000,
                reps: 8,
                durationMs: null,
                rir: null,
                executionType: 'drop',
                overrideReason: null,
              },
            ],
            skipped: [{ blockIndex: 0, stepIndex: 0, round: 1, setIndex: 2 }],
          },
        ],
      },
    ],
  };

  it('marks modified/extra/drop sets and lists skipped positions', async () => {
    mockedLoad.mockResolvedValue(detailWithExecution);
    const renderer = await renderDetail();
    const joined = textsOf(renderer).join(' ');
    expect(joined).toContain(strings.history.execModified);
    expect(joined).toContain(strings.workout.reasonLoadReduced);
    expect(joined).toContain(strings.history.execDrop);
    expect(joined).toContain(strings.history.skippedSets);
    expect(joined).toContain('R1S2');
  });

  it('shows no markers for plain legacy rows', async () => {
    mockedLoad.mockResolvedValue(detailWithBlock);
    const renderer = await renderDetail();
    const joined = textsOf(renderer).join(' ');
    expect(joined).not.toContain(strings.history.execModified);
    expect(joined).not.toContain(strings.history.execExtra);
    expect(joined).not.toContain(strings.history.execDrop);
    expect(joined).not.toContain(strings.history.skippedSets);
  });

  it('localizes execution markers to Spanish under the es locale', async () => {
    const original: Locale = getActiveStringsLocale();
    try {
      setStringsLocale('es');
      mockedLoad.mockResolvedValue(detailWithExecution);
      const renderer = await renderDetail();
      const joined = textsOf(renderer).join(' ');
      expect(joined).toContain(strings.history.execModified);
      expect(joined).toContain(strings.history.execDrop);
      expect(joined).toContain(strings.history.skippedSets);
    } finally {
      setStringsLocale(original);
    }
  });
});

describe('HistoryDetailScreen a11y and i18n (Phase 2L Stage H)', () => {
  it('renders block-kind badges from the dictionary in the active locale', async () => {
    const original: Locale = getActiveStringsLocale();
    try {
      setStringsLocale('es');
      mockedLoad.mockResolvedValue(detailWithBlock);
      const renderer = await renderDetail();
      const texts = textsOf(renderer);
      expect(texts).toContain(strings.routines.blockKind.superset);
      expect(texts.join(' ')).toContain(`${strings.workout.block} 1 · Main`);
      expect(renderer.root.findAllByProps({ accessibilityRole: 'header' }).length).toBeGreaterThan(0);
    } finally {
      setStringsLocale(original);
    }
  });

  it('labels the note input and exposes button roles for note and compare actions', async () => {
    mockedLoad.mockResolvedValue(detail);
    const renderer = await renderDetail();
    expect(noteField(renderer).props.accessibilityLabel).toBe(strings.notes.label);
    const save = pressableByLabel(renderer, strings.notes.save);
    expect(save.props.accessibilityRole).toBe('button');
    expect(save.props.accessibilityLabel).toBe(strings.notes.save);
    const compare = pressableByLabel(renderer, strings.history.compare);
    expect(compare.props.accessibilityRole).toBe('button');
    expect(typeof compare.props.onPress).toBe('function');
  });
});
