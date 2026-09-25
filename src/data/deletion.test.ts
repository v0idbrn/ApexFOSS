import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import { schema } from '../data/schema';
import { migrations } from '../data/migrations';
import { modelClasses } from '../data/models';
import { makeDbActions } from '../data/actions';
import { countLocalData, wipeAllLocalData, deleteAllLocalData } from './deletion';
import { useTimerStore } from '../state/timerStore';
import { useActiveSessionStore } from '../state/activeSessionStore';

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  scheduleNotificationAsync: jest.fn().mockResolvedValue('notif-1'),
  cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
  cancelAllScheduledNotificationsAsync: jest.fn().mockResolvedValue(undefined),
  getAllScheduledNotificationsAsync: jest.fn().mockResolvedValue([]),
}));

const ALL_TABLES = [
  'exercises',
  'routines',
  'routine_blocks',
  'routine_block_steps',
  'routine_exercise_prescriptions',
  'block_transitions',
  'workout_sessions',
  'session_exercises',
  'set_logs',
  'readiness_tests',
] as const;

function makeDb(): Database {
  const adapter = new LokiJSAdapter({
    dbName: `apexfoss-security-${Math.random().toString(36).slice(2)}`,
    schema,
    migrations,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
  });
  return new Database({ adapter, modelClasses: modelClasses as any });
}

async function seedSomeData(db: Database): Promise<void> {
  const actions = makeDbActions(db);
  const now = Date.now();
  await actions.createExercise({ name: 'Security Squat', category: 'legs', equipment: 'barbell', metricFlags: 3 });
  await actions.createExercise({ name: 'Security Press', category: 'push', equipment: 'dumbbell', metricFlags: 3 });
  await actions.createRoutine('Security Day');
  await db.write(async () => {
    for (const name of ['Security Session', 'Second Session']) {
      await db.get('workout_sessions').create((rec: any) => {
        rec.name = name;
        rec.startedAt = now;
        rec.sessionStatus = 'completed';
        rec.definitionJson = '{"status":"completed"}';
        rec.cursorJson = '{"status":"completed","blockIndex":0,"round":0,"setIndex":0}';
        rec.currentBlockIndex = 0;
        rec.currentRound = 0;
        rec.currentSetIndex = 0;
        rec.timerExpiresAt = null;
        rec.createdAt = now;
        rec.updatedAt = now;
      });
    }
    for (let i = 0; i < 2; i += 1) {
      await db.get('set_logs').create((rec: any) => {
        rec.sessionExerciseId = 'se_x';
        rec.blockIndex = 0;
        rec.stepIndex = 0;
        rec.round = 1;
        rec.setIndex = i + 1;
        rec.weightGrams = 100_000;
        rec.reps = 5;
        rec.isCompleted = 1;
        rec.createdAt = now;
        rec.updatedAt = now;
      });
    }
  });
  await actions.createReadinessTest({ testedAt: now, durationMs: 5_000, tapCount: 42 });
}

describe('local data counts (spec section 19)', () => {
  it('reports zeros on an empty database', async () => {
    const db = makeDb();
    expect(await countLocalData(db)).toEqual({
      exercises: 0,
      routines: 0,
      sessions: 0,
      setLogs: 0,
      readinessTests: 0,
    });
  });

  it('counts real rows after seeding', async () => {
    const db = makeDb();
    await seedSomeData(db);
    expect(await countLocalData(db)).toEqual({
      exercises: 2,
      routines: 1,
      sessions: 2,
      setLogs: 2,
      readinessTests: 1,
    });
  });
});

describe('explicit local wipe (D-037, spec section 14)', () => {
  it('destroys every row in every table', async () => {
    const db = makeDb();
    await seedSomeData(db);
    await wipeAllLocalData(db);
    for (const table of ALL_TABLES) {
      const remaining = await db.get(table).query().fetchCount();
      expect(`${table}=${remaining}`).toBe(`${table}=0`);
    }
  });

  it('returns the pre-wipe counts so the UI can confirm what was removed', async () => {
    const db = makeDb();
    await seedSomeData(db);
    const deleted = await wipeAllLocalData(db);
    expect(deleted).toEqual({
      exercises: 2,
      routines: 1,
      sessions: 2,
      setLogs: 2,
      readinessTests: 1,
    });
  });

  it('is a no-op with zero counts on an empty database', async () => {
    const db = makeDb();
    const deleted = await wipeAllLocalData(db);
    expect(deleted.exercises).toBe(0);
    expect(deleted.sessions).toBe(0);
  });

  it('deleteAllLocalData clears timer + active-session runtime mirrors', async () => {
    const db = makeDb();
    await seedSomeData(db);
    useTimerStore.getState().setFromCursor({
      kind: 'rest',
      durationMs: 60_000,
      expiresAt: Date.now() + 60_000,
    });
    useActiveSessionStore.getState().setSession('sess_1', 'Security Day');
    await deleteAllLocalData(db);
    expect(useTimerStore.getState().expiresAt).toBeNull();
    expect(useTimerStore.getState().kind).toBeNull();
    expect(useTimerStore.getState().remainingMs).toBe(0);
    expect(useActiveSessionStore.getState().sessionId).toBeNull();
    expect(useActiveSessionStore.getState().routineName).toBeNull();
  });

  it('deleteAllLocalData cancels scheduled rest notifications', async () => {
    const Notifications = require('expo-notifications');
    Notifications.cancelAllScheduledNotificationsAsync.mockClear();
    const db = makeDb();
    await seedSomeData(db);
    await deleteAllLocalData(db);
    expect(Notifications.cancelAllScheduledNotificationsAsync).toHaveBeenCalledTimes(1);
  });

  it('survives restart: after wipe the app reopens and starter content reseeds', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    await seedSomeData(db);
    await deleteAllLocalData(db);

    // Simulated restart: fresh queries only, no stale references.
    const reopened = makeDbActions(db);
    const reseeded = await reopened.seedExercisesIfEmpty();
    expect(reseeded).toBeGreaterThan(0); // starter presets are app content
    const counts = await countLocalData(db);
    expect(counts.sessions).toBe(0); // user history stays gone
    expect(counts.setLogs).toBe(0);
    expect(counts.readinessTests).toBe(0);
    expect(counts.routines).toBe(0);
    expect(counts.exercises).toBe(reseeded);
    void actions;
  });
});
