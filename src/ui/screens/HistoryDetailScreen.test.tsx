import React from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Navigator } from '../navigation';
import { HistoryDetailScreen } from './HistoryDetailScreen';
import { strings } from '../../constants/strings';
import { loadSessionDetail } from '../../data/history';
import { saveSessionNote } from '../../data/notes';
import type { HistoryDetail } from '../../data/history';

jest.mock('../../data', () => ({ database: {} }));
jest.mock('../../data/history', () => ({ loadSessionDetail: jest.fn() }));
jest.mock('../../data/notes', () => ({ saveSessionNote: jest.fn() }));

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
