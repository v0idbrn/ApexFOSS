import { detectImportKind, hasImportExtension, pickImportFile } from './fileImport';

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({ File: jest.fn() }));

const getDocumentAsync = jest.requireMock('expo-document-picker').getDocumentAsync as jest.Mock;
const FileMock = jest.requireMock('expo-file-system').File as jest.Mock;

describe('pickImportFile', () => {
  beforeEach(() => {
    getDocumentAsync.mockReset();
    FileMock.mockReset();
    FileMock.mockImplementation((uri: string) => ({ text: async () => `text-of:${uri}` }));
  });

  it('returns canceled when the picker is dismissed', async () => {
    getDocumentAsync.mockResolvedValue({ canceled: true, assets: null });
    await expect(pickImportFile('routine')).resolves.toEqual({ status: 'canceled' });
    expect(FileMock).not.toHaveBeenCalled();
  });

  it('rejects files without the .apexroutine extension before reading', async () => {
    getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ name: 'notes.txt', uri: 'file:///notes' }],
    });
    await expect(pickImportFile('routine')).resolves.toEqual({
      status: 'wrong-type',
      fileName: 'notes.txt',
    });
    expect(FileMock).not.toHaveBeenCalled();
  });

  it('rejects a routine file when the backup is expected', async () => {
    getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ name: 'plan.apexroutine', uri: 'file:///plan' }],
    });
    const result = await pickImportFile('backup');
    expect(result.status).toBe('wrong-type');
    expect(FileMock).not.toHaveBeenCalled();
  });

  it('reads a matching file and ignores extension case', async () => {
    getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ name: 'MY.APEXBACKUP', uri: 'file:///backup' }],
    });
    await expect(pickImportFile('backup')).resolves.toEqual({
      status: 'ok',
      fileName: 'MY.APEXBACKUP',
      text: 'text-of:file:///backup',
    });
    expect(FileMock).toHaveBeenCalledWith('file:///backup');
  });

  it('propagates read failures to the caller', async () => {
    getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ name: 'plan.apexroutine', uri: 'file:///plan' }],
    });
    FileMock.mockImplementation(() => ({
      text: async () => {
        throw new Error('unreadable');
      },
    }));
    await expect(pickImportFile('routine')).rejects.toThrow('unreadable');
  });
});

describe('hasImportExtension', () => {
  it('is case-insensitive and kind-aware', () => {
    expect(hasImportExtension('PLAN.APEXROUTINE', 'routine')).toBe(true);
    expect(hasImportExtension('plan.apexroutine', 'routine')).toBe(true);
    expect(hasImportExtension('plan.apexbackup', 'routine')).toBe(false);
    expect(hasImportExtension('plan.apexroutine', 'backup')).toBe(false);
    expect(hasImportExtension('plan.apexbackup', 'backup')).toBe(true);
    expect(hasImportExtension('plan.apexroutine.backup', 'routine')).toBe(false);
  });
});

describe('detectImportKind', () => {
  it('detects backup payloads by format field', () => {
    expect(detectImportKind('{"format":"apexfoss-backup","data":{}}')).toBe('backup');
  });

  it('detects routine payloads by format field', () => {
    expect(detectImportKind('{"format":"apexfoss-routine"}')).toBe('routine');
  });

  it('rejects non-JSON, unknown formats and non-objects', () => {
    expect(detectImportKind('not json {')).toBeNull();
    expect(detectImportKind('{"format":"something-else"}')).toBeNull();
    expect(detectImportKind('null')).toBeNull();
    expect(detectImportKind('"apexfoss-backup"')).toBeNull();
    expect(detectImportKind('123')).toBeNull();
  });
});
