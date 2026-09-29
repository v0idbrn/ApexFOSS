import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import { schema } from '../data/schema';
import { migrations } from '../data/migrations';
import { modelClasses } from '../data/models';
import { makeDbActions } from '../data/actions';
import { emptyDraft } from '../types/draft';
import { startWorkoutSession, applyWorkoutEvent, loadWorkoutRuntime } from '../workout/runner';
import { createBackup, restoreBackup, serializeBackup, validateBackup } from './backup';
import { semanticChecksum } from './canonical';

/**
 * 1.1.0 backup coverage: incomplete status, exercise notes, explicit
 * substitutions, block roles and mesocycle stages round-trip through
 * .apexbackup (export → validate → restore).
 */

function makeDb(): Database {
  const adapter = new LokiJSAdapter({
    dbName: `apex-backupfields-${Math.random().toString(36).slice(2)}`,
    schema,
    migrations,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
  });
  return new Database({ adapter, modelClasses: modelClasses as any });
}

async function buildRichDb(db: Database) {
  const actions = makeDbActions(db);
  const exId = await actions.createExercise({ name: 'Bench', category: 'test', equipment: 'barbell', metricFlags: 7 });
  const subId = await actions.createExercise({ name: 'DB Press', category: 'test', equipment: 'dumbbell', metricFlags: 7 });
  const programId = await actions.createProgram('Base');
  const mesoId = await actions.createMesocycle(programId, 'Deload week');
  await actions.setMesocycleStage(mesoId, 'deload');
  const draft = emptyDraft();
  draft.name = 'Push';
  draft.blocks.push({
    localId: 'b1',
    name: 'Warmup block',
    kind: 'normal',
    role: 'warmup',
    rounds: 1,
    steps: [
      {
        localId: 's1',
        exerciseId: exId,
        exerciseName: 'Bench',
        prescription: {
          targetSets: 1,
          targetRepsMin: 5,
          targetRepsMax: 5,
          targetWeightGrams: 60_000,
          targetDurationMs: null,
          targetRir: 2,
          tempo: { eccentricMs: null, pauseBottomMs: null, concentricMs: null, pauseTopMs: null },
        },
        transition: { type: 'immediate', delayMs: 0 },
      },
    ],
  });
  const routineId = await actions.saveRoutineDraft(draft);
  await actions.assignRoutineToProgram(routineId, programId);
  await actions.assignRoutineToMesocycle(routineId, mesoId);
  const sessionId = await startWorkoutSession(db, routineId);
  await actions.substituteSessionExercise(sessionId, 0, 0, 'Bench', subId, 'DB Press', 'equipment_unavailable');
  await actions.setSessionExerciseNote(sessionId, 0, 0, 'Bench', 'Left shoulder tight');
  const rt = await loadWorkoutRuntime(db, sessionId);
  await applyWorkoutEvent(db, rt!, {
    type: 'COMPLETE_SET',
    now: Date.now(),
    set: { weightGrams: 60_000, reps: 5, durationMs: null, distanceMm: null, rir: 1 },
  });
  await applyWorkoutEvent(db, rt!, { type: 'COMPLETE_SESSION', now: Date.now(), incompleteReason: 'fatigue' });
  return { routineId, sessionId };
}

