import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import { schema } from '../data/schema';
import { migrations } from '../data/migrations';
import { modelClasses } from '../data/models';
import { makeDbActions } from '../data/actions';
import { serializeRoutine, definitionOf, cursorOf } from '../data/serialize';
import { initialCursor } from '../engine/cursor';
import { dispatch } from '../engine';
import { RoutineDefinition, ExecutionCursor } from '../types/engine';
import { Q } from '@nozbe/watermelondb';

function makeDb(): Database {
  const adapter = new LokiJSAdapter({
    dbName: `apexfoss-test-${Math.random().toString(36).slice(2)}`,
    schema,
    migrations,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
  });
  return new Database({ adapter, modelClasses: modelClasses as any });
}

const T0 = 1_700_000_000_000;

async function buildContrastRoutine(db: Database): Promise<{ routineId: string; def: RoutineDefinition }> {
  const actions = makeDbActions(db);
  const routineId = await actions.createRoutine('PAP Lower');
  const blocks = await db.get<any>('routine_blocks').query(Q.where('routine_id', routineId)).fetch();
  void blocks;
  const { createBlock, createStep, upsertPrescription, upsertTransition } = actions;
  const exerciseA = await actions.createExercise({ name: 'Heavy Squat', category: 'legs', equipment: 'barbell', metricFlags: 3 });
  const exerciseB = await actions.createExercise({ name: 'Box Jump', category: 'power', equipment: 'box', metricFlags: 2 });
  const blockId = await createBlock(routineId, { name: 'Contrast A', kind: 'contrast', rounds: 3 });
  const stepA = await createStep(blockId, exerciseA, 'Heavy Squat');
  const stepB = await createStep(blockId, exerciseB, 'Box Jump');
  await upsertPrescription(stepA, {
    targetSets: 1, targetRepsMin: 5, targetRepsMax: null, targetDurationMs: null,
    targetWeightGrams: 120000, targetRir: 2,
    tempo: { eccentricMs: 3000, pauseBottomMs: 1000, concentricMs: 0, pauseTopMs: 1000 },
  });
  await upsertPrescription(stepB, {
    targetSets: 1, targetRepsMin: 5, targetRepsMax: null, targetDurationMs: null,
    targetWeightGrams: null, targetRir: null,
    tempo: { eccentricMs: null, pauseBottomMs: null, concentricMs: null, pauseTopMs: null },
  });
  await upsertTransition(blockId, stepA, { toStepId: stepB }, 'immediate', 0);
  await upsertTransition(blockId, stepB, { toStepId: stepA }, 'rest', 120_000);
  const Routine = db.get<any>('routines');
  const routine = await Routine.find(routineId);
  const def = await serializeRoutine(db, routine);
  return { routineId, def };
}

describe('Persistence — exercises CRUD + seed', () => {
  it('creates, lists, updates and deletes an exercise', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    const id = await actions.createExercise({ name: 'Zercher Squat', category: 'legs', equipment: 'barbell', metricFlags: 3 });
    const list = await actions.listExercises();
    expect(list.map((e: any) => e.name)).toContain('Zercher Squat');
    await actions.updateExercise(id, { name: 'Zercher Squat v2', category: 'legs', equipment: 'barbell', metricFlags: 3 });
    const again = await actions.listExercises();
    expect(again.find((e: any) => e.id === id)!.name).toBe('Zercher Squat v2');
    await actions.deleteExercise(id);
    const after = await actions.listExercises();
    expect(after.find((e: any) => e.id === id)).toBeUndefined();
  });

  it('seeds starter exercises exactly once', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    const n1 = await actions.seedExercisesIfEmpty();
    expect(n1).toBeGreaterThan(0);
    const n2 = await actions.seedExercisesIfEmpty();
    expect(n2).toBe(0);
  });
});

