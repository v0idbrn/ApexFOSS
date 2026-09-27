import type { AnalyticsSnapshot } from '../data/analytics';
import type { DatedSession, SetLoadInput, SessionLoadInput } from '../analytics/load';
import { calculateSessionLoad } from '../analytics/load';
import { exercisePrs, prEvents, type PrEvent } from '../analytics/records';
import { summarizeAdherence, type AdherenceSummary, type AdherenceRow } from '../analytics/adherence';
import { summarizeBody, type BodySummary } from '../analytics/body';
import { dateRange, type DateRange } from '../analytics/load';
import { describeE1rmTrend, type TrendEvidence } from '../analytics/plateau';
import { evaluateGoal } from '../data/goals';
import { loadGoals } from '../data/goals';
import { makeDbActions } from '../data/actions';
import type { BodyMetric } from '../data/models';
import { loadAnalyticsSnapshot } from '../data/analytics';

export type ReportPeriod = '7d' | '28d' | 'all';

export interface ReportData {
  period: ReportPeriod;
  periodLabel: string;
  generatedAt: number;
  sessions: {
    total: number;
    completed: number;
    totalVolumeKgReps: number;
    totalDurationMs: number;
    averageSetsPerSession: number;
  };
  volume: {
    totalGramReps: number;
    byExercise: Array<{ exerciseName: string; gramReps: number; setCount: number }>;
  };
  prs: {
    count: number;
    events: PrEvent[];
    byExercise: ReturnType<typeof exercisePrs>;
  };
  adherence: AdherenceSummary;
  body: BodySummary | null;
  goals: Array<{
    exerciseName: string;
    targetGrams: number;
    currentBestGrams: number | null;
    progress: number | null;
    achieved: boolean;
  }>;
  e1rmTrends: TrendEvidence[];
}

function toDatedSession(snap: AnalyticsSnapshot): DatedSession[] {
  return snap.sessions.map((s) => ({
    sessionId: s.sessionId,
    name: s.name,
    startedAt: s.startedAt,
    endedAt: s.endedAt ?? null,
    timestampMs: s.endedAt ?? s.startedAt,
    exercises: s.exercises.map((e) => ({
      exerciseName: e.exerciseName,
      exerciseId: e.exerciseId,
      sets: e.sets.map((set) => ({
        weightGrams: set.weightGrams,
        reps: set.reps,
        durationMs: set.durationMs,
        distanceMm: set.distanceMm,
        isCompleted: set.isCompleted ?? 1,
      })),
    })),
  }));
}

function buildAdherenceInput(sessions: DatedSession[]): { planned: number; performed: AdherenceRow[]; skipped: number } {
  let planned = 0;
  const performed: AdherenceRow[] = [];
  let skipped = 0;
  for (const session of sessions) {
    for (const ex of session.exercises) {
      for (const set of ex.sets) {
        planned += 1;
        if (set.isCompleted) {
          performed.push({ isCompleted: true, executionType: 'normal' });
        } else {
          performed.push({ isCompleted: false, executionType: 'normal' });
        }
      }
    }
  }
  return { planned, performed, skipped };
}

function filterSessionsByPeriod(sessions: DatedSession[], period: ReportPeriod, now: number): DatedSession[] {
  if (period === 'all') return sessions;
  const range: DateRange = dateRange(period === '7d' ? '7d' : '28d', now);
  return sessions.filter((s) => s.timestampMs >= range.startMs && s.timestampMs <= range.endMs);
}

function extractBodyMetricsFromDb(db: import('@nozbe/watermelondb').Database): Promise<BodySummary | null> {
  return makeDbActions(db).listBodyMetrics().then((rows) => {
    if (rows.length === 0) return null;
    return summarizeBody(rows.map((r) => ({
      timestampMs: r.measuredAt,
      weightGrams: r.weightGrams,
      waistMm: r.waistMm,
    })));
  });
}

