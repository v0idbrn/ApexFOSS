import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import { schema } from './schema';
import { migrations } from './migrations';
import { modelClasses } from './models';
import { makeDbActions } from './actions';
import { emptyDraft } from '../types/draft';
import { startWorkoutSession, applyWorkoutEvent, loadWorkoutRuntime } from '../workout/runner';
import { listCompletedSessions, loadSessionDetail } from './history';
import { loadAnalyticsSnapshot } from './analytics';
import { loadNextUpCommit } from '../notifications/reminders';

/**
 * 1.1.0 execution fidelity: explicit completion state, exercise notes,
 * substitutions, block roles, mesocycle stages, and RIR passthrough.
 */

function makeDb(): Database {
  const adapter = new LokiJSAdapter({
    dbName: `apex-fidelity-${Math.random().toString(36).slice(2)}`,
    schema,
    migrations,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
  });
  return new Database({ adapter, modelClasses: modelClasses as any });
}

async function routineWithOneSet(db: Database, routineName: string, exerciseName: string): Promise<string> {
  const actions = makeDbActions(db);
  const exId = await actions.createExercise({ name: exerciseName, category: 'test', equipment: 'none', metricFlags: 7 });
  const draft = emptyDraft();
  draft.name = routineName;
  draft.blocks.push({
    localId: 'b1',
    name: 'Main',
    kind: 'normal',
    rounds: 1,
    steps: [
      {
        localId: 's1',
        exerciseId: exId,
        exerciseName,
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
  return actions.saveRoutineDraft(draft);
}

const SET = { weightGrams: 60_000, reps: 5, durationMs: null, distanceMm: null, rir: 1 };

describe('explicit completion state (DB)', () => {
  it('COMPLETE_SESSION with a reason persists incomplete status end-to-end', async () => {
    const db = makeDb();
    const routineId = await routineWithOneSet(db, 'Push', 'Bench');
    const sessionId = await startWorkoutSession(db, routineId);
    const rt = await loadWorkoutRuntime(db, sessionId);
    const done = await applyWorkoutEvent(db, rt!, {
      type: 'COMPLETE_SESSION',
      now: Date.now(),
      incompleteReason: 'fatigue',
    });
    expect(done.cursor.status).toBe('incomplete');
    const row = await db.get<any>('workout_sessions').find(sessionId);
    expect(row.sessionStatus).toBe('incomplete');
    expect(row.endedAt).not.toBeNull();
  });

  it('history lists incomplete sessions with their reason; detail loads them', async () => {
    const db = makeDb();
    const routineId = await routineWithOneSet(db, 'Push', 'Bench');
    const sessionId = await startWorkoutSession(db, routineId);
    const rt = await loadWorkoutRuntime(db, sessionId);
    await applyWorkoutEvent(db, rt!, { type: 'COMPLETE_SESSION', now: Date.now(), incompleteReason: 'pain' });
    const list = await listCompletedSessions(db);
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe('incomplete');
    expect(list[0].incompleteReason).toBe('pain');
    const detail = await loadSessionDetail(db, sessionId);
    expect(detail).not.toBeNull();
    expect(detail!.status).toBe('incomplete');
    expect(detail!.incompleteReason).toBe('pain');
  });

  it('completed sessions keep a null reason', async () => {
    const db = makeDb();
    const routineId = await routineWithOneSet(db, 'Push', 'Bench');
    const sessionId = await startWorkoutSession(db, routineId);
    const rt = await loadWorkoutRuntime(db, sessionId);
    await applyWorkoutEvent(db, rt!, {
      type: 'COMPLETE_SET',
      now: Date.now(),
      set: { ...SET },
    });
    const list = await listCompletedSessions(db);
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe('completed');
    expect(list[0].incompleteReason).toBeNull();
  });

  it('active sessions never appear in history', async () => {
    const db = makeDb();
    const routineId = await routineWithOneSet(db, 'Push', 'Bench');
    await startWorkoutSession(db, routineId);
    expect(await listCompletedSessions(db)).toHaveLength(0);
  });
});

describe('exercise notes and substitutions (writers)', () => {
  it('saves, clears and truncates an exercise note', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    const routineId = await routineWithOneSet(db, 'Push', 'Bench');
    const sessionId = await startWorkoutSession(db, routineId);
    await actions.setSessionExerciseNote(sessionId, 0, 0, 'Bench', 'Felt strong');
    let rows = await db.get<any>('session_exercises').query().fetch();
    expect(rows).toHaveLength(1);
    expect(rows[0].exerciseNote).toBe('Felt strong');
    await actions.setSessionExerciseNote(sessionId, 0, 0, 'Bench', '   ');
    rows = await db.get<any>('session_exercises').query().fetch();
    expect(rows).toHaveLength(1);
    expect(rows[0].exerciseNote).toBeNull();
    await actions.setSessionExerciseNote(sessionId, 0, 0, 'Bench', 'x'.repeat(600));
    rows = await db.get<any>('session_exercises').query().fetch();
    expect((rows[0].exerciseNote as string).length).toBe(500);
  });

  it('records a substitution without touching planned identity', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    const routineId = await routineWithOneSet(db, 'Push', 'Bench');
    const sessionId = await startWorkoutSession(db, routineId);
    const subId = await actions.createExercise({ name: 'DB Press', category: 'test', equipment: 'none', metricFlags: 7 });
    await actions.substituteSessionExercise(sessionId, 0, 0, 'Bench', subId, 'DB Press', 'equipment_unavailable');
    const rows = await db.get<any>('session_exercises').query().fetch();
    expect(rows).toHaveLength(1);
    expect(rows[0].exerciseName).toBe('Bench');
    expect(rows[0].actualExerciseName).toBe('DB Press');
    expect(rows[0].actualExerciseId).toBe(subId);
    expect(rows[0].substitutionReason).toBe('equipment_unavailable');
    const detail = await loadSessionDetail(db, await completeActive(db, sessionId));
    const step = detail!.blocks[0].steps[0];
    expect(step.substitution).toEqual({ actualExerciseName: 'DB Press', reason: 'equipment_unavailable' });
    expect(step.exerciseName).toBe('Bench');
  });

  it('normalizes an unknown substitution reason to null instead of crashing', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    const routineId = await routineWithOneSet(db, 'Push', 'Bench');
    const sessionId = await startWorkoutSession(db, routineId);
    await actions.substituteSessionExercise(sessionId, 0, 0, 'Bench', null, 'DB Press', 'nonsense');
    const rows = await db.get<any>('session_exercises').query().fetch();
    expect(rows[0].substitutionReason).toBeNull();
    expect(rows[0].actualExerciseName).toBe('DB Press');
  });

  it('substituted performances accrue to the actual exercise in analytics', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    const routineId = await routineWithOneSet(db, 'Push', 'Bench');
    const sessionId = await startWorkoutSession(db, routineId);
    const subId = await actions.createExercise({ name: 'DB Press', category: 'test', equipment: 'none', metricFlags: 7 });
    await actions.substituteSessionExercise(sessionId, 0, 0, 'Bench', subId, 'DB Press', 'pain_discomfort');
    const rt = await loadWorkoutRuntime(db, sessionId);
    await applyWorkoutEvent(db, rt!, { type: 'COMPLETE_SET', now: Date.now(), set: { ...SET } });
    await applyWorkoutEvent(db, rt!, { type: 'COMPLETE_SESSION', now: Date.now() });
    const snap = await loadAnalyticsSnapshot(db);
    expect(snap.sessions).toHaveLength(1);
    expect(snap.sessions[0].exercises[0].exerciseName).toBe('DB Press');
    expect(snap.sessions[0].exercises[0].exerciseId).toBe(subId);
  });
});

