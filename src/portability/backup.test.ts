import { Database, Q } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import { schema } from '../data/schema';
import { migrations } from '../data/migrations';
import { modelClasses } from '../data/models';
import { Routine, WorkoutSession } from '../data/models';
import { serializeRoutine } from '../data/serialize';
import { makeDbActions } from '../data/actions';
import { emptyPrescription, type RoutineDraft } from '../types/draft';
import { buildRoutinePackageFromDraft, serializeRoutinePackage, parseRoutinePackage } from './routinePackage';
import { importRoutinePackage, previewRoutineImport, uniqueRoutineName } from './importRoutine';
import { createBackup, restoreBackup, parseBackup, serializeBackup, backupSummary, validateBackup } from './backup';
import { replaceEquipmentItems, loadEquipmentItems } from '../data/equipment';
import { loadSessionNote, saveSessionNote, NOTE_MAX_LENGTH } from '../data/notes';
import { PortabilityError, BACKUP_FORMAT_VERSION } from './types';
import { semanticChecksum } from './canonical';

function makeDb(): Database {
  const adapter = new LokiJSAdapter({
    dbName: `apex-imp-${Math.random().toString(36).slice(2)}`,
    schema,
    migrations,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
  });
  return new Database({ adapter, modelClasses: modelClasses as any });
}

function draftWith(name: string): RoutineDraft {
  return {
    id: null,
    name,
    blocks: [
      {
        localId: 'b1',
        name: 'A',
        kind: 'normal',
        rounds: 2,
        steps: [
          {
            localId: 's1',
            exerciseId: 'ex_local',
            exerciseName: 'Back Squat',
            prescription: { ...emptyPrescription(), targetSets: 5, targetRepsMin: 3, targetRepsMax: 5 },
            transition: { type: 'immediate', delayMs: 0 },
          },
          {
            localId: 's2',
            exerciseId: null,
            exerciseName: '',
            prescription: emptyPrescription(),
            transition: { type: 'rest', delayMs: 60_000 },
          },
        ],
      },
      {
        localId: 'b2',
        name: 'Int',
        kind: 'interval',
        rounds: 1,
        interval: { mode: 'hiit', workMs: 20_000, restMs: 10_000, rounds: 4, periodMs: null, preparationMs: 0 },
        steps: [
          {
            localId: 's3',
            exerciseId: 'ex_local',
            exerciseName: 'Back Squat',
            prescription: emptyPrescription(),
            transition: { type: 'immediate', delayMs: 0 },
          },
        ],
      },
    ],
  };
}

function packageFor(name: string, metaMap: Map<string, any>, at = 1000) {
  return buildRoutinePackageFromDraft(draftWith(name), metaMap, at);
}

