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
  {
    id: 'b4',
    measuredAt: T + 3 * DAY,
    measurementType: 'upper_arm',
    side: 'right',
    value: 300,
    unit: 'mm',
    weightGrams: null,
    waistMm: null,
  },
  {
    id: 'b1',
    measuredAt: T + 2 * DAY,
    measurementType: 'body_weight',
    side: null,
    value: 79_500,
    unit: 'g',
    weightGrams: 79_500,
    waistMm: null,
  },
  {
    id: 'b2',
    measuredAt: T + DAY,
    measurementType: 'waist',
    side: null,
    value: 835,
    unit: 'mm',
    weightGrams: null,
    waistMm: 835,
  },
  {
    id: 'b3',
    measuredAt: T,
    measurementType: 'body_weight',
    side: null,
    value: 80_000,
    unit: 'g',
    weightGrams: 80_000,
    waistMm: null,
  },
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

describe('BodySection (extensible measurements)', () => {
  it('shows latest values with deltas and the entry list', async () => {
    setup(ROWS);
    const renderer = await renderSection();
    const texts = textsOf(renderer);
    expect(texts).toContain(strings.body.title);
    expect(texts).toContain(strings.body.latest);
    expect(texts).toContain(strings.body.bodyWeight);
    expect(texts).toContain('79.5 kg');
    expect(texts).toContain(strings.body.waistLabel);
    expect(texts).toContain('83.5 cm');
    expect(texts).toContain('-0.5 kg');
    expect(texts).toContain('Upper arm (Right)');
    expect(texts).toContain('30 cm');
    expect(texts).toContain('Body Weight: 79.5 kg');
    expect(texts).toContain('Waist: 83.5 cm');
    expect(texts).toContain('Upper arm (Right): 30 cm');
    expect(nodeByTestId(renderer, 'body-row-b1').type).toBeDefined();
    expect(nodeByTestId(renderer, 'body-row-b2').type).toBeDefined();
    expect(nodeByTestId(renderer, 'body-row-b4').type).toBeDefined();
  });

  it('shows the empty state when nothing is logged', async () => {
    setup([]);
    const renderer = await renderSection();
    expect(textsOf(renderer)).toContain(strings.body.emptyBody);
    expect(renderer.root.findAll((n) => n.props?.testID?.startsWith?.('body-row-'))).toHaveLength(0);
  });

  it('logs a body-weight measurement entered in kilograms', async () => {
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
      expect.objectContaining({ measurementType: 'body_weight', side: null, value: 78_500, unit: 'g' }),
    );
  });

  it('logs a waist measurement entered in centimeters', async () => {
    const logBodyMetrics = jest.fn().mockResolvedValue('b1');
    setup([], { logBodyMetrics });
    const renderer = await renderSection();
    await act(async () => {
      nodeByTestId(renderer, 'body-add').props.onPress();
    });
    await act(async () => {
      nodeByTestId(renderer, 'body-type-waist').props.onPress();
    });
    await act(async () => {
      renderer.root.findAllByType(TextInput)[0].props.onChangeText('82');
    });
    await act(async () => {
      buttonByLabel(renderer, strings.body.add).props.onPress();
    });
    expect(logBodyMetrics).toHaveBeenCalledWith(
      expect.objectContaining({ measurementType: 'waist', side: null, value: 820, unit: 'mm' }),
    );
  });

  it('logs a bilateral measurement with its selected side', async () => {
    const logBodyMetrics = jest.fn().mockResolvedValue('b1');
    setup([], { logBodyMetrics });
    const renderer = await renderSection();
    await act(async () => {
      nodeByTestId(renderer, 'body-add').props.onPress();
    });
    await act(async () => {
      nodeByTestId(renderer, 'body-type-upper_arm').props.onPress();
    });
    await act(async () => {
      nodeByTestId(renderer, 'body-side-right').props.onPress();
    });
    await act(async () => {
      renderer.root.findAllByType(TextInput)[0].props.onChangeText('30');
    });
    await act(async () => {
      buttonByLabel(renderer, strings.body.add).props.onPress();
    });
    expect(logBodyMetrics).toHaveBeenCalledWith(
      expect.objectContaining({ measurementType: 'upper_arm', side: 'right', value: 300, unit: 'mm' }),
    );
  });

  it('requires a value before saving', async () => {
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
