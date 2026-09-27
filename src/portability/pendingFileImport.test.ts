import {
  ingestIncomingUrl,
  peekPendingFileImport,
  setPendingFileImport,
  takePendingFileImport,
} from './pendingFileImport';

jest.mock('expo-file-system', () => ({ File: jest.fn() }));

const FileMock = jest.requireMock('expo-file-system').File as jest.Mock;

describe('pending file import store', () => {
  beforeEach(() => {
    takePendingFileImport();
  });

  it('take clears the stash so it is consumed once', () => {
    setPendingFileImport({ kind: 'routine', text: 'x' });
    expect(takePendingFileImport()).toEqual({ kind: 'routine', text: 'x' });
    expect(takePendingFileImport()).toBeNull();
  });

  it('peek does not consume the stash', () => {
    setPendingFileImport({ kind: 'backup', text: 'y' });
    expect(peekPendingFileImport()).toEqual({ kind: 'backup', text: 'y' });
    expect(takePendingFileImport()).toEqual({ kind: 'backup', text: 'y' });
    expect(peekPendingFileImport()).toBeNull();
  });
});

describe('ingestIncomingUrl', () => {
  beforeEach(() => {
    takePendingFileImport();
    FileMock.mockReset();
    FileMock.mockImplementation(() => ({ text: async () => 'irrelevant' }));
  });

  it('ignores non-file URLs without touching the filesystem', async () => {
    await expect(ingestIncomingUrl('apexfoss://import?d=abc')).resolves.toBe(false);
    await expect(ingestIncomingUrl('https://example.com/x.json')).resolves.toBe(false);
    expect(FileMock).not.toHaveBeenCalled();
  });

  it('stashes detected backup content for later review', async () => {
    const text = '{"format":"apexfoss-backup","data":{}}';
    FileMock.mockImplementation(() => ({ text: async () => text }));
    await expect(ingestIncomingUrl('content://media/document/1')).resolves.toBe(true);
    expect(takePendingFileImport()).toEqual({ kind: 'backup', text });
  });

  it('stashes detected routine content for later review', async () => {
    const text = '{"format":"apexfoss-routine"}';
    FileMock.mockImplementation(() => ({ text: async () => text }));
    await expect(ingestIncomingUrl('file:///sdcard/note.json')).resolves.toBe(true);
    expect(takePendingFileImport()).toEqual({ kind: 'routine', text });
  });

  it('does not stash unrecognized content', async () => {
    FileMock.mockImplementation(() => ({ text: async () => 'just some notes' }));
    await expect(ingestIncomingUrl('content://media/2')).resolves.toBe(false);
    expect(takePendingFileImport()).toBeNull();
  });

  it('reports failure when the file cannot be read', async () => {
    FileMock.mockImplementation(() => ({
      text: async () => {
        throw new Error('permission denied');
      },
    }));
    await expect(ingestIncomingUrl('content://media/3')).resolves.toBe(false);
    expect(takePendingFileImport()).toBeNull();
  });
});
