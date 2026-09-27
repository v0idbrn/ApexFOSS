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

describe('mesocycle actions (Phase 4B)', () => {
  it('creates ordered mesocycles inside a program with staged counts', async () => {
    const actions = makeDbActions(makeDb());
    const p = await actions.createProgram('Block A');
    const m1 = await actions.createMesocycle(p, 'Accumulation');
    const m2 = await actions.createMesocycle(p, 'Intensification');
    expect(await actions.listMesocycles(p)).toEqual([
      { id: m1, name: 'Accumulation', sortOrder: 1, routineCount: 0 },
      { id: m2, name: 'Intensification', sortOrder: 2, routineCount: 0 },
    ]);
    const r = await actions.createRoutine('Day A');
    await actions.assignRoutineToProgram(r, p);
    await actions.assignRoutineToMesocycle(r, m1);
    expect((await actions.listMesocycles(p))[0].routineCount).toBe(1);
    expect(await actions.listProgramRoutines(p)).toEqual([
      { id: r, name: 'Day A', order: 1, mesocycleId: m1 },
    ]);
  });

  it('rejects mesocycles for missing programs and cross-program staging', async () => {
    const actions = makeDbActions(makeDb());
    const p1 = await actions.createProgram('One');
    const p2 = await actions.createProgram('Two');
    await expect(actions.createMesocycle('missing', 'Phase')).rejects.toThrow();

    const r = await actions.createRoutine('Day');
    await actions.assignRoutineToProgram(r, p1);
    const m2 = await actions.createMesocycle(p2, 'Phase');
    await expect(actions.assignRoutineToMesocycle(r, m2)).rejects.toThrow();
    expect((await actions.listProgramRoutines(p1))[0].mesocycleId).toBeNull();
  });

  it('unstaging keeps the routine in the program', async () => {
    const actions = makeDbActions(makeDb());
    const p = await actions.createProgram('Block');
    const m = await actions.createMesocycle(p, 'Phase 1');
    const r = await actions.createRoutine('Day');
    await actions.assignRoutineToProgram(r, p);
    await actions.assignRoutineToMesocycle(r, m);
    await actions.removeRoutineFromMesocycle(r);
    expect(await actions.listProgramRoutines(p)).toEqual([
      { id: r, name: 'Day', order: 1, mesocycleId: null },
    ]);
    expect((await actions.listMesocycles(p))[0].routineCount).toBe(0);
  });

  it('deleting a mesocycle detaches staged routines but keeps the program', async () => {
    const actions = makeDbActions(makeDb());
    const p = await actions.createProgram('Block');
    const m = await actions.createMesocycle(p, 'Doomed phase');
    const r = await actions.createRoutine('Day');
    await actions.assignRoutineToProgram(r, p);
    await actions.assignRoutineToMesocycle(r, m);
    await actions.deleteMesocycle(m);
    expect(await actions.listMesocycles(p)).toEqual([]);
    expect(await actions.listProgramRoutines(p)).toEqual([
      { id: r, name: 'Day', order: 1, mesocycleId: null },
    ]);
    expect(await actions.listProgramsWithCounts()).toHaveLength(1);
  });

  it('deleting a program also deletes its mesocycles', async () => {
    const actions = makeDbActions(makeDb());
    const p = await actions.createProgram('Doomed');
    const m = await actions.createMesocycle(p, 'Phase');
    const r = await actions.createRoutine('Day');
    await actions.assignRoutineToProgram(r, p);
    await actions.assignRoutineToMesocycle(r, m);
    await actions.deleteProgram(p);
    expect(await actions.listMesocycles(p)).toEqual([]);
    expect(await actions.listUnassignedRoutines()).toEqual([{ id: r, name: 'Day' }]);
  });

  it('moving a routine to another program clears its staging', async () => {
    const actions = makeDbActions(makeDb());
    const p1 = await actions.createProgram('One');
    const p2 = await actions.createProgram('Two');
    const m1 = await actions.createMesocycle(p1, 'Phase');
    const r = await actions.createRoutine('Day');
    await actions.assignRoutineToProgram(r, p1);
    await actions.assignRoutineToMesocycle(r, m1);
    await actions.assignRoutineToProgram(r, p2);
    expect(await actions.listProgramRoutines(p2)).toEqual([
      { id: r, name: 'Day', order: 1, mesocycleId: null },
    ]);
    expect((await actions.listMesocycles(p1))[0].routineCount).toBe(0);
  });
});