describe('routine import — atomic success', () => {
  it('imports on fresh install creating exercises and routine', async () => {
    const db = makeDb();
    const meta = new Map([
      ['ex_local', { name: 'Back Squat', category: 'legs', equipment: 'barbell', metricFlags: 3 }],
    ]);
    const pkg = packageFor('Fresh', meta);
    const json = serializeRoutinePackage(pkg);

    const before = (await db.get('exercises').query().fetchCount());
    expect(before).toBe(0);

    const result = await importRoutinePackage(db, json);
    expect(result.createdExercises).toBe(1);
    expect(result.reusedExercises).toBe(0);
    expect(result.routineName).toBe('Fresh');

    const exercises = (await db.get('exercises').query().fetch()) as unknown as Array<{ name: string; id: string }>;
    expect(exercises).toHaveLength(1);
    expect(exercises[0].name).toBe('Back Squat');

    const routines = await db.get('routines').query().fetch();
    expect(routines).toHaveLength(1);

    const steps = (await db.get('routine_block_steps').query().fetch()) as unknown as Array<{
      exerciseId: string | null;
    }>;
    expect(steps).toHaveLength(3); // 2 + interval step

    // references resolve to the created exercise for work steps
    const workSteps = steps.filter((s) => s.exerciseId);
    expect(workSteps).toHaveLength(2);
    expect(workSteps.every((s) => s.exerciseId === exercises[0].id)).toBe(true);
  });

  it('reuses equivalent existing exercise and does not duplicate', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    const localId = await actions.createExercise({
      name: 'Back Squat',
      category: 'legs',
      equipment: 'barbell',
      metricFlags: 3,
    });
    const meta = new Map([
      ['ex_local', { name: 'Back Squat', category: 'legs', equipment: 'barbell', metricFlags: 3 }],
    ]);
    const pkg = packageFor('Reuse', meta);
    const result = await importRoutinePackage(db, serializeRoutinePackage(pkg));
    expect(result.reusedExercises).toBe(1);
    expect(result.createdExercises).toBe(0);
    const exercises = (await db.get('exercises').query().fetch()) as unknown as Array<{ id: string }>;
    expect(exercises).toHaveLength(1);
    expect(exercises[0].id).toBe(localId);

    const steps = (await db.get('routine_block_steps').query().fetch()) as unknown as Array<{
      exerciseId: string | null;
    }>;
    const referenced = steps.filter((s) => s.exerciseId);
    expect(referenced.every((s) => s.exerciseId === localId)).toBe(true);
  });

  it('duplicate import creates renamed copy reusing exercises', async () => {
    const db = makeDb();
    const meta = new Map([
      ['ex_local', { name: 'Back Squat', category: 'legs', equipment: 'barbell', metricFlags: 3 }],
    ]);
    const pkg = packageFor('Same', meta);
    const json = serializeRoutinePackage(pkg);
    const first = await importRoutinePackage(db, json);
    const second = await importRoutinePackage(db, json);
    expect(second.routineName).toBe('Same (imported)');
    expect(second.routineId).not.toBe(first.routineId);
    expect(second.createdExercises).toBe(0);
    expect(second.reusedExercises).toBe(1);
    const routines = (await db.get('routines').query().fetch()) as unknown as Array<{ name: string }>;
    expect(routines.map((r) => r.name).sort()).toEqual(['Same', 'Same (imported)']);
    const exercises = await db.get('exercises').query().fetch();
    expect(exercises).toHaveLength(1);
  });

  it('preview does not mutate database', async () => {
    const db = makeDb();
    const meta = new Map([
      ['ex_local', { name: 'Back Squat', category: 'legs', equipment: 'barbell', metricFlags: 3 }],
    ]);
    const pkg = packageFor('Preview', meta);
    const preview = await previewRoutineImport(db, serializeRoutinePackage(pkg));
    expect(preview.routineName).toBe('Preview');
    expect(preview.blockCount).toBe(2);
    expect(preview.stepCount).toBe(3);
    expect(preview.exerciseCount).toBe(1);
    expect(preview.formatVersion).toBe(1);
    expect(await db.get('routines').query().fetchCount()).toBe(0);
    expect(await db.get('exercises').query().fetchCount()).toBe(0);
  });

  it('rejects invalid package before any mutation', async () => {
    const db = makeDb();
    await expect(importRoutinePackage(db, '{"format":"nope"}')).rejects.toBeInstanceOf(PortabilityError);
    expect(await db.get('routines').query().fetchCount()).toBe(0);
    expect(await db.get('exercises').query().fetchCount()).toBe(0);
  });

  it('rollback on mid-write failure leaves no partial rows', async () => {
    const db = makeDb();
    const meta = new Map([
      ['ex_local', { name: 'Back Squat', category: 'legs', equipment: 'barbell', metricFlags: 3 }],
    ]);
    const pkg = packageFor('Rollback', meta);
    const json = serializeRoutinePackage(pkg);
    const exBefore = await db.get('exercises').query().fetchCount();
    const routineBefore = await db.get('routines').query().fetchCount();

    await expect(
      importRoutinePackage(db, json, {
        onRowCreated: (table) => {
          if (table === 'routines') throw new Error('forced failure');
        },
      }),
    ).rejects.toThrow('forced failure');

    expect(await db.get('exercises').query().fetchCount()).toBe(exBefore);
    expect(await db.get('routines').query().fetchCount()).toBe(routineBefore);
    expect(await db.get('routine_blocks').query().fetchCount()).toBe(0);
  });

  it('round trip: export → import → export semantic equality', async () => {
    const db = makeDb();
    const meta = new Map([
      ['ex_local', { name: 'Back Squat', category: 'legs', equipment: 'barbell', metricFlags: 3 }],
    ]);
    const pkg = packageFor('RoundTrip', meta);
    const result = await importRoutinePackage(db, serializeRoutinePackage(pkg));

    // rebuild package from imported draft
    const draft = await makeDbActions(db).loadRoutineDraft(result.routineId);
    const newMeta = new Map<string, any>();
    const exRows = (await db.get('exercises').query().fetch()) as unknown as Array<{
      id: string;
      name: string;
      category: string;
      equipment: string;
      metricFlags: number;
    }>;
    for (const ex of exRows) {
      newMeta.set(ex.id, { name: ex.name, category: ex.category, equipment: ex.equipment, metricFlags: ex.metricFlags });
    }
    const again = buildRoutinePackageFromDraft(draft, newMeta, 2000);
    expect(again.routine.name).toBe('RoundTrip');
    expect(again.routine.blocks).toEqual(pkg.routine.blocks);
    expect(again.exercises).toEqual(pkg.exercises);
    expect(again.checksum).toBe(pkg.checksum);
  });
});

