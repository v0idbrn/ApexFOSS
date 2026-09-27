import { Database } from '@nozbe/watermelondb';
import { Exercise, Goal } from './models';
import { loadAnalyticsSnapshot } from './analytics';
import { e1rmSeries } from '../analytics/plateau';

/**
 * Phase 4D: athlete-declared strength goals (target e1RM per exercise).
 * Achieved state is always derived from history — never stored.
 */

export interface GoalProgress {
  targetGrams: number;
  /** Best recorded e1RM; null when the exercise has no completed history. */
  currentGrams: number | null;
  /** 0..1 toward the target; null without history. */
  progress: number | null;
  achieved: boolean;
}

export function evaluateGoal(targetGrams: number, currentGrams: number | null): GoalProgress {
  if (currentGrams === null || !Number.isFinite(currentGrams) || currentGrams <= 0) {
    return { targetGrams, currentGrams: null, progress: null, achieved: false };
  }
  return {
    targetGrams,
    currentGrams,
    progress: Math.min(1, currentGrams / targetGrams),
    achieved: currentGrams >= targetGrams,
  };
}

export interface GoalWithProgress extends GoalProgress {
  id: string;
  exerciseId: string;
  exerciseName: string;
}

export async function loadGoals(db: Database): Promise<GoalWithProgress[]> {
  const rows = await db.get<Goal>('goals').query().fetch();
  if (rows.length === 0) return [];
  const exercises = await db.get<Exercise>('exercises').query().fetch();
  const nameById = new Map(exercises.map((e) => [e.id, e.name]));
  const { sessions } = await loadAnalyticsSnapshot(db);
  return rows.map((g) => {
    const exerciseName = nameById.get(g.exerciseId) ?? '';
    const series = e1rmSeries(sessions, g.exerciseId, exerciseName);
    let current: number | null = null;
    for (const p of series) {
      if (current === null || p.estimated1rmGrams > current) current = p.estimated1rmGrams;
    }
    return {
      id: g.id,
      exerciseId: g.exerciseId,
      exerciseName,
      ...evaluateGoal(g.targetWeightGrams, current),
    };
  });
}
