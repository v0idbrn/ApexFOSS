import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import { schema } from '../data/schema';
import { migrations } from '../data/migrations';
import { modelClasses } from '../data/models';
import { makeDbActions } from '../data/actions';
import { buildTemplateDraft } from './instantiate';
import { templateByKey } from './catalog';
import {
  STARTER_ROUTINES,
  STARTER_ROUTINE_IDS,
  seedStarterRoutinesIfEmpty,
} from './starters';

/**
 * Starter routines (Checkpoint 5 / D-066): three prefilled demo routines seeded
 * into a fresh install with deterministic ids, real prescriptions, and repair
 * semantics that never overwrite a routine the user edited or deleted.
 */

function makeDb(): Database {
  const adapter = new LokiJSAdapter({
    dbName: `apex-starters-${Math.random().toString(36).slice(2)}`,
    schema,
    migrations,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
  });
  return new Database({ adapter, modelClasses: modelClasses as any });
}

describe('seedStarterRoutinesIfEmpty', () => {
  it('seeds the three starter routines with prefilled prescriptions on a fresh install', async () => {
    const db = makeDb();
    const created = await seedStarterRoutinesIfEmpty(db);

    expect(created).toBe(3);
    const rows = await db.get('routines').query().fetch();
    expect(rows.map((r) => r.id).sort()).toEqual([...STARTER_ROUTINE_IDS].sort());

    const actions = makeDbActions(db);
    for (const starter of STARTER_ROUTINES) {
      const draft = await actions.loadRoutineDraft(starter.id);
      expect(draft.blocks).toHaveLength(1);
      for (const [i, step] of draft.blocks[0].steps.entries()) {
        const p = step.prescription;
        expect(p.targetSets).toBe(starter.steps[i].targetSets ?? null);
        expect(p.targetRepsMin).toBe(starter.steps[i].targetRepsMin ?? null);
        expect(p.targetRepsMax).toBe(starter.steps[i].targetRepsMax ?? null);
        expect(p.targetWeightGrams).toBe(starter.steps[i].targetWeightGrams ?? null);
        expect(p.targetRir).toBe(starter.steps[i].targetRir ?? null);
        // Every step carries a rest transition so the runner paces the session.
        expect(step.transition.type).toBe('rest');
        expect(step.transition.delayMs).toBe(90_000);
      }
    }
  });

  it('is idempotent on a fully-seeded install (never re-creates existing ids)', async () => {
    const db = makeDb();
    await seedStarterRoutinesIfEmpty(db);
    const before = (await db.get('routines').query().fetch()).length;

    expect(await seedStarterRoutinesIfEmpty(db)).toBe(0);
    const ids = (await db.get('routines').query().fetch()).map((r) => r.id);
    expect(ids).toHaveLength(before);
    expect(ids.sort()).toEqual([...STARTER_ROUTINE_IDS].sort());
  });

  it('honors a deletion: a deleted starter stays deleted on later launches', async () => {
    // Delete wins over seeding. Resurrecting a soft-deleted deterministic id
    // collides with the unique index (and is unsafe on SQLite), so the athlete's
    // delete is permanent — the starter is not app content that fights back.
    const db = makeDb();
    await seedStarterRoutinesIfEmpty(db);
    await makeDbActions(db).deleteRoutine(STARTER_ROUTINE_IDS[0]);

    expect(await seedStarterRoutinesIfEmpty(db)).toBe(0);
    const ids = (await db.get('routines').query().fetch()).map((r) => r.id);
    expect(ids).not.toContain(STARTER_ROUTINE_IDS[0]);
    expect(ids.sort()).toEqual([STARTER_ROUTINE_IDS[1], STARTER_ROUTINE_IDS[2]].sort());
  });

  it('never overwrites a starter the user edited (custom prescription survives repair)', async () => {
    const db = makeDb();
    await seedStarterRoutinesIfEmpty(db);
    const actions = makeDbActions(db);

    const draft = await actions.loadRoutineDraft(STARTER_ROUTINE_IDS[0]);
    draft.name = 'My tuned full body';
    draft.blocks[0].steps[0].prescription.targetSets = 5;
    await actions.saveRoutineDraft(draft);

    // Re-running the seeder must leave the edit intact.
    await seedStarterRoutinesIfEmpty(db);
    const after = await actions.loadRoutineDraft(STARTER_ROUTINE_IDS[0]);
    expect(after.name).toBe('My tuned full body');
    expect(after.blocks[0].steps[0].prescription.targetSets).toBe(5);
  });

  it('does not touch pre-existing user routines', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    const userId = await actions.createRoutine('User Routine');

    await seedStarterRoutinesIfEmpty(db);
    const ids = (await db.get('routines').query().fetch()).map((r) => r.id);
    expect(ids).toContain(userId);
    expect(await actions.loadRoutineDraft(userId)).toMatchObject({ name: 'User Routine' });
  });

  it('every starter step resolves to an existing library exercise (no dangling refs)', async () => {
    const db = makeDb();
    await seedStarterRoutinesIfEmpty(db);
    const actions = makeDbActions(db);

    for (const starter of STARTER_ROUTINES) {
      const draft = await actions.loadRoutineDraft(starter.id);
      for (const step of draft.blocks[0].steps) {
        expect(step.exerciseId).toBeTruthy();
        const found = await db.get('exercises').find(step.exerciseId!);
        expect(found.id).toBe(step.exerciseId);
      }
    }
  });

  it('buildTemplateDraft seeds a deterministic id only when one is supplied', async () => {
    const db = makeDb();
    await makeDbActions(db).seedExercisesIfEmpty();
    const template = templateByKey('fullBody')!;

    const withId = await buildTemplateDraft(db, template, 'Full body', 'seed_routine_full_body');
    expect(withId.id).toBe('seed_routine_full_body');

    const withoutId = await buildTemplateDraft(db, template, 'Full body');
    expect(withoutId.id).toBeNull();
  });
});
