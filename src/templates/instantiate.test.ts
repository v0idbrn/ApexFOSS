import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import { schema } from '../data/schema';
import { migrations } from '../data/migrations';
import { modelClasses } from '../data/models';
import { makeDbActions } from '../data/actions';
import { ROUTINE_TEMPLATES, templateByKey } from './catalog';
import { instantiateTemplate } from './instantiate';

function makeDb(): Database {
  const adapter = new LokiJSAdapter({
    dbName: `apexfoss-tpl-${Math.random().toString(36).slice(2)}`,
    schema,
    migrations,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
  });
  return new Database({ adapter, modelClasses: modelClasses as any });
}

describe('template catalog (Phase 4F)', () => {
  it('exposes four templates whose steps all resolve to seed exercises', () => {
    expect(ROUTINE_TEMPLATES.map((t) => t.key)).toEqual(['fullBody', 'pushDay', 'pullDay', 'legsDay']);
    for (const t of ROUTINE_TEMPLATES) {
      expect(t.steps.length).toBeGreaterThan(0);
      for (const s of t.steps) expect(s.seedId).toMatch(/^seed_/);
    }
    expect(templateByKey('pushDay')?.key).toBe('pushDay');
    expect(templateByKey('fullBody' as never)).toBeDefined();
  });
});

describe('instantiateTemplate (Phase 4F)', () => {
  it('creates a single-block routine with empty prescriptions', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    await actions.seedExercisesIfEmpty();

    const routineId = await instantiateTemplate(db, templateByKey('fullBody')!, 'Full body');
    const draft = await actions.loadRoutineDraft(routineId);
    expect(draft.name).toBe('Full body');
    expect(draft.blocks).toHaveLength(1);
    const block = draft.blocks[0];
    expect(block.steps.map((s) => s.exerciseName)).toEqual(['Back Squat', 'Bench Press', 'Barbell Row']);
    for (const s of block.steps) {
      expect(s.exerciseId).toBeTruthy();
      expect(s.prescription.targetSets).toBeNull();
      expect(s.prescription.targetWeightGrams).toBeNull();
    }
  });

  it('resolves a renamed seed exercise by id', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    await actions.seedExercisesIfEmpty();
    const exercises = await actions.listExercises();
    const squat = exercises.find((e) => e.name === 'Back Squat')!;
    await actions.updateExercise(squat.id, { ...squat, name: 'Heavy Squat' });

    const routineId = await instantiateTemplate(db, templateByKey('legsDay')!, 'Legs day');
    const draft = await actions.loadRoutineDraft(routineId);
    expect(draft.blocks[0].steps.map((s) => s.exerciseName)).toContain('Heavy Squat');
  });

  it('falls back to name matching for locally created exercises', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    const localId = await actions.createExercise({
      name: 'Bench Press',
      category: 'push',
      equipment: 'barbell',
      metricFlags: 3,
    });

    const routineId = await instantiateTemplate(db, templateByKey('pushDay')!, 'Push day');
    const draft = await actions.loadRoutineDraft(routineId);
    const step = draft.blocks[0].steps.find((s) => s.exerciseName === 'Bench Press');
    expect(step?.exerciseId).toBe(localId);
    // Unavailable seeds (Overhead Press, Dip) are skipped, not invented.
    expect(draft.blocks[0].steps).toHaveLength(1);
  });

  it('throws when no template exercise exists locally', async () => {
    const db = makeDb();
    await expect(instantiateTemplate(db, templateByKey('pullDay')!, 'Pull day')).rejects.toThrow(
      'no template exercises',
    );
  });
});
