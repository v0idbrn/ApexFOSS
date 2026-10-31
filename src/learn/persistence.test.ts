import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import { schema } from '../data/schema';
import { migrations } from '../data/migrations';
import { modelClasses } from '../data/models';
import { makeDbActions } from '../data/actions';
import { getSetting, setSetting } from '../data/settings';
import {
  LEARN_PROGRESS_KEY,
  emptyLearnProgress,
  loadLearnProgress,
  loadLessonCounts,
  saveLearnProgress,
} from './progress';

/**
 * Learn persistence and isolation (D-061/D-063): the progress document lives in
 * app_settings only, survives reload, degrades safely when corrupt, and the
 * evidence counts exclude seeded starters. No training table is ever written.
 */

function makeDb(): Database {
  const adapter = new LokiJSAdapter({
    dbName: `apex-learn-${Math.random().toString(36).slice(2)}`,
    schema,
    migrations,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
  });
  return new Database({ adapter, modelClasses: modelClasses as any });
}

describe('Learn progress persistence', () => {
  it('round-trips through app_settings and reloads identically', async () => {
    const db = makeDb();
    await saveLearnProgress(db, { version: 1, welcomeDone: true, completed: ['intro', 'history'] });

    expect(await loadLearnProgress(db)).toEqual({
      version: 1,
      welcomeDone: true,
      completed: ['intro', 'history'],
    });
    expect(await getSetting(db, LEARN_PROGRESS_KEY)).not.toBeNull();
  });

  it('degrades to empty progress when the stored document is corrupt', async () => {
    const db = makeDb();
    await setSetting(db, LEARN_PROGRESS_KEY, '{not valid json');
    expect(await loadLearnProgress(db)).toEqual(emptyLearnProgress());
  });

  it('stores progress without touching training data', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    await actions.seedExercisesIfEmpty();
    await actions.createRoutine('Kept Routine');

    const before = await loadLessonCounts(db);
    await saveLearnProgress(db, { version: 1, welcomeDone: true, completed: ['intro'] });
    const after = await loadLessonCounts(db);

    expect(after).toEqual(before);
    expect(after.routines).toBe(1);
    expect(after.userExercises).toBe(0);
    expect(after.setLogs).toBe(0);
    expect(after.completedSessions).toBe(0);
  });

  it('counts only athlete-created exercises as library evidence', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    await actions.seedExercisesIfEmpty();
    expect((await loadLessonCounts(db)).userExercises).toBe(0);

    await actions.createExercise({
      name: 'Zercher Squat',
      category: 'legs',
      equipment: 'barbell',
      metricFlags: 3,
    });
    expect((await loadLessonCounts(db)).userExercises).toBe(1);
  });
});
