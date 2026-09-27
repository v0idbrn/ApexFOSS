import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import { schema } from './schema';
import { migrations } from './migrations';
import { modelClasses } from './models';
import { makeDbActions } from './actions';
import { evaluateGoal, loadGoals } from './goals';
import { estimate1rmGrams } from '../analytics/records';

/**
 * Phase 4D goals: pure evaluation + real LokiJS DB (same pattern as
 * scheduling.test.ts). Achieved/progress are always derived from history.
 */

function makeDb(): Database {
  const adapter = new LokiJSAdapter({
    dbName: `apexfoss-goals-test-${Math.random().toString(36).slice(2)}`,
    schema,
    migrations,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
  });
  return new Database({ adapter, modelClasses: modelClasses as any });
}

const T = 1_700_000_000_000;

async function seedExercise(db: Database, name: string): Promise<string> {
  let id = '';
  await db.write(async () => {
    const row = await db.get('exercises').create((rec: any) => {
      rec.name = name;
      rec.category = 'push';
      rec.equipment = 'barbell';
      rec.metricFlags = 3;
      rec.createdAt = T;
      rec.updatedAt = T;
    });
    id = row.id;
  });
  return id;
}

async function addCompletedSession(
  db: Database,
  exerciseId: string,
  exerciseName: string,
  logs: Array<{ weightGrams: number; reps: number }>,
): Promise<void> {
  const definition = {
    id: 'routine-1',
    name: 'Push day',
    blocks: [
      {
        id: 'block-1',
        name: 'Main',
        kind: 'straight',
        rounds: 1,
        steps: [
          {
            id: 'step-1',
            role: 'work',
            exerciseId,
            exerciseName,
            prescription: {
              targetSets: logs.length,
              targetRepsMin: 1,
              targetRepsMax: 20,
              targetWeightGrams: logs[0]?.weightGrams ?? null,
              targetDurationMs: null,
              targetRir: null,
              tempo: { eccentricMs: null, pauseBottomMs: null, pauseTopMs: null, concentricMs: null },
            },
          },
        ],
        transitions: [],
      },
    ],
  };
  await db.write(async () => {
    const session = await db.get<any>('workout_sessions').create((rec: any) => {
      rec.routineId = null;
      rec.name = 'Push day';
      rec.startedAt = T - 3_600_000;
      rec.endedAt = T;
      rec.sessionStatus = 'completed';
      rec.definitionJson = JSON.stringify(definition);
      rec.cursorJson = '{"status":"completed","blockIndex":0,"stepIndex":0,"round":1,"setIndex":1}';
      rec.currentBlockIndex = 0;
      rec.currentStepId = null;
      rec.currentRound = 1;
      rec.currentSetIndex = 1;
      rec.timerExpiresAt = null;
      rec.createdAt = T;
      rec.updatedAt = T;
    });
    const se = await db.get('session_exercises').create((rec: any) => {
      rec.sessionId = session.id;
      rec.exerciseId = exerciseId;
      rec.exerciseName = exerciseName;
      rec.blockIndex = 0;
      rec.orderIndex = 0;
      rec.createdAt = T;
      rec.updatedAt = T;
    });
    for (const [i, log] of logs.entries()) {
      await db.get('set_logs').create((rec: any) => {
        rec.sessionExerciseId = se.id;
        rec.blockIndex = 0;
        rec.stepIndex = 0;
        rec.round = 1;
        rec.setIndex = i + 1;
        rec.weightGrams = log.weightGrams;
        rec.reps = log.reps;
        rec.durationMs = null;
        rec.distanceMm = null;
        rec.rir = null;
        rec.isCompleted = 1;
        rec.completedAt = T;
        rec.createdAt = T;
        rec.updatedAt = T;
      });
    }
  });
}

describe('evaluateGoal (pure)', () => {
  it('reports no progress without history', () => {
    expect(evaluateGoal(100_000, null)).toEqual({
      targetGrams: 100_000,
      currentGrams: null,
      progress: null,
      achieved: false,
    });
  });

  it('computes a clamped ratio and achieved state', () => {
    expect(evaluateGoal(100_000, 80_000)).toEqual({
      targetGrams: 100_000,
      currentGrams: 80_000,
      progress: 0.8,
      achieved: false,
    });
    expect(evaluateGoal(100_000, 100_000).achieved).toBe(true);
    expect(evaluateGoal(100_000, 150_000).progress).toBe(1);
  });

  it('treats non-positive current as missing history', () => {
    expect(evaluateGoal(100_000, 0).progress).toBeNull();
    expect(evaluateGoal(100_000, -5).currentGrams).toBeNull();
  });
});

describe('goal actions', () => {
  it('creates, lists and deletes a goal', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    const exId = await seedExercise(db, 'Bench Press');
    const id = await actions.createGoal(exId, 100_000);
    const list = await actions.listGoals();
    expect(list).toEqual([{ id, exerciseId: exId, targetWeightGrams: 100_000, createdAt: expect.any(Number) }]);
    await actions.deleteGoal(id);
    expect(await actions.listGoals()).toEqual([]);
  });

  it('rejects an unknown exercise', async () => {
    const db = makeDb();
    await expect(makeDbActions(db).createGoal('missing', 100_000)).rejects.toThrow();
  });

  it('rejects non-positive or non-integer targets', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    const exId = await seedExercise(db, 'Squat');
    await expect(actions.createGoal(exId, 0)).rejects.toThrow('positive integer');
    await expect(actions.createGoal(exId, 12.5)).rejects.toThrow('positive integer');
  });

  it('rejects a second goal for the same exercise', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    const exId = await seedExercise(db, 'Deadlift');
    await actions.createGoal(exId, 150_000);
    await expect(actions.createGoal(exId, 160_000)).rejects.toThrow('already has');
  });
});

describe('loadGoals (Phase 4D)', () => {
  it('derives progress from best e1RM history', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    const exId = await seedExercise(db, 'Bench Press');
    await addCompletedSession(db, exId, 'Bench Press', [{ weightGrams: 50_000, reps: 5 }]);
    const current = estimate1rmGrams(50_000, 5);
    if (current == null) throw new Error('expected an e1RM estimate');
    expect(current).toBeGreaterThan(50_000);

    await actions.createGoal(exId, current + 10_000);
    const [goal] = await loadGoals(db);
    expect(goal.exerciseName).toBe('Bench Press');
    expect(goal.currentGrams).toBe(current);
    expect(goal.achieved).toBe(false);
    expect(goal.progress).toBeCloseTo(current / (current + 10_000), 5);

    // Same goal evaluated against a target at/below the best e1RM is achieved.
    await actions.deleteGoal(goal.id);
    await actions.createGoal(exId, current);
    const [achieved] = await loadGoals(db);
    expect(achieved.achieved).toBe(true);
    expect(achieved.progress).toBe(1);
  });

  it('reports null progress for an exercise without history', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    const exId = await seedExercise(db, 'Overhead Press');
    await actions.createGoal(exId, 60_000);
    const [goal] = await loadGoals(db);
    expect(goal.currentGrams).toBeNull();
    expect(goal.progress).toBeNull();
    expect(goal.achieved).toBe(false);
  });

  it('returns an empty list when no goals exist', async () => {
    const db = makeDb();
    expect(await loadGoals(db)).toEqual([]);
  });
});