async function completeActive(db: Database, sessionId: string): Promise<string> {
  const rt = await loadWorkoutRuntime(db, sessionId);
  await applyWorkoutEvent(db, rt!, { type: 'COMPLETE_SESSION', now: Date.now() });
  return sessionId;
}

describe('programming metadata writers', () => {
  it('sets, clears and rejects block roles', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    const routineId = await routineWithOneSet(db, 'Push', 'Bench');
    const blocks = await db.get<any>('routine_blocks').query().fetch();
    const blockId = blocks[0].id;
    await actions.setBlockRole(blockId, 'warmup');
    expect((await db.get<any>('routine_blocks').find(blockId)).blockRole).toBe('warmup');
    await actions.setBlockRole(blockId, null);
    expect((await db.get<any>('routine_blocks').find(blockId)).blockRole).toBeNull();
    await expect(actions.setBlockRole(blockId, 'nonsense')).rejects.toThrow();
    const draft = await actions.loadRoutineDraft(routineId);
    expect(draft.blocks[0].role ?? null).toBeNull();
    await actions.setBlockRole(blockId, 'cooldown');
    const reloaded = await actions.loadRoutineDraft(routineId);
    expect(reloaded.blocks[0].role).toBe('cooldown');
  });

  it('sets, clears and rejects mesocycle stages', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    const programId = await actions.createProgram('Base');
    const mesoId = await actions.createMesocycle(programId, 'Week 1');
    await actions.setMesocycleStage(mesoId, 'deload');
    expect((await db.get<any>('mesocycles').find(mesoId)).stage).toBe('deload');
    expect((await actions.listMesocycles(programId))[0].stage).toBe('deload');
    await actions.setMesocycleStage(mesoId, null);
    expect((await db.get<any>('mesocycles').find(mesoId)).stage).toBeNull();
    await expect(actions.setMesocycleStage(mesoId, 'peak')).rejects.toThrow();
  });
});