describe('Persistence — session lifecycle & snapshot immutability (§11)', () => {
  it('start → definition frozen → routine edits do not touch the session', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    const { routineId, def } = await buildContrastRoutine(db);
    const routine = await db.get<any>('routines').find(routineId);

    const sessionId = await actions.startSession(routine, def);
    const session = await db.get<any>('workout_sessions').find(sessionId);
    const frozen = definitionOf(session);
    expect(frozen.blocks[0].steps.map((s: any) => s.exerciseName)).toEqual(['Heavy Squat', 'Box Jump']);

    // Edit the routine AFTER session start: change prescription + transition delay.
    // Resolve step ids via a fresh serialization (deterministic sort_order), not fetch order.
    const freshBefore = await serializeRoutine(db, routine);
    const stepAId = freshBefore.blocks[0].steps[0].id; // Heavy Squat
    const stepBId = freshBefore.blocks[0].steps[1].id; // Box Jump
    await actions.upsertPrescription(stepAId, {
      targetSets: 9, targetRepsMin: null, targetRepsMax: null, targetDurationMs: null,
      targetWeightGrams: null, targetRir: null,
      tempo: { eccentricMs: null, pauseBottomMs: null, concentricMs: null, pauseTopMs: null },
    });
    await actions.upsertTransition(frozen.blocks[0].id, stepBId, { toStepId: stepAId }, 'rest', 60_000);

    const sessionAfter = await db.get<any>('workout_sessions').find(sessionId);
    const stillFrozen = definitionOf(sessionAfter);
    expect(stillFrozen.blocks[0].steps[0].prescription.targetSets).toBe(1); // snapshot unchanged
    const frozenBackEdge = stillFrozen.blocks[0].transitions.find((t) => t.fromStepId === stillFrozen.blocks[0].steps[1].id);
    expect(frozenBackEdge!.delayMs).toBe(120_000); // snapshot unchanged (lookup by edge, not index)
    const fresh = await serializeRoutine(db, routine);
    expect(fresh.blocks[0].steps[0].prescription.targetSets).toBe(9); // routine itself changed
  });

  it('cursor roundtrip: persistCursor writes canonical json + derived caches atomically', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    const { routineId, def } = await buildContrastRoutine(db);
    const routine = await db.get<any>('routines').find(routineId);
    const sessionId = await actions.startSession(routine, def);
    let session = await db.get<any>('workout_sessions').find(sessionId);

    // Complete set A → engine: immediate → B (no timer, contrast edge 0ms).
    const cursor1 = cursorOf(session);
    const r1 = dispatch(def, cursor1, { type: 'COMPLETE_SET', now: T0, set: { weightGrams: 120000, reps: 5, durationMs: null, distanceMm: null, rir: 2 } });
    await actions.applyEffects(session, r1.cursor, r1.effects);
    await actions.persistCursor(session, r1.cursor);

    session = await db.get<any>('workout_sessions').find(sessionId);
    const restored = cursorOf(session);
    expect(restored.stepIndex).toBe(1);
    expect(restored.timer).toBeNull();
    expect(session.timerExpiresAt).toBeNull(); // derived cache agrees
    expect(session.currentStepId).toBe(def.blocks[0].steps[1].id);

    // Complete set B → REST 120s timer, canonical cursor carries it.
    const r2 = dispatch(def, restored, { type: 'COMPLETE_SET', now: T0, set: { weightGrams: null, reps: 5, durationMs: null, distanceMm: null, rir: null } });
    await actions.applyEffects(session, r2.cursor, r2.effects);
    await actions.persistCursor(session, r2.cursor);

    session = await db.get<any>('workout_sessions').find(sessionId);
    const withTimer = cursorOf(session);
    expect(withTimer.timer).toMatchObject({ kind: 'rest', durationMs: 120_000 });
    expect(session.timerExpiresAt).toBe(withTimer.timer!.expiresAt); // cache mirrors canonical
    expect(session.currentRound).toBe(1); // cache mirrors the canonical cursor position (still resting at round 1; target ≠ position)
  });

  it('applyEffects writes set_logs; UNDO voids the last log only', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    const { routineId, def } = await buildContrastRoutine(db);
    const routine = await db.get<any>('routines').find(routineId);
    const sessionId = await actions.startSession(routine, def);
    let session = await db.get<any>('workout_sessions').find(sessionId);

    const r1 = dispatch(def, cursorOf(session), { type: 'COMPLETE_SET', now: T0, set: { weightGrams: 120000, reps: 5, durationMs: null, distanceMm: null, rir: 2 } });
    // Simulate application layer: assign setLogId after LOG_SET lands.
    await actions.applyEffects(session, r1.cursor, r1.effects);
    const logs1 = await db.get<any>('set_logs').query().fetch();
    expect(logs1).toHaveLength(1);
    expect(logs1[0].weightGrams).toBe(120000);
    expect(logs1[0].isCompleted).toBe(1);

    // Attach the real log id to the cursor's lastReversible (application layer duty).
    const cursorWithLog: ExecutionCursor = {
      ...r1.cursor,
      lastReversible: { kind: 'set', setLogId: logs1[0].id, blockIndex: 0, stepIndex: 0, round: 1, setIndex: 1 },
    };
    await actions.persistCursor(session, cursorWithLog);

    const rUndo = dispatch(def, cursorWithLog, { type: 'UNDO_LAST', now: T0 + 1000 });
    await actions.applyEffects(session, rUndo.cursor, rUndo.effects);
    const logs2 = await db.get<any>('set_logs').query().fetch();
    expect(logs2).toHaveLength(1);
    expect(logs2[0].isCompleted).toBe(0); // voided, history preserved (no deletion)
  });

  it('reopen path: persisted state is fully re-readable from the store (close/reopen)', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    const { routineId, def } = await buildContrastRoutine(db);
    const routine = await db.get<any>('routines').find(routineId);
    const sessionId = await actions.startSession(routine, def);

    // Simulated restart: drop prior references and re-derive everything via fresh queries.
    const rows = await db.get<any>('workout_sessions').query(Q.where('session_status', 'active')).fetch();
    expect(rows).toHaveLength(1);
    const session = rows[0];
    expect(session.id).toBe(sessionId);
    const cursor = cursorOf(session); // canonical cursor_json parses + validates
    expect(cursor.status).toBe('active');
    expect(cursor.blockIndex).toBe(0);
    const restoredDef = definitionOf(session);
    expect(restoredDef.name).toBe('PAP Lower');
    expect(restoredDef.blocks[0].steps).toHaveLength(2);
    const active = await makeDbActions(db).getActiveSession();
    expect(active!.id).toBe(sessionId);
  });
});
