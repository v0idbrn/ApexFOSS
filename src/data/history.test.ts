import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import { schema } from './schema';
import { migrations } from './migrations';
import { modelClasses } from './models';
import { makeDbActions } from './actions';
import { loadSessionDetail } from './history';
import { serializeRoutine, definitionOf, cursorOf } from './serialize';
import { dispatch } from '../engine';

function makeDb(): Database {
  const adapter = new LokiJSAdapter({
    dbName: `apexfoss-hist-test-${Math.random().toString(36).slice(2)}`,
    schema,
    migrations,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
  });
  return new Database({ adapter, modelClasses: modelClasses as any });
}

const T = 1_700_000_000_000;

async function seedSessionWithExecutionRows(db: Database): Promise<string> {
  const actions = makeDbActions(db);
  const exerciseId = await actions.createExercise({
    name: 'Bench Press',
    category: 'push',
    equipment: 'barbell',
    metricFlags: 3,
  });
  const routineId = await actions.createRoutine('Push');
  const blockId = await actions.createBlock(routineId, { name: 'Main', kind: 'normal', rounds: 1 });
  const stepId = await actions.createStep(blockId, exerciseId, 'Bench Press');
  await actions.upsertPrescription(stepId, {
    targetSets: 3,
    targetRepsMin: 8,
    targetRepsMax: 12,
    targetDurationMs: null,
    targetWeightGrams: 50000,
    targetRir: 2,
    tempo: { eccentricMs: null, pauseBottomMs: null, concentricMs: null, pauseTopMs: null },
  });
  await actions.upsertTransition(blockId, stepId, { toStepId: null }, 'immediate', 0);
  const routine = await db.get<any>('routines').find(routineId);
  const def = await serializeRoutine(db, routine);
  const sessionId = await actions.startSession(routine, def);
  const session = await db.get<any>('workout_sessions').find(sessionId);
  const set = (
    weightGrams: number,
    reps: number,
    overrideReason: import('../types/engine').OverrideReason | null = null,
  ) => ({
    weightGrams,
    reps,
    durationMs: null,
    distanceMm: null,
    rir: 2,
    ...(overrideReason ? { overrideReason } : null),
  });
  let cursor = cursorOf(session);
  // Set 1: performed as prescribed (50kg × 10).
  let r = dispatch(def, cursor, { type: 'COMPLETE_SET', now: T, set: set(50000, 10) });
  cursor = await actions.applyEffects(session, r.cursor, r.effects);
  // Set 2: skipped.
  r = dispatch(def, cursor, { type: 'SKIP_SET', now: T + 1000 });
  cursor = await actions.applyEffects(session, r.cursor, r.effects);
  // Set 3: performed modified (55kg × 10, stated reason).
  r = dispatch(def, cursor, { type: 'COMPLETE_SET', now: T + 2000, set: set(55000, 10, 'load_increased') });
  cursor = await actions.applyEffects(session, r.cursor, r.effects);
  // Extra drop set.
  r = dispatch(def, cursor, {
    type: 'LOG_EXTRA_SET',
    now: T + 3000,
    set: set(40000, 8),
    executionType: 'drop',
  });
  await actions.applyEffects(session, r.cursor, r.effects);
  await actions.completeSession(session, r.cursor);
  return sessionId;
}

describe('History — adaptive execution display (Phase 3C)', () => {
  it('performed rows carry execution markers; skipped rows listed separately', async () => {
    const db = makeDb();
    const sessionId = await seedSessionWithExecutionRows(db);
    const detail = await loadSessionDetail(db, sessionId);
    expect(detail).not.toBeNull();
    const step = detail!.blocks[0].steps[0];
    // Performed: sets 1 (normal), 3 (modified + reason), 4 (drop).
    expect(step.logs.map((l) => l.setIndex)).toEqual([1, 3, 4]);
    expect(detail!.totalCompletedSets).toBe(3);
    expect(step.logs[0].executionType).toBe('normal');
    expect(step.logs[0].overrideReason).toBeNull();
    expect(step.logs[1].executionType).toBe('modified');
    expect(step.logs[1].overrideReason).toBe('load_increased');
    expect(step.logs[1].weightGrams).toBe(55000);
    expect(step.logs[2].executionType).toBe('drop');
    // Skipped: set 2 recorded, never counted as completed.
    expect(step.skipped).toEqual([{ blockIndex: 0, stepIndex: 0, round: 1, setIndex: 2 }]);
    // Prescription snapshot intact for comparison display.
    expect(step.targetWeightGrams).toBe(50000);
    expect(step.targetRepsMin).toBe(8);
    expect(step.targetRepsMax).toBe(12);
  });

  it('voided (undo) rows stay invisible and are not reported as skipped', async () => {
    const db = makeDb();
    const sessionId = await seedSessionWithExecutionRows(db);
    const logs = await db.get<any>('set_logs').query().fetch();
    const first = logs.find((l: any) => l.setIndex === 1);
    await db.write(async () => {
      await first.update((rec: any) => {
        rec.isCompleted = 0;
      });
    });
    const detail = await loadSessionDetail(db, sessionId);
    expect(detail!.totalCompletedSets).toBe(2);
    const step = detail!.blocks[0].steps[0];
    expect(step.logs.map((l) => l.setIndex)).toEqual([3, 4]);
    expect(step.skipped.map((s) => s.setIndex)).toEqual([2]);
  });
});