describe('backup create / restore', () => {
  it('empty database backup validates', async () => {
    const db = makeDb();
    const b = await createBackup(db);
    expect(b.format).toBe('apexfoss-backup');
    expect(b.formatVersion).toBe(BACKUP_FORMAT_VERSION);
    expect(b.data.routines).toHaveLength(0);
    expect(b.data.sessions).toHaveLength(0);
    const parsed = parseBackup(serializeBackup(b));
    expect(parsed.checksum).toBe(b.checksum);
  });

  it('populated backup preserves routines sessions set logs', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    const exerciseId = await actions.createExercise({
      name: 'Deadlift',
      category: 'legs',
      equipment: 'barbell',
      metricFlags: 3,
    });
    const routineId = await actions.createRoutine('Pull');
    const blockId = await actions.createBlock(routineId, { name: 'Main', kind: 'normal', rounds: 2 });
    const stepId = await actions.createStep(blockId, exerciseId, 'Deadlift');
    await actions.upsertPrescription(stepId, {
      targetSets: 3,
      targetRepsMin: 5,
      targetRepsMax: 5,
      targetDurationMs: null,
      targetWeightGrams: 140000,
      targetRir: 1,
      tempo: { eccentricMs: 2000, pauseBottomMs: 0, concentricMs: 1000, pauseTopMs: 0 },
    });
    await actions.upsertTransition(blockId, stepId, { toStepId: null }, 'rest', 120_000);

    // session + logs via start/complete path
    const routine = (await db.get('routines').find(routineId)) as InstanceType<typeof Routine>;
    const def = await serializeRoutine(db, routine);
    const sessionId = await actions.startSession(routine as any, def);
    const session = (await db.get('workout_sessions').find(sessionId)) as InstanceType<typeof WorkoutSession>;
    await actions.applyEffects(session, {
      status: 'completed',
      blockIndex: 0,
      stepIndex: 0,
      round: 1,
      setIndex: 0,
      timer: null,
      lastReversible: null,
      startedAt: Date.now(),
    }, [
      {
        kind: 'LOG_SET',
        blockIndex: 0,
        stepIndex: 0,
        round: 1,
        setIndex: 0,
        set: { weightGrams: 140000, reps: 5, durationMs: null, distanceMm: null, rir: 1 },
      },
    ]);
    await actions.completeSession(session, {
      status: 'completed',
      blockIndex: 0,
      stepIndex: 0,
      round: 1,
      setIndex: 1,
      timer: null,
      lastReversible: null,
      startedAt: Date.now(),
    });

    const backup = await createBackup(db);
    expect(backup.data.routines).toHaveLength(1);
    expect(backup.data.routines[0].blocks[0].steps).toHaveLength(1);
    expect(backup.data.routines[0].blocks[0].steps[0].prescription.targetWeightGrams).toBe(140000);
    expect(backup.data.sessions).toHaveLength(1);
    expect(backup.data.sessions[0].status).toBe('completed');
    expect(backup.data.setLogs.length).toBeGreaterThanOrEqual(1);
    expect(backup.data.exercises).toHaveLength(1);

    // restore into a fresh DB
    const db2 = makeDb();
    await restoreBackup(db2, serializeBackup(backup));
    expect(await db2.get('exercises').query().fetchCount()).toBe(1);
    expect(await db2.get('routines').query().fetchCount()).toBe(1);
    expect(await db2.get('workout_sessions').query().fetchCount()).toBe(1);
    expect(await db2.get('set_logs').query().fetchCount()).toBe(backup.data.setLogs.length);
    const restoredRoutine = ((await db2.get('routines').query().fetch()) as unknown as Array<{ name: string }>)[0];
    expect(restoredRoutine.name).toBe('Pull');
    const restoredEx = ((await db2.get('exercises').query().fetch()) as unknown as Array<{
      name: string;
      id: string;
    }>)[0];
    expect(restoredEx.name).toBe('Deadlift');
    const steps = await db2.get('routine_block_steps').query(Q.where('exercise_id', restoredEx.id)).fetch();
    expect(steps.length).toBeGreaterThanOrEqual(1);
  });

  it('restore replaces existing data (full replace policy)', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    await actions.createExercise({ name: 'Old', category: 'x', equipment: 'y', metricFlags: 1 });
    await actions.createRoutine('OldRoutine');

    const empty = await createBackup(makeDb()); // empty backup
    await restoreBackup(db, serializeBackup(empty));
    expect(await db.get('exercises').query().fetchCount()).toBe(0);
    expect(await db.get('routines').query().fetchCount()).toBe(0);
  });

  it('rejects corrupt checksum without mutating db', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    await actions.createRoutine('KeepMe');
    const backup = await createBackup(db);
    const raw = JSON.parse(serializeBackup(backup));
    raw.data.routines[0].name = 'Tampered';
    await expect(restoreBackup(db, JSON.stringify(raw))).rejects.toMatchObject({
      code: 'checksum_mismatch',
    });
    expect(await db.get('routines').query().fetchCount()).toBe(1);
    const kept = (await db.get('routines').query().fetch()) as unknown as Array<{ name: string }>;
    expect(kept[0].name).toBe('KeepMe');
  });

  it('rejects wrong format and unsupported version', async () => {
    expect(() => parseBackup('{"format":"nope"}')).toThrow(expect.objectContaining({ code: 'wrong_format' }));
    const db = makeDb();
    const b = await createBackup(db);
    const raw = JSON.parse(serializeBackup(b));
    raw.formatVersion = 99;
    expect(() => parseBackup(JSON.stringify(raw))).toThrow(
      expect.objectContaining({ code: 'unsupported_backup_version' }),
    );
  });

  it('rejects dangling references in backup', async () => {
    const db = makeDb();
    const b = await createBackup(db);
    const raw = JSON.parse(serializeBackup(b));
    raw.data.routines = [
      {
        name: 'R',
        blocks: [
          {
            name: 'B',
            kind: 'normal',
            rounds: 1,
            interval: null,
            steps: [
              {
                role: 'work',
                exerciseKey: 'e999',
                exerciseName: 'Ghost',
                prescription: {
                  targetSets: null,
                  targetRepsMin: null,
                  targetRepsMax: null,
                  targetDurationMs: null,
                  targetWeightGrams: null,
                  targetRir: null,
                  tempo: { eccentricMs: null, pauseBottomMs: null, concentricMs: null, pauseTopMs: null },
                },
                transition: { type: 'immediate', delayMs: 0 },
              },
            ],
          },
        ],
      },
    ];
    raw.checksum = semanticChecksum(raw.data);
    expect(() => parseBackup(JSON.stringify(raw))).toThrow(expect.objectContaining({ code: 'dangling_exercise' }));
  });

  it('rollback on restore failure leaves original data', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    await actions.createRoutine('Survivor');
    const backup = await createBackup(db);

    // Create a valid backup of a different populated db to restore "over"
    const dbSrc = makeDb();
    const srcActions = makeDbActions(dbSrc);
    await srcActions.createExercise({ name: 'NewEx', category: 'c', equipment: 'e', metricFlags: 1 });
    await srcActions.createRoutine('Incoming');
    const good = await createBackup(dbSrc);

    await expect(
      restoreBackup(db, serializeBackup(good), {
        onRowCreated: (table) => {
          if (table === 'routines') throw new Error('restore boom');
        },
      }),
    ).rejects.toThrow('restore boom');

    const routines = (await db.get('routines').query().fetch()) as unknown as Array<{ name: string }>;
    expect(routines.map((r) => r.name)).toEqual(['Survivor']);
    expect(await db.get('exercises').query().fetchCount()).toBe(0);
    void backup;
  });

  it('backupSummary counts', async () => {
    const db = makeDb();
    const b = await createBackup(db);
    expect(backupSummary(b)).toEqual({
      exercises: 0,
      routines: 0,
      sessions: 0,
      setLogs: 0,
      readinessTests: 0,
      equipmentItems: 0,
      programs: 0,
    });
  });

  it('validateBackup rejects invalid JSON structure', () => {
    expect(() => validateBackup(null)).toThrow(PortabilityError);
    expect(() => validateBackup([1, 2])).toThrow(PortabilityError);
  });
});