describe('actual RIR passthrough', () => {
  it('logged RIR reaches the analytics input; missing stays null (never 0)', async () => {
    const db = makeDb();
    const routineId = await routineWithOneSet(db, 'Push', 'Bench');
    const sessionId = await startWorkoutSession(db, routineId);
    const rt = await loadWorkoutRuntime(db, sessionId);
    await applyWorkoutEvent(db, rt!, { type: 'COMPLETE_SET', now: Date.now(), set: { ...SET } });
    const snap = await loadAnalyticsSnapshot(db);
    expect(snap.sessions[0].exercises[0].sets[0].actualRir).toBe(1);
  });

  it('actual RIR 0 is preserved distinctly from missing', async () => {
    const db = makeDb();
    const routineId = await routineWithOneSet(db, 'Push', 'Bench');
    const sessionId = await startWorkoutSession(db, routineId);
    const rt = await loadWorkoutRuntime(db, sessionId);
    await applyWorkoutEvent(db, rt!, { type: 'COMPLETE_SET', now: Date.now(), set: { ...SET, rir: 0 } });
    const snap = await loadAnalyticsSnapshot(db);
    expect(snap.sessions[0].exercises[0].sets[0].actualRir).toBe(0);
  });

  it('incomplete sessions stay out of the analytics snapshot', async () => {
    const db = makeDb();
    const routineId = await routineWithOneSet(db, 'Push', 'Bench');
    const sessionId = await startWorkoutSession(db, routineId);
    const rt = await loadWorkoutRuntime(db, sessionId);
    await applyWorkoutEvent(db, rt!, { type: 'COMPLETE_SET', now: Date.now(), set: { ...SET } });
    await applyWorkoutEvent(db, rt!, { type: 'COMPLETE_SESSION', now: Date.now(), incompleteReason: 'fatigue' });
    const snap = await loadAnalyticsSnapshot(db);
    expect(snap.sessions).toHaveLength(0);
  });
});

describe('next-up counts for reminders', () => {
  it('loadNextUpCommit carries block/step counts', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    const programId = await actions.createProgram('Base');
    const routineId = await routineWithOneSet(db, 'Push', 'Bench');
    await actions.assignRoutineToProgram(routineId, programId);
    const commit = await loadNextUpCommit(db);
    expect(commit?.routineName).toBe('Push');
    expect(commit?.blockCount).toBe(1);
    expect(commit?.stepCount).toBe(1);
  });
});
