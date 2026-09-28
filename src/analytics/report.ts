import type { AnalyticsSnapshot } from '../data/analytics';
import type { DatedSession } from '../analytics/load';
import { exercisePrs, prEvents, type PrEvent } from '../analytics/records';
import { summarizeAdherence, type AdherenceSummary, type AdherenceRow } from '../analytics/adherence';
import { summarizeBody, type BodySummary, type RawBodyRow } from '../analytics/body';
import { dateRange } from '../analytics/load';
import { describeE1rmTrend, e1rmSeries, type TrendEvidence } from '../analytics/plateau';
import type { GoalWithProgress } from '../data/goals';

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
  e1rmTrends: Array<{ exerciseName: string; evidence: TrendEvidence }>;
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
        isCompleted: set.isCompleted,
        executionType: set.executionType ?? null,
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
        performed.push({ isCompleted: set.isCompleted, executionType: set.executionType ?? 'normal' });
        if (set.executionType === 'skipped') skipped += 1;
      }
    }
  }
  return { planned, performed, skipped };
}

function filterSessionsByPeriod(sessions: DatedSession[], period: ReportPeriod, now: number): DatedSession[] {
  if (period === 'all') return sessions;
  const range = dateRange(period === '7d' ? '7d' : '28d', now);
  return sessions.filter((s) => s.timestampMs >= range.startMs && s.timestampMs <= range.endMs);
}

export interface ReportInput {
  snapshot: AnalyticsSnapshot;
  goals: GoalWithProgress[];
  bodyRows: RawBodyRow[];
  period: ReportPeriod;
  now?: number;
}

function computePerExerciseVolume(sessions: DatedSession[]): Array<{ exerciseName: string; gramReps: number; setCount: number }> {
  const byExercise = new Map<string, { gramReps: number; setCount: number }>();
  for (const s of sessions) {
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

export function buildReport({ snapshot, goals, bodyRows, period, now = Date.now() }: ReportInput): ReportData {
  const dated = toDatedSession(snapshot);
  const filtered = filterSessionsByPeriod(dated, period, now);

  const perExerciseVolume = computePerExerciseVolume(filtered);
  const totalVolumeGramReps = perExerciseVolume.reduce((sum, e) => sum + e.gramReps, 0);
  let completedSets = 0;
  let totalDurationMs = 0;
  for (const s of filtered) {
    if (s.endedAt != null && s.endedAt >= s.startedAt) totalDurationMs += s.endedAt - s.startedAt;
    for (const ex of s.exercises) {
      for (const set of ex.sets) {
        if (set.isCompleted) completedSets += 1;
      }
    }
  }

  const allPrs = exercisePrs(filtered);
  const allPrEvents = prEvents(filtered);

  const adherence = summarizeAdherence(buildAdherenceInput(filtered));

  const goalsReport = goals.map((g) => ({
    exerciseName: g.exerciseName,
    targetGrams: g.targetGrams,
    currentBestGrams: g.currentGrams,
    progress: g.progress,
    achieved: g.achieved,
  }));

  const bodySummary = bodyRows.length === 0 ? null : summarizeBody(bodyRows);

  const e1rmTrends: Array<{ exerciseName: string; evidence: TrendEvidence }> = [];
  for (const pr of allPrs) {
    const evidence = describeE1rmTrend(e1rmSeries(filtered, null, pr.exerciseName));
    if (evidence.status !== 'insufficient_data') {
      e1rmTrends.push({ exerciseName: pr.exerciseName, evidence });
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
      averageSetsPerSession: filtered.length > 0 ? Math.round(completedSets / filtered.length) : 0,
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