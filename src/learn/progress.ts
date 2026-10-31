import { getSetting, setSetting } from '../data/settings';
import { SEED_EXERCISES } from '../../scripts/seed-exercises';
import type { Database } from '@nozbe/watermelondb';
import { Q } from '@nozbe/watermelondb';

/**
 * Learning progress (D-061): one versioned JSON document in app_settings —
 * device-local educational state, deliberately excluded from backups with all
 * other settings. Training data is never touched by the learning system.
 */

export const LEARN_PROGRESS_KEY = 'learn_progress_v1';

const MAX_LESSONS = 64;

export interface LearnProgress {
  version: 1;
  /** Welcome screen already shown with one of its two paths chosen. */
  welcomeDone: boolean;
  /** Lesson ids the user completed (evidence-verified or practice-confirmed). */
  completed: string[];
}

export const emptyLearnProgress = (): LearnProgress => ({ version: 1, welcomeDone: false, completed: [] });

/** Parse defensively: corrupt/partial/malicious documents degrade to empty, never throw. */
export function parseLearnProgress(raw: string | null): LearnProgress {
  if (raw == null) return emptyLearnProgress();
  try {
    const decoded = JSON.parse(raw) as Partial<LearnProgress> | null;
    if (!decoded || typeof decoded !== 'object') return emptyLearnProgress();
    const completed = Array.isArray(decoded.completed)
      ? [...new Set(decoded.completed.filter((id): id is string => typeof id === 'string'))].slice(0, MAX_LESSONS)
      : [];
    return {
      version: 1,
      welcomeDone: decoded.welcomeDone === true,
      completed,
    };
  } catch {
    return emptyLearnProgress();
  }
}

export function serializeLearnProgress(progress: LearnProgress): string {
  return JSON.stringify(progress);
}

/** Idempotent completion marker (pure): repeated taps never duplicate ids. */
export function markLessonCompleted(progress: LearnProgress, id: string): LearnProgress {
  if (progress.completed.includes(id)) return progress;
  return { ...progress, completed: [...progress.completed, id].slice(0, MAX_LESSONS) };
}

export async function loadLearnProgress(db: Database): Promise<LearnProgress> {
  return parseLearnProgress(await getSetting(db, LEARN_PROGRESS_KEY));
}

export async function saveLearnProgress(db: Database, progress: LearnProgress): Promise<void> {
  await setSetting(db, LEARN_PROGRESS_KEY, serializeLearnProgress(progress));
}

const SEED_EXERCISE_IDS = SEED_EXERCISES.map((seed) => seed.id);

/**
 * Aggregate counts for lesson verification (D-062, amended by D-063): scalar
 * queries only, join-free and read-only. `userExercises` excludes the seeded
 * starters, so the library lesson needs a real authoring action instead of a
 * hard-coded total that seed deletion or import could fake. `setLogs` counts
 * recorded sets; `completedSessions` is used only where finishing a session is
 * itself the taught action (history no longer auto-completes from it).
 */
export interface LessonCounts {
  /** Exercises created by the athlete (seeded starters excluded). */
  userExercises: number;
  routines: number;
  setLogs: number;
  completedSessions: number;
}

export async function loadLessonCounts(db: Database): Promise<LessonCounts> {
  const [userExercises, routines, setLogs, completedSessions] = await Promise.all([
    db
      .get('exercises')
      .query(Q.where('id', Q.notIn(SEED_EXERCISE_IDS)))
      .fetchCount(),
    db.get('routines').query().fetchCount(),
    db.get('set_logs').query().fetchCount(),
    db
      .get('workout_sessions')
      .query(Q.where('session_status', 'completed'))
      .fetchCount(),
  ]);
  return { userExercises, routines, setLogs, completedSessions };
}
