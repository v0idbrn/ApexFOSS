import { Database, Q } from '@nozbe/watermelondb';
import { SessionExercise, SetLog, WorkoutSession } from './models';
import { calculateSetLoad, startOfLocalDay } from '../analytics/load';

/**
 * Bounded dashboard snapshot (Phase 2J §3 + §24): at most WEEK_TAKE of the
 * newest completed sessions, fetched in 3 batched queries (never N+1, never
 * unbounded history). Pure aggregation — no interpretation of the numbers.
 */

const RECENT_TAKE = 5;
/** Safety bound: no realistic week exceeds this session count; keeps Home queries bounded. */
const WEEK_TAKE = 120;

export interface DashboardSession {
  id: string;
  name: string;
  routineId: string | null;
  startedAt: number;
  endedAt: number | null;
  /** Wall-clock duration (endedAt − startedAt); null when unavailable. */
  durationMs: number | null;
  setCount: number;
  resistanceGramReps: number;
}

export interface DailyLoad {
  /** Local midnight of the bucket day. */
  dayStartMs: number;
  resistanceGramReps: number;
  sessionCount: number;
}

export interface WeekTotals {
  sessionCount: number;
  resistanceGramReps: number;
  completedSetCount: number;
  /** Sum of wall-clock session durations in the window. */
  wallMs: number;
}

export interface DashboardData {
  /** Newest first. */
  recent: DashboardSession[];
  week: WeekTotals;
  /** 7 buckets, oldest → newest (current local week incl. today). */
  daily: DailyLoad[];
  lastRoutine: { id: string; name: string; lastTrainedAt: number } | null;
}

function emptyWeek(): WeekTotals {
  return { sessionCount: 0, resistanceGramReps: 0, completedSetCount: 0, wallMs: 0 };
}

function sevenDayBuckets(now: number): DailyLoad[] {
  const todayStart = startOfLocalDay(now);
  const buckets: DailyLoad[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(todayStart);
    d.setDate(d.getDate() - i);
    buckets.push({ dayStartMs: d.getTime(), resistanceGramReps: 0, sessionCount: 0 });
  }
  return buckets;
}

function durationOf(startedAt: number, endedAt: number | null): number | null {
  if (endedAt === null || endedAt < startedAt) return null;
  return endedAt - startedAt;
}

export async function loadDashboard(db: Database, now: number): Promise<DashboardData> {
  const daily = sevenDayBuckets(now);
  const week = emptyWeek();

  const sessions = await db
    .get<WorkoutSession>('workout_sessions')
    .query(Q.where('session_status', 'completed'), Q.sortBy('ended_at', 'desc'), Q.take(WEEK_TAKE))
    .fetch();
  if (sessions.length === 0) {
    return { recent: [], week, daily, lastRoutine: null };
  }

  const sessionIds = sessions.map((s) => s.id);
  const seRows = await db
    .get<SessionExercise>('session_exercises')
    .query(Q.where('session_id', Q.oneOf(sessionIds)))
    .fetch();
  const sessionBySeId = new Map(seRows.map((r) => [r.id, r.sessionId]));
  const logs: SetLog[] =
    seRows.length === 0
      ? []
      : await db
          .get<SetLog>('set_logs')
          .query(Q.where('session_exercise_id', Q.oneOf(seRows.map((r) => r.id))))
          .fetch();

  interface Agg {
    setCount: number;
    resistanceGramReps: number;
  }
  const aggBySession = new Map<string, Agg>();
  for (const log of logs) {
    if (log.isCompleted !== 1) continue;
    const sid = sessionBySeId.get(log.sessionExerciseId);
    if (!sid) continue;
    const load = calculateSetLoad({
      weightGrams: log.weightGrams,
      reps: log.reps,
      durationMs: log.durationMs,
      isCompleted: true,
    });
    const agg = aggBySession.get(sid) ?? { setCount: 0, resistanceGramReps: 0 };
    agg.setCount += 1;
    agg.resistanceGramReps += load.resistanceGramReps;
    aggBySession.set(sid, agg);
  }

  const todayStart = startOfLocalDay(now);
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - 6);
  const weekStartMs = weekStart.getTime();

  const recent: DashboardSession[] = [];
  let lastRoutine: DashboardData['lastRoutine'] = null;

  for (const s of sessions) {
    const ts = s.endedAt ?? s.startedAt;
    const agg = aggBySession.get(s.id) ?? { setCount: 0, resistanceGramReps: 0 };
    const durationMs = durationOf(s.startedAt, s.endedAt);

    if (recent.length < RECENT_TAKE) {
      recent.push({
        id: s.id,
        name: s.name,
        routineId: s.routineId,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        durationMs,
        setCount: agg.setCount,
        resistanceGramReps: agg.resistanceGramReps,
      });
    }

    if (ts >= weekStartMs && ts < todayStart + 24 * 3600 * 1000) {
      week.sessionCount += 1;
      week.resistanceGramReps += agg.resistanceGramReps;
      week.completedSetCount += agg.setCount;
      week.wallMs += durationMs ?? 0;
      const dayStart = startOfLocalDay(ts);
      const bucket = daily.find((b) => b.dayStartMs === dayStart);
      if (bucket) {
        bucket.resistanceGramReps += agg.resistanceGramReps;
        bucket.sessionCount += 1;
      }
    }

    if (!lastRoutine && s.routineId) {
      lastRoutine = { id: s.routineId, name: s.name, lastTrainedAt: ts };
    }
  }

  return { recent, week, daily, lastRoutine };
}
