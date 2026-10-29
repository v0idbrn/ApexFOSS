import React from 'react';
import { Alert, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Navigator } from '../navigation';
import { PortabilityScreen } from './PortabilityScreen';
import { strings } from '../../constants/strings';
import { makeDbActions } from '../../data/actions';
import {
  shareRoutinePackage,
  portabilityErrorMessage,
} from '../../portability/share';
import { updateRoutinePackage, previewRoutineImport } from '../../portability/importRoutine';
import { pickImportFile } from '../../portability/fileImport';

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
  updateRoutinePackage: jest.fn(),
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

  it('update-existing flow: preview alert → routine picker modal → updateRoutinePackage with chosen id', async () => {
    const IMPORT_JSON = '{"format":"apexfoss-routine"}';
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    (pickImportFile as jest.Mock).mockResolvedValue({
      status: 'ok',
      fileName: 'day.apexroutine',
      text: IMPORT_JSON,
    });
    (previewRoutineImport as jest.Mock).mockResolvedValue({
      routineName: 'Push day',
      blockCount: 1,
      stepCount: 2,
      matchedExercises: 1,
      matchedExerciseNames: ['Bench'],
      newExercises: 0,
      newExerciseNames: [],
    });
    (updateRoutinePackage as jest.Mock).mockResolvedValue({
      routineId: 'r2',
      routineName: 'Pull day',
      createdExercises: 0,
      reusedExercises: 1,
    });
    try {
      const renderer = await renderScreen();
      await act(async () => {
        buttonByLabel(renderer, strings.portability.importFromFile).props.onPress();
      });
      expect(alertSpy).toHaveBeenCalledTimes(1);
      const options = alertSpy.mock.calls[0][2] as Array<{ text: string; onPress?: () => void; style?: string }>;
      const updateChoice = options.find((b) => b.text === strings.portability.importChoiceUpdate);
      expect(updateChoice).toBeDefined();
      await act(async () => {
        updateChoice!.onPress?.();
      });
      const modal = renderer.root
        .findAll((n) => n.props?.testID === 'update-routine-modal')
        .find((n) => n.props.visible === undefined || n.props.visible !== false);
      expect(modal).toBeDefined();
      // Chip lookup must be scoped to the modal: the export card renders a
      // "Pull day" chip first, and pressing that one would set routineId.
      const chip = modal!
        .findAll((n) => n.props?.accessibilityRole === 'button')
        .find((button) => button.findAllByType(Text).some((text) => flatten(text.props.children) === 'Pull day'));
      expect(chip).toBeDefined();
      await act(async () => {
        chip!.props.onPress();
      });
      await act(async () => {
        buttonByLabel(renderer, strings.portability.updateRoutineConfirm).props.onPress();
      });
      expect(updateRoutinePackage).toHaveBeenCalledWith({}, IMPORT_JSON, 'r2');
      expect(
        renderer.root
          .findAll((n) => n.props?.testID === 'portability-status')
          .some((n) => flatten(n.props.children) === strings.portability.updateDone),
      ).toBe(true);
    } finally {
      alertSpy.mockRestore();
    }
  });
});