describe('1.1.0 fields in .apexbackup', () => {
  it('exports incomplete status, notes, substitution, role and stage', async () => {
    const db = makeDb();
    await buildRichDb(db);
    const backup = await createBackup(db);
    expect(backup.data.sessions).toHaveLength(1);
    expect(backup.data.sessions[0].status).toBe('incomplete');
    const se = backup.data.sessionExercises;
    expect(se).toHaveLength(1);
    expect(se[0].exerciseName).toBe('Bench');
    expect(se[0].actualExerciseName).toBe('DB Press');
    expect(se[0].substitutionReason).toBe('equipment_unavailable');
    expect(se[0].exerciseNote).toBe('Left shoulder tight');
    expect(backup.data.routines[0].blocks[0].role).toBe('warmup');
    expect(backup.data.mesocycles).toHaveLength(1);
    expect(backup.data.mesocycles?.[0]?.stage).toBe('deload');
    expect(backup.data.setLogs[0].rir).toBe(1);
    expect(() => validateBackup(JSON.parse(serializeBackup(backup)))).not.toThrow();
  });

  it('restores every 1.1.0 field into a fresh database', async () => {
    const db = makeDb();
    await buildRichDb(db);
    const backup = await createBackup(db);
    const db2 = makeDb();
    await restoreBackup(db2, serializeBackup(backup));
    const sessions = await db2.get<any>('workout_sessions').query().fetch();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionStatus).toBe('incomplete');
    const ses = await db2.get<any>('session_exercises').query().fetch();
    expect(ses).toHaveLength(1);
    expect(ses[0].exerciseName).toBe('Bench');
    expect(ses[0].actualExerciseName).toBe('DB Press');
    expect(ses[0].substitutionReason).toBe('equipment_unavailable');
    expect(ses[0].exerciseNote).toBe('Left shoulder tight');
    const blocks = await db2.get<any>('routine_blocks').query().fetch();
    expect(blocks[0].blockRole).toBe('warmup');
    const mesos = await db2.get<any>('mesocycles').query().fetch();
    expect(mesos[0].stage).toBe('deload');
    const logs = await db2.get<any>('set_logs').query().fetch();
    expect(logs[0].rir).toBe(1);
  });

  it('rejects hostile substitution and role values on import', async () => {
    const db = makeDb();
    await buildRichDb(db);
    const backup = await createBackup(db);
    const fresh = () => {
      const raw = JSON.parse(serializeBackup(backup));
      raw.checksum = semanticChecksum(raw.data);
      return raw;
    };
    const badKey = fresh();
    badKey.data.sessionExercises[0].actualExerciseKey = 'zzz-not-a-key';
    badKey.checksum = semanticChecksum(badKey.data);
    await expect(restoreBackup(makeDb(), JSON.stringify(badKey))).rejects.toMatchObject({
      code: 'dangling_exercise',
    });
    const badRole = fresh();
    badRole.data.routines[0].blocks[0].role = 'boss-mode';
    badRole.checksum = semanticChecksum(badRole.data);
    await expect(restoreBackup(makeDb(), JSON.stringify(badRole))).rejects.toMatchObject({
      code: 'invalid_string',
    });
    const badStage = fresh();
    badStage.data.mesocycles[0].stage = 'peak';
    badStage.checksum = semanticChecksum(badStage.data);
    await expect(restoreBackup(makeDb(), JSON.stringify(badStage))).rejects.toMatchObject({
      code: 'invalid_string',
    });
  });

  it('legacy backups without the new fields still restore (nulls)', async () => {
    const db = makeDb();
    await buildRichDb(db);
    const backup = await createBackup(db);
    const raw = JSON.parse(serializeBackup(backup));
    delete raw.data.sessionExercises[0].exerciseNote;
    delete raw.data.sessionExercises[0].actualExerciseKey;
    delete raw.data.sessionExercises[0].actualExerciseName;
    delete raw.data.sessionExercises[0].substitutionReason;
    delete raw.data.routines[0].blocks[0].role;
    delete raw.data.mesocycles[0].stage;
    raw.checksum = semanticChecksum(raw.data);
    const db2 = makeDb();
    await restoreBackup(db2, JSON.stringify(raw));
    const ses = await db2.get<any>('session_exercises').query().fetch();
    expect(ses[0].exerciseNote).toBeNull();
    expect(ses[0].actualExerciseName).toBeNull();
    const blocks = await db2.get<any>('routine_blocks').query().fetch();
    expect(blocks[0].blockRole).toBeNull();
    const mesos = await db2.get<any>('mesocycles').query().fetch();
    expect(mesos[0].stage).toBeNull();
  });
});
