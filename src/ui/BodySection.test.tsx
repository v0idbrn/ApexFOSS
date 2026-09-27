import React from 'react';
import { Alert, Text, TextInput } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Navigator } from './navigation';
import { BodySection } from './BodySection';
import { strings } from '../constants/strings';
import { makeDbActions } from '../data/actions';

jest.mock('../data', () => ({ database: {} }));
jest.mock('../data/actions', () => ({ makeDbActions: jest.fn() }));

const mockedMakeDbActions = makeDbActions as jest.MockedFunction<typeof makeDbActions>;

const T = 1_700_000_000_000;
const DAY = 86_400_000;

const ROWS = [
  { id: 'b1', measuredAt: T + DAY, weightGrams: 79_500, waistMm: 835 },
  { id: 'b2', measuredAt: T, weightGrams: 80_000, waistMm: 840 },
];

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
    .filter((n) => n.props.testID !== 'body-add')[0];
  expect(node).toBeDefined();
  return node!;
}

function setup(
  rows: typeof ROWS,
  actions: Partial<Record<string, jest.Mock>> = {},
) {
  mockedMakeDbActions.mockReturnValue({
    listBodyMetrics: jest.fn().mockResolvedValue(rows),
    logBodyMetrics: jest.fn().mockResolvedValue('b1'),
    deleteBodyMetric: jest.fn().mockResolvedValue(undefined),
    ...actions,
  } as unknown as ReturnType<typeof makeDbActions>);
}

async function renderSection(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <Navigator>{() => <BodySection />}</Navigator>,
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

describe('BodySection (Phase 4E)', () => {
  it('shows latest values with deltas and the entry list', async () => {
    setup(ROWS);
    const renderer = await renderSection();
    const texts = textsOf(renderer);
    expect(texts).toContain(strings.body.title);
    expect(texts).toContain(strings.body.latest);
    expect(texts).toContain('79.5 kg · 83.5 cm');
    expect(texts).toContain('-0.5 kg · -0.5 cm');
    expect(texts).toContain('80 kg · 84 cm');
    expect(nodeByTestId(renderer, 'body-row-b1').type).toBeDefined();
    expect(nodeByTestId(renderer, 'body-row-b2').type).toBeDefined();
  });

  it('shows the empty state when nothing is logged', async () => {
    setup([]);
    const renderer = await renderSection();
    expect(textsOf(renderer)).toContain(strings.body.emptyBody);
    expect(renderer.root.findAll((n) => n.props?.testID?.startsWith?.('body-row-'))).toHaveLength(0);
  });

  it('logs a weight-only measurement', async () => {
    const logBodyMetrics = jest.fn().mockResolvedValue('b1');
    setup([], { logBodyMetrics });
    const renderer = await renderSection();
    await act(async () => {
      nodeByTestId(renderer, 'body-add').props.onPress();
    });
    expect(nodeByTestId(renderer, 'body-form').type).toBeDefined();
    await act(async () => {
      renderer.root.findAllByType(TextInput)[0].props.onChangeText('78.5');
    });
    await act(async () => {
      buttonByLabel(renderer, strings.body.add).props.onPress();
    });
    expect(logBodyMetrics).toHaveBeenCalledWith(
      expect.objectContaining({ weightGrams: 78_500, waistMm: null }),
    );
  });

  it('logs waist in centimeters converted to millimeters', async () => {
    const logBodyMetrics = jest.fn().mockResolvedValue('b1');
    setup([], { logBodyMetrics });
    const renderer = await renderSection();
    await act(async () => {
      nodeByTestId(renderer, 'body-add').props.onPress();
    });
    await act(async () => {
      renderer.root.findAllByType(TextInput)[1].props.onChangeText('82');
    });
    await act(async () => {
      buttonByLabel(renderer, strings.body.add).props.onPress();
    });
    expect(logBodyMetrics).toHaveBeenCalledWith(
      expect.objectContaining({ weightGrams: null, waistMm: 820 }),
    );
  });

  it('requires at least one value before saving', async () => {
    const logBodyMetrics = jest.fn();
    setup([], { logBodyMetrics });
    const renderer = await renderSection();
    await act(async () => {
      nodeByTestId(renderer, 'body-add').props.onPress();
    });
    await act(async () => {
      buttonByLabel(renderer, strings.body.add).props.onPress();
    });
    expect(logBodyMetrics).not.toHaveBeenCalled();
    expect(textsOf(renderer)).toContain(strings.body.atLeastOne);
  });

  it('deletes an entry after destructive confirmation', async () => {
    const deleteBodyMetric = jest.fn().mockResolvedValue(undefined);
    setup(ROWS, { deleteBodyMetric });
    const renderer = await renderSection();
    await act(async () => {
      nodeByTestId(renderer, 'body-delete-b1').props.onPress();
    });
    expect(alertSpy).toHaveBeenCalledWith(strings.common.delete, strings.body.deleteConfirm, expect.any(Array));
    const buttons = (alertSpy.mock.calls[0][2] ?? []) as Array<{ onPress?: () => void }>;
    await act(async () => {
      buttons[1].onPress?.();
    });
    expect(deleteBodyMetric).toHaveBeenCalledWith('b1');
  });
});
