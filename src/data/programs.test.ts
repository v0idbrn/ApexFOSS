import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import { schema } from './schema';
import { migrations } from './migrations';
import { modelClasses } from './models';
import { makeDbActions } from './actions';

function makeDb(): Database {
  const adapter = new LokiJSAdapter({
    dbName: `apexfoss-programs-test-${Math.random().toString(36).slice(2)}`,
    schema,
    migrations,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
  });
  return new Database({ adapter, modelClasses: modelClasses as any });
}

describe('program actions (Phase 4A)', () => {
  it('creates and lists programs with routine counts', async () => {
    const actions = makeDbActions(makeDb());
    expect(await actions.listProgramsWithCounts()).toEqual([]);
    const p1 = await actions.createProgram('Strength base');
    const p2 = await actions.createProgram('Hypertrophy block');
    expect(p1).not.toBe(p2);
    expect(await actions.listProgramsWithCounts()).toEqual([
      { id: p1, name: 'Strength base', routineCount: 0 },
      { id: p2, name: 'Hypertrophy block', routineCount: 0 },
    ]);
  });

  it('renames a program and rejects unknown ids', async () => {
    const actions = makeDbActions(makeDb());
    const p = await actions.createProgram('Old name');
    await actions.renameProgram(p, 'New name');
    expect((await actions.listProgramsWithCounts())[0].name).toBe('New name');
    await expect(actions.renameProgram('missing', 'X')).rejects.toThrow();
  });

  it('assigns routines appending order and lists them ordered', async () => {
    const actions = makeDbActions(makeDb());
    const p = await actions.createProgram('Block A');
    const r1 = await actions.createRoutine('Day 1');
    const r2 = await actions.createRoutine('Day 2');
    const r3 = await actions.createRoutine('Day 3');
    await actions.assignRoutineToProgram(r1, p);
    await actions.assignRoutineToProgram(r2, p);
    await actions.assignRoutineToProgram(r3, p);
    const members = await actions.listProgramRoutines(p);
    expect(members.map((m) => m.id)).toEqual([r1, r2, r3]);
    expect(members.map((m) => m.order)).toEqual([1, 2, 3]);
    expect((await actions.listProgramsWithCounts())[0].routineCount).toBe(3);
    expect(await actions.listUnassignedRoutines()).toEqual([]);
  });

  it('rejects assignment to a missing program', async () => {
    const actions = makeDbActions(makeDb());
    const r = await actions.createRoutine('Solo');
    await expect(actions.assignRoutineToProgram(r, 'missing-program')).rejects.toThrow();
    expect(await actions.listUnassignedRoutines()).toEqual([{ id: r, name: 'Solo' }]);
  });

  it('removes a routine from its program back to unassigned', async () => {
    const actions = makeDbActions(makeDb());
    const p = await actions.createProgram('Block B');
    const r = await actions.createRoutine('Day 1');
    await actions.assignRoutineToProgram(r, p);
    await actions.removeRoutineFromProgram(r);
    expect(await actions.listProgramRoutines(p)).toEqual([]);
    expect(await actions.listUnassignedRoutines()).toEqual([{ id: r, name: 'Day 1' }]);
    expect((await actions.listProgramsWithCounts())[0].routineCount).toBe(0);
  });

  it('deleting a program detaches but preserves its routines', async () => {
    const actions = makeDbActions(makeDb());
    const p = await actions.createProgram('Doomed');
    const keep = await actions.createRoutine('Keep me');
    await actions.assignRoutineToProgram(keep, p);
    await actions.deleteProgram(p);
    expect(await actions.listProgramsWithCounts()).toEqual([]);
    // Routine survives, unassigned — no cascade delete.
    expect(await actions.listUnassignedRoutines()).toEqual([{ id: keep, name: 'Keep me' }]);
    expect(await actions.listProgramRoutines(p)).toEqual([]);
  });
});
