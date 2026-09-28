import React from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Navigator } from '../navigation';
import { PortabilityScreen } from './PortabilityScreen';
import { strings } from '../../constants/strings';
import { makeDbActions } from '../../data/actions';
import { shareRoutinePackage } from '../../portability/share';

jest.mock('../../data', () => ({ database: {} }));
jest.mock('../../data/actions', () => ({ makeDbActions: jest.fn() }));
jest.mock('../../portability/share', () => ({
  shareRoutinePackage: jest.fn(),
  shareBackup: jest.fn(),
  reportPortabilityError: jest.fn(),
  portabilityErrorMessage: jest.fn(),
}));
jest.mock('../../portability/routinePackage', () => ({
  parseRoutinePackage: jest.fn(),
  buildRoutinePackage: jest.fn(),
  serializeRoutinePackage: jest.fn(),
}));
jest.mock('../../portability/importRoutine', () => ({
  previewRoutineImport: jest.fn(),
  importRoutinePackage: jest.fn(),
}));
jest.mock('../../portability/backup', () => ({
  createBackup: jest.fn(),
  restoreBackup: jest.fn(),
  parseBackup: jest.fn(),
  backupSummary: jest.fn(),
}));
jest.mock('../../portability/encoding', () => ({
  buildImportDeepLink: jest.fn(),
  decodeRoutineTransport: jest.fn(),
  parseImportDeepLink: jest.fn(),
}));
jest.mock('../../portability/qr', () => ({ fitsQr: jest.fn(), encodeQr: jest.fn() }));
jest.mock('../../portability/pendingDeepLink', () => ({ takePendingDeepLink: jest.fn(() => null) }));
jest.mock('../../portability/pendingFileImport', () => ({ takePendingFileImport: jest.fn(() => null) }));
jest.mock('../../portability/fileImport', () => ({ pickImportFile: jest.fn() }));
jest.mock('../QrGrid', () => ({ QrGrid: () => null }));

const mockedMakeDbActions = makeDbActions as jest.MockedFunction<typeof makeDbActions>;
const mockedShareRoutinePackage = shareRoutinePackage as jest.Mock;

function flatten(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(flatten).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return '';
}

function chipByLabel(renderer: ReactTestRenderer, label: string) {
  const node = renderer.root
    .findAll((n) => n.props?.accessibilityRole === 'button')
    .find((button) => button.findAllByType(Text).some((text) => flatten(text.props.children) === label));
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
    )[0];
  expect(node).toBeDefined();
  return node!;
}

async function renderScreen(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <Navigator>{() => <PortabilityScreen />}</Navigator>,
    );
  });
  await act(async () => {});
  return renderer;
}

describe('PortabilityScreen routine export selection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedMakeDbActions.mockReturnValue({
      listRoutinesWithCounts: jest.fn().mockResolvedValue([
        { id: 'r1', name: 'Push day', blockCount: 1, stepCount: 2 },
        { id: 'r2', name: 'Pull day', blockCount: 1, stepCount: 3 },
      ]),
    } as unknown as ReturnType<typeof makeDbActions>);
    mockedShareRoutinePackage.mockResolvedValue(true);
  });

  it('exports the explicitly selected routine instead of only the first row', async () => {
    const renderer = await renderScreen();
    await act(async () => {
      chipByLabel(renderer, 'Pull day').props.onPress();
    });
    await act(async () => {
      buttonByLabel(renderer, strings.portability.exportRoutine).props.onPress();
    });
    expect(mockedShareRoutinePackage).toHaveBeenCalledWith({}, 'r2');
  });
});