describe('equipment inventory portability (schema v4)', () => {
  it('createBackup carries equipment items and restore round-trips them', async () => {
    const db = makeDb();
    await replaceEquipmentItems(db, [
      { name: 'Plate 20kg', weightGrams: 20_000, quantity: 4 },
      { name: 'Fractional 1.25kg', weightGrams: 1_250, quantity: 2, perSide: true },
    ]);
    const b = await createBackup(db);
    expect(b.data.equipmentItems).toHaveLength(2);
    expect(b.data.equipmentItems).toEqual(
      expect.arrayContaining([
        { name: 'Plate 20kg', weightGrams: 20_000, quantity: 4, perSide: false },
        { name: 'Fractional 1.25kg', weightGrams: 1_250, quantity: 2, perSide: true },
      ]),
    );
    expect(backupSummary(b).equipmentItems).toBe(2);

    const target = makeDb();
    await replaceEquipmentItems(target, [{ name: 'Stale', weightGrams: 5_000, quantity: 1 }]);
    await restoreBackup(target, serializeBackup(b));
    const restored = await loadEquipmentItems(target);
    expect(restored.map((i) => i.name).sort()).toEqual(['Fractional 1.25kg', 'Plate 20kg']);
    expect(restored.find((i) => i.name === 'Plate 20kg')).toMatchObject({
      weightGrams: 20_000,
      quantity: 4,
      perSide: false,
    });
    expect(restored.find((i) => i.name === 'Fractional 1.25kg')?.perSide).toBe(true);
  });

  it('older backups without equipmentItems validate and restore as empty', async () => {
    const db = makeDb();
    const b = await createBackup(db);
    const legacy = JSON.parse(serializeBackup(b)) as any;
    delete legacy.data.equipmentItems;
    legacy.checksum = semanticChecksum(legacy.data);

    const parsed = parseBackup(JSON.stringify(legacy));
    expect(parsed.data.equipmentItems).toBeUndefined();

    const target = makeDb();
    await replaceEquipmentItems(target, [{ name: 'Old plate', weightGrams: 10_000, quantity: 2 }]);
    await restoreBackup(target, JSON.stringify(legacy));
    expect(await loadEquipmentItems(target)).toEqual([]);
  });

  it('rejects malformed equipment entries before the checksum', async () => {
    const db = makeDb();
    const b = await createBackup(db);
    const bad = JSON.parse(serializeBackup(b)) as any;
    bad.data.equipmentItems = [{ name: 'Bad', weightGrams: -1, quantity: 1, perSide: false }];
    bad.checksum = semanticChecksum(bad.data);
    expect(() => parseBackup(JSON.stringify(bad))).toThrow(
      expect.objectContaining({ code: 'invalid_integer' }),
    );

    const badBool = JSON.parse(serializeBackup(b)) as any;
    badBool.data.equipmentItems = [{ name: 'Bad', weightGrams: 1000, quantity: 1, perSide: 'yes' }];
    badBool.checksum = semanticChecksum(badBool.data);
    expect(() => parseBackup(JSON.stringify(badBool))).toThrow(
      expect.objectContaining({ code: 'invalid_boolean' }),
    );
  });
});