function computePerExerciseVolume(sessions: DatedSession[], range: DateRange): Array<{ exerciseName: string; gramReps: number; setCount: number }> {
  const byExercise = new Map<string, { gramReps: number; setCount: number }>();
  for (const s of sessions) {
    if (s.timestampMs < range.startMs || s.timestampMs >= range.endMs) continue;
    for (const ex of s.exercises) {
      const agg = { gramReps: 0, setCount: 0 };
      for (const set of ex.sets) {
        if (!set.isCompleted) continue;
        if (set.weightGrams !== null && set.reps !== null && set.weightGrams > 0 && set.reps > 0) {
          agg.gramReps += set.weightGrams * set.reps;
          agg.setCount += 1;
        }
      }
      if (agg.setCount > 0) {
        const existing = byExercise.get(ex.exerciseName);
        if (existing) {
          existing.gramReps += agg.gramReps;
          existing.setCount += agg.setCount;
        } else {
          byExercise.set(ex.exerciseName, agg);
        }
      }
    }
  }
  return Array.from(byExercise.entries()).map(([exerciseName, v]) => ({
    exerciseName,
    gramReps: v.gramReps,
    setCount: v.setCount,
  })).sort((a, b) => b.gramReps - a.gramReps);
}

export async function generateReport(db: import('@nozbe/watermelondb').Database, period: ReportPeriod, now = Date.now()): Promise<ReportData> {
  const snap = await loadAnalyticsSnapshot(db);
  const dated = toDatedSession(snap);
  const filtered = filterSessionsByPeriod(dated, period, now);

  const range: DateRange = period === 'all' ? dateRange('28d', now) : dateRange(period === '7d' ? '7d' : '28d', now);

  const perExerciseVolume = computePerExerciseVolume(filtered, range);
  const totalVolumeGramReps = perExerciseVolume.reduce((sum, e) => sum + e.gramReps, 0);
  const totalSets = perExerciseVolume.reduce((sum, e) => sum + e.setCount, 0);
  const totalDurationMs = filtered.reduce((sum, s) => {
    const ended = s.exercises.flatMap((e) => e.sets.map((set) => set.durationMs ?? 0)).reduce((a, b) => a + b, 0);
    return sum + ended;
  }, 0);

  const allPrs = exercisePrs(filtered);
  const allPrEvents = prEvents(filtered);

  const adherence = summarizeAdherence(buildAdherenceInput(filtered));

  const goalsData = await loadGoals(db);
  const goalsReport = goalsData.map((g) => {
    const pr = allPrs.find((p) => p.exerciseName === g.exerciseName);
    const currentBest = pr?.estimated1rmGrams ?? pr?.bestWeightGrams ?? null;
    const evalResult = evaluateGoal(g.targetGrams, currentBest);
    return {
      exerciseName: g.exerciseName,
      targetGrams: g.targetGrams,
      currentBestGrams: currentBest,
      progress: evalResult.progress,
      achieved: evalResult.achieved,
    };
  });

  const bodySummary = await extractBodyMetricsFromDb(db);

  const e1rmTrends: TrendEvidence[] = [];
  for (const pr of allPrs) {
    if (pr.estimated1rmGrams === null || pr.estimated1rmAtMs === null) continue;
    const points: { timestampMs: number; estimated1rmGrams: number; exerciseName: string; sessionId: string }[] = [
      { timestampMs: pr.estimated1rmAtMs, estimated1rmGrams: pr.estimated1rmGrams, exerciseName: pr.exerciseName, sessionId: '' },
    ];
    if (pr.bestWeightGrams !== null && pr.bestWeightAtMs !== null) {
      points.push({ timestampMs: pr.bestWeightAtMs, estimated1rmGrams: pr.bestWeightGrams, exerciseName: pr.exerciseName, sessionId: '' });
    }
    if (points.length >= 2) {
      const trend = describeE1rmTrend(points);
      if (trend.status !== 'insufficient_data') {
        e1rmTrends.push(trend);
      }
    }
  }

  return {
    period,
    periodLabel: period === '7d' ? 'Last 7 days' : period === '28d' ? 'Last 28 days' : 'All time',
    generatedAt: now,
    sessions: {
      total: filtered.length,
      completed: filtered.length,
      totalVolumeKgReps: Math.round(totalVolumeGramReps / 1000),
      totalDurationMs,
      averageSetsPerSession: filtered.length > 0 ? Math.round(totalSets / filtered.length) : 0,
    },
    volume: {
      totalGramReps: totalVolumeGramReps,
      byExercise: perExerciseVolume,
    },
    prs: {
      count: allPrEvents.length,
      events: allPrEvents,
      byExercise: allPrs,
    },
    adherence,
    body: bodySummary,
    goals: goalsReport,
    e1rmTrends,
  };
}