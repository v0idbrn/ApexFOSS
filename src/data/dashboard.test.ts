import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import { schema } from './schema';
import { migrations } from './migrations';
import { modelClasses } from './models';
import { loadDashboard } from './dashboard';
import { startOfLocalDay } from '../analytics/load';

function makeDb(): Database {
  const adapter = new LokiJSAdapter({
    dbName: `apexfoss-dashboard-test-${Math.random().toString(36).slice(2)}`,
    schema,
    migrations,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
  });
  return new Database({ adapter, modelClasses: modelClasses as any });
}

/** Fixed "now": local noon on a known day. */
const DAY = startOfLocalDay(1_700_000_000_000);
const NOON = DAY + 12 * 3600_000;

interface SessionOpts {
  startedAt: number;
  endedAt: number | null;
  status?: string;
  routineId?: string | null;
  name?: string;
  logs?: Array<{ weightGrams: number | null; reps: number | null; durationMs?: number | null; isCompleted?: number }>;
}

async function createSession(db: Database, opts: SessionOpts): Promise<string> {
  return db.write(async () => {
    const session = await db.get<any>('workout_sessions').create((rec: any) => {
      rec.routineId = opts.routineId ?? null;
      rec.name = opts.name ?? 'Push day';
      rec.startedAt = opts.startedAt;
      rec.endedAt = opts.endedAt;
      rec.sessionStatus = opts.status ?? 'completed';
      rec.definitionJson = '{"id":"r","name":"Push day","blocks":[]}';
      rec.cursorJson = '{"status":"completed","blockIndex":0,"stepIndex":0,"round":1,"setIndex":1}';
      rec.currentBlockIndex = 0;
      rec.currentStepId = null;
      rec.currentRound = 1;
      rec.currentSetIndex = 1;
      rec.timerExpiresAt = null;
      rec.createdAt = opts.startedAt;
      rec.updatedAt = opts.startedAt;
    });
    if (opts.logs && opts.logs.length > 0) {
      const se = await db.get<any>('session_exercises').create((rec: any) => {
        rec.sessionId = session.id;
        rec.exerciseId = null;
        rec.exerciseName = 'Bench Press';
        rec.blockIndex = 0;
        rec.orderIndex = 0;
        rec.createdAt = opts.startedAt;
        rec.updatedAt = opts.startedAt;
      });
      for (const [i, log] of opts.logs.entries()) {
        await db.get<any>('set_logs').create((rec: any) => {
          rec.sessionExerciseId = se.id;
          rec.blockIndex = 0;
          rec.stepIndex = 0;
          rec.round = 1;
          rec.setIndex = i + 1;
          rec.weightGrams = log.weightGrams;
          rec.reps = log.reps;
          rec.durationMs = log.durationMs ?? null;
          rec.distanceMm = null;
          rec.rir = null;
          rec.isCompleted = log.isCompleted ?? 1;
          rec.completedAt = opts.startedAt;
          rec.createdAt = opts.startedAt;
          rec.updatedAt = opts.startedAt;
        });
      }
    }
    return session.id;
  });
}

const bench = { weightGrams: 60_000, reps: 5 };