describe('session notes portability (schema v5)', () => {
  async function createSession(db: Database, name = 'Noted Session'): Promise<string> {
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

  it('session note round-trips through create → validate → restore', async () => {
    const db = makeDb();
    const id = await createSession(db);
    await saveSessionNote(db, id, 'Grip felt off, used straps on the last set');

    const b = await createBackup(db);
    expect(b.data.sessions).toHaveLength(1);
    expect(b.data.sessions[0].note).toBe('Grip felt off, used straps on the last set');

    const parsed = parseBackup(serializeBackup(b));
    expect(parsed.data.sessions[0].note).toBe('Grip felt off, used straps on the last set');

    const target = makeDb();
    await restoreBackup(target, serializeBackup(b));
    const rows = (await target.get('workout_sessions').query().fetch()) as unknown as Array<{
      id: string;
      note: string | null;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].note).toBe('Grip felt off, used straps on the last set');
    expect(await loadSessionNote(target, rows[0].id)).toBe('Grip felt off, used straps on the last set');
  });

  it('backups without a note field remain valid (pre-v5)', async () => {
    const b = await createBackup(makeDb());
    const legacy = JSON.parse(serializeBackup(b)) as any;
    legacy.data.sessions.push({
      routineIndex: null,
      name: 'Legacy Session',
      startedAt: 1_700_000_000_000,
      endedAt: null,
      status: 'completed',
      definitionJson: '{"id":"r1","name":"Legacy","blocks":[]}',
      cursorJson: '{"status":"completed"}',
      currentBlockIndex: 0,
      currentStepId: null,
      currentRound: 1,
      currentSetIndex: 0,
      timerExpiresAt: null,
    });
    legacy.checksum = semanticChecksum(legacy.data);

    const parsed = parseBackup(JSON.stringify(legacy));
    expect(parsed.data.sessions[0].note).toBeUndefined();

    const target = makeDb();
    await restoreBackup(target, JSON.stringify(legacy));
    const rows = (await target.get('workout_sessions').query().fetch()) as unknown as Array<{
      note: string | null;
    }>;
    expect(rows[0].note).toBeNull();
  });

  it('rejects non-string and oversized session notes before the checksum', async () => {
    const b = await createBackup(makeDb());

    const badType = JSON.parse(serializeBackup(b)) as any;
    badType.data.sessions.push({
      routineIndex: null,
      name: 'S',
      startedAt: 1,
      endedAt: null,
      status: 'completed',
      definitionJson: '{}',
      cursorJson: '{}',
      currentBlockIndex: 0,
      currentStepId: null,
      currentRound: 1,
      currentSetIndex: 0,
      timerExpiresAt: null,
      note: 123,
    });
    badType.checksum = semanticChecksum(badType.data);
    expect(() => parseBackup(JSON.stringify(badType))).toThrow(
      expect.objectContaining({ code: 'invalid_string' }),
    );

    const tooLong = JSON.parse(serializeBackup(b)) as any;
    tooLong.data.sessions.push({
      routineIndex: null,
      name: 'S',
      startedAt: 1,
      endedAt: null,
      status: 'completed',
      definitionJson: '{}',
      cursorJson: '{}',
      currentBlockIndex: 0,
      currentStepId: null,
      currentRound: 1,
      currentSetIndex: 0,
      timerExpiresAt: null,
      note: 'x'.repeat(NOTE_MAX_LENGTH + 1),
    });
    tooLong.checksum = semanticChecksum(tooLong.data);
    expect(() => parseBackup(JSON.stringify(tooLong))).toThrow(
      expect.objectContaining({ code: 'invalid_string' }),
    );
  });
});

