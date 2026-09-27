import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import { schema } from './schema';
import { migrations } from './migrations';
import { modelClasses } from './models';
import { makeDbActions } from './actions';
import { loadNextUp } from './scheduling';

function makeDb(): Database {
  const adapter = new LokiJSAdapter({
    dbName: `apexfoss-scheduling-test-${Math.random().toString(36).slice(2)}`,
    schema,
    migrations,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
  });
  return new Database({ adapter, modelClasses: modelClasses as any });
}

const T = 1_700_000_000_000;

async function seedProgram(db: Database): Promise<{ programId: string; dayA: string; dayB: string }> {
  const actions = makeDbActions(db);
  const programId = await actions.createProgram('Block A');
  const dayA = await actions.createRoutine('Day A');
  const dayB = await actions.createRoutine('Day B');
  await actions.assignRoutineToProgram(dayA, programId);
  await actions.assignRoutineToProgram(dayB, programId);
  return { programId, dayA, dayB };
}

async function addSession(db: Database, routineId: string, startedAt: number): Promise<void> {
  await db.write(async () => {
    await db.get<any>('workout_sessions').create((rec: any) => {
      rec.routineId = routineId;
      rec.name = 'Session';
      rec.startedAt = startedAt;
      rec.endedAt = startedAt + 3600_000;
      rec.sessionStatus = 'completed';
      rec.definitionJson = '{}';
      rec.cursorJson = '{}';
      rec.currentBlockIndex = 0;
      rec.currentStepId = null;
      rec.currentRound = 1;
      rec.currentSetIndex = 0;
      rec.timerExpiresAt = null;
      rec.createdAt = startedAt;
      rec.updatedAt = startedAt;
    });
  });
}

describe('loadNextUp (Phase 4C)', () => {
  it('is null without programs or without member routines', async () => {
    expect(await loadNextUp(makeDb())).toBeNull();

    const db = makeDb();
    await makeDbActions(db).createProgram('Empty');
    expect(await loadNextUp(db)).toBeNull();
  });

  it('suggests the first-authored routine when nothing is trained yet', async () => {
    const db = makeDb();
    const { programId, dayA } = await seedProgram(db);
    const next = await loadNextUp(db);
    expect(next).toEqual({
      programId,
      programName: 'Block A',
      routineId: dayA,
      routineName: 'Day A',
      neverTrained: true,
      memberCount: 2,
    });
  });

  it('rotates to the least-recently-trained member after sessions', async () => {
    const db = makeDb();
    const { dayA, dayB } = await seedProgram(db);
    await addSession(db, dayA, T);
    await addSession(db, dayB, T + 1000);
    const next = await loadNextUp(db);
    expect(next?.routineId).toBe(dayA); // dayA older → rotates back
    expect(next?.neverTrained).toBe(false);
  });

  it('picks the most recently active program when several exist', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    const stale = await actions.createProgram('Stale');
    const staleDay = await actions.createRoutine('Stale day');
    await actions.assignRoutineToProgram(staleDay, stale);
    await addSession(db, staleDay, T);

    const { programId, dayA, dayB } = await seedProgram(db);
    await addSession(db, dayA, T + 5000);

    const next = await loadNextUp(db);
    expect(next?.programId).toBe(programId);
    expect(next?.routineId).toBe(dayB); // never-trained dayB inside the active program
  });
});
