import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import { schema } from './schema';
import { migrations } from './migrations';
import { modelClasses } from './models';
import { NOTE_MAX_LENGTH, loadSessionNote, normalizeNote, saveSessionNote } from './notes';
import { loadSessionDetail } from './history';

function makeDb(): Database {
  const adapter = new LokiJSAdapter({
    dbName: `apexfoss-notes-${Math.random().toString(36).slice(2)}`,
    schema,
    migrations,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
  });
  return new Database({ adapter, modelClasses: modelClasses as any });
}

async function createCompletedSession(db: Database, name = 'Push Day'): Promise<string> {
  let id = '';
  await db.write(async () => {
    const row = await db.get<any>('workout_sessions').create((rec: any) => {
      rec.routineId = null;
      rec.name = name;
      rec.startedAt = 1_700_000_000_000;
      rec.endedAt = 1_700_000_600_000;
      rec.sessionStatus = 'completed';
      rec.definitionJson = JSON.stringify({ id: 'r1', name, blocks: [] });
      rec.cursorJson = JSON.stringify({ status: 'completed' });
      rec.note = null;
      rec.currentBlockIndex = 0;
      rec.currentStepId = null;
      rec.currentRound = 1;
      rec.currentSetIndex = 0;
      rec.timerExpiresAt = null;
      rec.createdAt = 1;
      rec.updatedAt = 1;
    });
    id = row.id;
  });
  return id;
}

describe('session workout notes (Phase 2J, schema v5)', () => {
  it('normalizeNote trims and maps blank input to null', () => {
    expect(normalizeNote('  Solid day  ')).toBe('Solid day');
    expect(normalizeNote('   ')).toBeNull();
    expect(normalizeNote('')).toBeNull();
  });

  it('normalizeNote clamps to the maximum note length', () => {
    const long = 'x'.repeat(NOTE_MAX_LENGTH + 500);
    const out = normalizeNote(long);
    expect(out).toHaveLength(NOTE_MAX_LENGTH);
  });

  it('saves and reloads a session note', async () => {
    const db = makeDb();
    const id = await createCompletedSession(db);
    const stored = await saveSessionNote(db, id, 'Felt strong, kept 2 reps in reserve');
    expect(stored).toBe('Felt strong, kept 2 reps in reserve');
    expect(await loadSessionNote(db, id)).toBe('Felt strong, kept 2 reps in reserve');
  });

  it('saving a blank note clears the stored value', async () => {
    const db = makeDb();
    const id = await createCompletedSession(db);
    await saveSessionNote(db, id, 'first');
    expect(await saveSessionNote(db, id, '   \n  ')).toBeNull();
    expect(await loadSessionNote(db, id)).toBeNull();
  });

  it('persists an overlong note truncated to the cap', async () => {
    const db = makeDb();
    const id = await createCompletedSession(db);
    await saveSessionNote(db, id, 'y'.repeat(NOTE_MAX_LENGTH + 100));
    const loaded = await loadSessionNote(db, id);
    expect(loaded).toHaveLength(NOTE_MAX_LENGTH);
  });

  it('unknown session: load returns null, save rejects', async () => {
    const db = makeDb();
    expect(await loadSessionNote(db, 'missing-session')).toBeNull();
    await expect(saveSessionNote(db, 'missing-session', 'note')).rejects.toThrow();
  });

  it('loadSessionDetail exposes the session note', async () => {
    const db = makeDb();
    const id = await createCompletedSession(db);
    expect((await loadSessionDetail(db, id))!.note).toBeNull();
    await saveSessionNote(db, id, 'Great bench day');
    expect((await loadSessionDetail(db, id))!.note).toBe('Great bench day');
  });
});