describe('adaptive execution portability (schema v7)', () => {
  async function dbWithExecutionRows(): Promise<Database> {
    const db = makeDb();
    const actions = makeDbActions(db);
    const exerciseId = await actions.createExercise({
      name: 'Squat',
      category: 'legs',
      equipment: 'barbell',
      metricFlags: 3,
    });
    const routineId = await actions.createRoutine('Legs');
    const blockId = await actions.createBlock(routineId, { name: 'Main', kind: 'normal', rounds: 1 });
    const stepId = await actions.createStep(blockId, exerciseId, 'Squat');
    await actions.upsertPrescription(stepId, {
      targetSets: 3,
      targetRepsMin: 5,
      targetRepsMax: 5,
      targetDurationMs: null,
      targetWeightGrams: 100000,
      targetRir: 2,
      tempo: { eccentricMs: null, pauseBottomMs: null, concentricMs: null, pauseTopMs: null },
    });
    await actions.upsertTransition(blockId, stepId, { toStepId: null }, 'immediate', 0);
    const routine = (await db.get('routines').find(routineId)) as InstanceType<typeof Routine>;
    const def = await serializeRoutine(db, routine);
    const sessionId = await actions.startSession(routine as any, def);
    const session = (await db.get('workout_sessions').find(sessionId)) as InstanceType<typeof WorkoutSession>;
    const cursor = {
      status: 'completed',
      blockIndex: 0,
      stepIndex: 0,
      round: 1,
      setIndex: 0,
      timer: null,
      lastReversible: null,
      startedAt: Date.now(),
    } as const;
    await actions.applyEffects(session, cursor as never, [
      {
        kind: 'LOG_SET',
        blockIndex: 0,
        stepIndex: 0,
        round: 1,
        setIndex: 1,
        set: { weightGrams: 90000, reps: 5, durationMs: null, distanceMm: null, rir: 2, overrideReason: 'load_reduced' },
      },
      { kind: 'LOG_SKIPPED_SET', blockIndex: 0, stepIndex: 0, round: 1, setIndex: 2 },
      {
        kind: 'LOG_SET',
        blockIndex: 0,
        stepIndex: 0,
        round: 1,
        setIndex: 4,
        set: { weightGrams: 60000, reps: 8, durationMs: null, distanceMm: null, rir: null },
        executionType: 'drop',
      },
    ]);
    await actions.completeSession(session, cursor as never);
    return db;
  }

  it('execution metadata round-trips through create → validate → restore', async () => {
    const db = await dbWithExecutionRows();
    const backup = await createBackup(db);
    const bySetIndex = new Map(backup.data.setLogs.map((l) => [l.setIndex, l]));
    expect(bySetIndex.get(1)).toMatchObject({ executionType: 'modified', overrideReason: 'load_reduced' });
    expect(bySetIndex.get(2)).toMatchObject({ executionType: 'skipped', overrideReason: null });
    expect(bySetIndex.get(4)).toMatchObject({ executionType: 'drop', overrideReason: null });

    const db2 = makeDb();
    await restoreBackup(db2, serializeBackup(backup));
    const rows = (await db2.get('set_logs').query().fetch()) as unknown as Array<{
      setIndex: number;
      executionType: string | null;
      overrideReason: string | null;
      isCompleted: number;
    }>;
    const byIdx = new Map(rows.map((r) => [r.setIndex, r]));
    expect(byIdx.get(1)).toMatchObject({ executionType: 'modified', overrideReason: 'load_reduced', isCompleted: 1 });
    expect(byIdx.get(2)).toMatchObject({ executionType: 'skipped', overrideReason: null, isCompleted: 0 });
    expect(byIdx.get(4)).toMatchObject({ executionType: 'drop', overrideReason: null, isCompleted: 1 });
  });

  it('older backups without execution fields remain valid and restore as legacy nulls', async () => {
    const db = await dbWithExecutionRows();
    const backup = await createBackup(db);
    const raw = JSON.parse(serializeBackup(backup)) as any;
    for (const log of raw.data.setLogs) {
      delete log.executionType;
      delete log.overrideReason;
    }
    raw.checksum = semanticChecksum(raw.data);
    const parsed = parseBackup(JSON.stringify(raw));
    expect(parsed.data.setLogs.every((l) => l.executionType === undefined && l.overrideReason === undefined)).toBe(true);

    const db2 = makeDb();
    await restoreBackup(db2, JSON.stringify(raw));
    const rows = (await db2.get('set_logs').query().fetch()) as unknown as Array<{
      executionType: string | null;
      overrideReason: string | null;
    }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.executionType).toBeNull();
      expect(r.overrideReason).toBeNull();
    }
  });

  it('rejects invalid execution metadata before the checksum', async () => {
    const db = await dbWithExecutionRows();
    const b = await createBackup(db);
    const badType = JSON.parse(serializeBackup(b)) as any;
    badType.data.setLogs[0].executionType = 'deleted';
    badType.checksum = semanticChecksum(badType.data);
    expect(() => parseBackup(JSON.stringify(badType))).toThrow(
      expect.objectContaining({ code: 'invalid_string' }),
    );

    const badReason = JSON.parse(serializeBackup(b)) as any;
    badReason.data.setLogs[0].executionType = 'modified';
    badReason.data.setLogs[0].overrideReason = 'tired';
    badReason.checksum = semanticChecksum(badReason.data);
    expect(() => parseBackup(JSON.stringify(badReason))).toThrow(
      expect.objectContaining({ code: 'invalid_string' }),
    );
  });
});