describe('loadDashboard (Phase 2J)', () => {
  it('returns empty data with seven zero buckets on an empty database', async () => {
    const db = makeDb();
    const d = await loadDashboard(db, NOON);
    expect(d.recent).toEqual([]);
    expect(d.lastRoutine).toBeNull();
    expect(d.week.sessionCount).toBe(0);
    expect(d.daily).toHaveLength(7);
    expect(d.daily.every((b) => b.resistanceGramReps === 0 && b.sessionCount === 0)).toBe(true);
    expect(d.daily[6].dayStartMs).toBe(DAY); // today is the last bucket
  });

  it('aggregates week sessions, volume, sets and wall time', async () => {
    const db = makeDb();
    await createSession(db, {
      startedAt: DAY - 7200_000,
      endedAt: DAY - 3600_000, // yesterday 23:00
      logs: [bench, bench],
    });
    await createSession(db, { startedAt: NOON - 3600_000, endedAt: NOON, logs: [bench] });

    const d = await loadDashboard(db, NOON);
    expect(d.week.sessionCount).toBe(2);
    expect(d.week.completedSetCount).toBe(3);
    expect(d.week.resistanceGramReps).toBe(60_000 * 5 * 3);
    expect(d.week.wallMs).toBe(2 * 3600_000);
    expect(d.daily[6].sessionCount).toBe(1); // today
    expect(d.daily[5].sessionCount).toBe(1); // yesterday
    expect(d.daily[5].resistanceGramReps).toBe(60_000 * 5 * 2);
  });

  it('ignores sessions outside the current 7-day window', async () => {
    const db = makeDb();
    const oldDay = new Date(DAY);
    oldDay.setDate(oldDay.getDate() - 10);
    await createSession(db, { startedAt: oldDay.getTime(), endedAt: oldDay.getTime() + 3600_000, logs: [bench] });

    const d = await loadDashboard(db, NOON);
    expect(d.week.sessionCount).toBe(0);
    expect(d.week.resistanceGramReps).toBe(0);
    expect(d.recent).toHaveLength(1); // still visible in history preview
    expect(d.daily.every((b) => b.sessionCount === 0)).toBe(true);
  });

  it('excludes non-completed sessions from every total', async () => {
    const db = makeDb();
    await createSession(db, {
      startedAt: NOON - 3600_000,
      endedAt: null,
      status: 'active',
      logs: [bench],
    });

    const d = await loadDashboard(db, NOON);
    expect(d.week.sessionCount).toBe(0);
    expect(d.recent).toHaveLength(0);
  });

  it('counts only completed set logs toward volume and set totals', async () => {
    const db = makeDb();
    await createSession(db, {
      startedAt: NOON - 3600_000,
      endedAt: NOON,
      logs: [bench, { ...bench, isCompleted: 0 }],
    });

    const d = await loadDashboard(db, NOON);
    expect(d.week.completedSetCount).toBe(1);
    expect(d.week.resistanceGramReps).toBe(60_000 * 5);
  });

  it('caps the recent preview at five sessions, newest first', async () => {
    const db = makeDb();
    for (let i = 0; i < 7; i++) {
      const t = DAY - i * 3600_000;
      await createSession(db, { startedAt: t, endedAt: t + 1800_000, name: `Session ${i}` });
    }

    const d = await loadDashboard(db, NOON);
    expect(d.recent).toHaveLength(5);
    expect(d.recent[0].name).toBe('Session 0');
    expect(d.recent[4].name).toBe('Session 4');
  });

  it('reports per-session duration, set count and volume in the recent preview', async () => {
    const db = makeDb();
    await createSession(db, {
      startedAt: NOON - 3600_000,
      endedAt: NOON,
      logs: [bench, bench, bench],
    });

    const d = await loadDashboard(db, NOON);
    expect(d.recent[0].durationMs).toBe(3600_000);
    expect(d.recent[0].setCount).toBe(3);
    expect(d.recent[0].resistanceGramReps).toBe(60_000 * 5 * 3);
  });

  it('surfaces the last trained routine from the newest session that has one', async () => {
    const db = makeDb();
    await createSession(db, {
      startedAt: DAY - 2 * 3600_000,
      endedAt: DAY - 3600_000,
      routineId: 'routine-a',
      name: 'Routine A',
    });
    await createSession(db, {
      startedAt: NOON - 3600_000,
      endedAt: NOON,
      routineId: 'routine-b',
      name: 'Routine B',
    });

    const d = await loadDashboard(db, NOON);
    expect(d.lastRoutine).toEqual({ id: 'routine-b', name: 'Routine B', lastTrainedAt: NOON });
  });

  it('falls back to a session without a routine id when no routine-linked session exists', async () => {
    const db = makeDb();
    await createSession(db, { startedAt: NOON - 3600_000, endedAt: NOON, routineId: null });

    const d = await loadDashboard(db, NOON);
    expect(d.lastRoutine).toBeNull();
  });

  it('bucketizes by local calendar day even across midnight', async () => {
    const db = makeDb();
    const lateNight = DAY + 23 * 3600_000; // 23:00 today
    await createSession(db, { startedAt: lateNight - 1800_000, endedAt: lateNight, logs: [bench] });

    const d = await loadDashboard(db, lateNight);
    expect(d.daily[6].dayStartMs).toBe(DAY);
    expect(d.daily[6].sessionCount).toBe(1);
    expect(d.daily[6].resistanceGramReps).toBe(60_000 * 5);
  });

  it('excludes a session completing just before the window start', async () => {
    const db = makeDb();
    const weekStart = new Date(DAY);
    weekStart.setDate(weekStart.getDate() - 6);
    await createSession(db, {
      startedAt: weekStart.getTime() - 2 * 3600_000,
      endedAt: weekStart.getTime() - 1000, // 23:59:59 the day before the window
      logs: [bench],
    });

    const d = await loadDashboard(db, NOON);
    expect(d.week.sessionCount).toBe(0);
    expect(d.daily.some((b) => b.sessionCount > 0)).toBe(false);
  });

  it('handles sessions with no set logs without crashing', async () => {
    const db = makeDb();
    await createSession(db, { startedAt: NOON - 3600_000, endedAt: NOON });

    const d = await loadDashboard(db, NOON);
    expect(d.week.sessionCount).toBe(1);
    expect(d.week.completedSetCount).toBe(0);
    expect(d.week.resistanceGramReps).toBe(0);
    expect(d.recent[0].setCount).toBe(0);
  });
});