describe('program portability (schema v8)', () => {
  async function dbWithProgram(): Promise<Database> {
    const db = makeDb();
    const actions = makeDbActions(db);
    const exerciseId = await actions.createExercise({
      name: 'Squat',
      category: 'legs',
      equipment: 'barbell',
      metricFlags: 3,
    });
    const programId = await actions.createProgram('Strength base');
    const dayA = await actions.createRoutine('Day A');
    const blockId = await actions.createBlock(dayA, { name: 'Main', kind: 'normal', rounds: 1 });
    await actions.createStep(blockId, exerciseId, 'Squat');
    await actions.assignRoutineToProgram(dayA, programId);
    const dayB = await actions.createRoutine('Day B');
    await actions.assignRoutineToProgram(dayB, programId);
    await actions.createRoutine('Loose day'); // stays unassigned
    return db;
  }

  it('programs and membership round-trip through create → validate → restore', async () => {
    const db = await dbWithProgram();
    const backup = await createBackup(db);
    expect(backup.data.programs).toEqual([{ name: 'Strength base' }]);
    const byName = new Map(backup.data.routines.map((r) => [r.name, r]));
    expect(byName.get('Day A')).toMatchObject({ programIndex: 0, programOrder: 1 });
    expect(byName.get('Day B')).toMatchObject({ programIndex: 0, programOrder: 2 });
    expect(byName.get('Loose day')).toMatchObject({ programIndex: null });
    expect(backupSummary(backup).programs).toBe(1);

    const db2 = makeDb();
    await restoreBackup(db2, serializeBackup(backup));
    const actions2 = makeDbActions(db2);
    const programs = await actions2.listProgramsWithCounts();
    expect(programs).toHaveLength(1);
    expect(programs[0].name).toBe('Strength base');
    expect(programs[0].routineCount).toBe(2);
    const members = await actions2.listProgramRoutines(programs[0].id);
    expect(members.map((m) => m.name)).toEqual(['Day A', 'Day B']);
    expect(members.map((m) => m.order)).toEqual([1, 2]);
    const unassigned = await actions2.listUnassignedRoutines();
    expect(unassigned.map((r) => r.name)).toEqual(['Loose day']);
  });

  it('older backups without programs validate and restore as unassigned', async () => {
    const db = await dbWithProgram();
    const backup = await createBackup(db);
    const raw = JSON.parse(serializeBackup(backup)) as any;
    delete raw.data.programs;
    for (const r of raw.data.routines) {
      delete r.programIndex;
      delete r.programOrder;
    }
    raw.checksum = semanticChecksum(raw.data);
    const parsed = parseBackup(JSON.stringify(raw));
    expect(parsed.data.programs).toBeUndefined();

    const db2 = makeDb();
    await restoreBackup(db2, JSON.stringify(raw));
    const actions2 = makeDbActions(db2);
    expect(await actions2.listProgramsWithCounts()).toEqual([]);
    const unassigned = await actions2.listUnassignedRoutines();
    expect(unassigned.map((r) => r.name).sort()).toEqual(['Day A', 'Day B', 'Loose day']);
  });

  it('rejects invalid program data before the checksum', async () => {
    const db = await dbWithProgram();
    const b = await createBackup(db);

    const dangling = JSON.parse(serializeBackup(b)) as any;
    dangling.data.routines[0].programIndex = 5;
    dangling.checksum = semanticChecksum(dangling.data);
    expect(() => parseBackup(JSON.stringify(dangling))).toThrow(
      expect.objectContaining({ code: 'invalid_reference' }),
    );

    const notArray = JSON.parse(serializeBackup(b)) as any;
    notArray.data.programs = 'nope';
    notArray.checksum = semanticChecksum(notArray.data);
    expect(() => parseBackup(JSON.stringify(notArray))).toThrow(
      expect.objectContaining({ code: 'missing_field' }),
    );

    const nameless = JSON.parse(serializeBackup(b)) as any;
    nameless.data.programs[0] = {};
    nameless.checksum = semanticChecksum(nameless.data);
    expect(() => parseBackup(JSON.stringify(nameless))).toThrow(
      expect.objectContaining({ code: 'invalid_string' }),
    );
  });
});

describe('helpers', () => {
  it('uniqueRoutineName exported and deterministic', () => {
    expect(uniqueRoutineName('A', new Set())).toBe('A');
    expect(uniqueRoutineName('A', new Set(['A']))).toBe('A (imported)');
  });
});
