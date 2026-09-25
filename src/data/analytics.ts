import { Database, Q } from '@nozbe/watermelondb';
import { Exercise, SetLog, SessionExercise, WorkoutSession } from './models';
import { definitionOf } from './serialize';
import type { RoutineDefinition } from '../types/engine';
import type { SetLoadInput } from '../analytics/load';
import {
  buildMuscleCatalog,
  resolveContributions,
  type Contributions,
  type MuscleCatalog,
  type MuscleMapEntry,
  type MuscleSessionInput,
} from '../analytics/muscles';
import { SEED_EXERCISES } from '../../scripts/seed-exercises';

/**
 * Normalized analytics snapshot (Phase 2F): one batched retrieval that feeds
 * training-load, load-trend and muscle-distribution screens without N+1
 * per-session or per-muscle queries. Muscle mapping is resolved here (data
 * layer) so pure modules stay free of DB access.
 */

export interface AnalyticsExercise {
  id: string;
  name: string;
  category: string;
  equipment: string;
  metricFlags: number;
}

export type AnalyticsSession = MuscleSessionInput;

export interface AnalyticsSnapshot {
  /** Completed sessions only, with per-step sets and resolved muscle mapping. */
  sessions: AnalyticsSession[];
  exercises: AnalyticsExercise[];
}

let catalogCache: MuscleCatalog | null = null;

/** Memoized built-in muscle catalog (application metadata — not persisted user data). */
export function muscleCatalog(): MuscleCatalog {
  if (catalogCache === null) {
    const entries: MuscleMapEntry[] = SEED_EXERCISES.map((seed) => ({
      seedId: seed.id,
      name: seed.name,
      category: seed.category,
      equipment: seed.equipment,
      metricFlags: seed.metricFlags,
      contributions: seed.contributions,
    }));
    catalogCache = buildMuscleCatalog(entries);
  }
  return catalogCache;
}

/** Test-only: clear the memoized catalog. */
export function resetMuscleCatalogForTests(): void {
  catalogCache = null;
}

function toSetLoadInput(log: SetLog): SetLoadInput {
  return {
    weightGrams: log.weightGrams,
    reps: log.reps,
    durationMs: log.durationMs,
    distanceMm: log.distanceMm,
    isCompleted: log.isCompleted === 1,
  };
}

/**
 * Load completed sessions' definition steps + set logs + exercise rows in a
 * fixed number of queries (4) regardless of session count.
 * Corrupt/missing snapshots are skipped — never crash, never invent data.
 */
export async function loadAnalyticsSnapshot(db: Database): Promise<AnalyticsSnapshot> {
  const exerciseRows = await db.get<Exercise>('exercises').query().fetch();
  const exercises: AnalyticsExercise[] = exerciseRows.map((e) => ({
    id: e.id,
    name: e.name,
    category: e.category,
    equipment: e.equipment,
    metricFlags: e.metricFlags,
  }));
  const exerciseById = new Map(exercises.map((e) => [e.id, e]));

  const sessionRows = await db
    .get<WorkoutSession>('workout_sessions')
    .query(Q.where('session_status', 'completed'))
    .fetch();
  if (sessionRows.length === 0) return { sessions: [], exercises };

  const sessionIds = sessionRows.map((s) => s.id);
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

  const logsByStep = new Map<string, Array<{ round: number; setIndex: number; input: SetLoadInput }>>();
  for (const log of logs) {
    const sessionId = sessionBySeId.get(log.sessionExerciseId);
    if (!sessionId) continue;
    const key = `${sessionId}:${log.blockIndex}:${log.stepIndex}`;
    const list = logsByStep.get(key) ?? [];
    list.push({ round: log.round, setIndex: log.setIndex, input: toSetLoadInput(log) });
    logsByStep.set(key, list);
  }
  for (const list of logsByStep.values()) {
    list.sort((a, b) => a.round - b.round || a.setIndex - b.setIndex);
  }

  const catalog = muscleCatalog();
  const sessions: AnalyticsSession[] = [];

  for (const session of sessionRows) {
    let definition: RoutineDefinition | null = null;
    try {
      definition = definitionOf(session);
    } catch {
      continue;
    }
    if (!definition || !Array.isArray(definition.blocks)) continue;

    const sessionSteps: AnalyticsSession['exercises'] = [];
    for (const [blockIndex, block] of definition.blocks.entries()) {
      if (!Array.isArray(block?.steps)) continue;
      for (const [stepIndex, step] of block.steps.entries()) {
        const stepSets =
          logsByStep.get(`${session.id}:${blockIndex}:${stepIndex}`)?.map((entry) => entry.input) ?? [];
        if (stepSets.length === 0) continue;

        const row = step.exerciseId ? exerciseById.get(step.exerciseId) : undefined;
        const identity = row
          ? {
              id: row.id,
              name: row.name,
              category: row.category,
              equipment: row.equipment,
              metricFlags: row.metricFlags,
            }
          : {
              id: null,
              name: step.exerciseName ?? '',
              category: '',
              equipment: '',
              metricFlags: 0,
            };
        const contributions: Contributions | null = resolveContributions(catalog, identity);

        sessionSteps.push({
          exerciseName: step.exerciseName,
          exerciseId: identity.id,
          contributions,
          sets: stepSets,
        });
      }
    }

    sessions.push({
      sessionId: session.id,
      name: session.name,
      timestampMs: session.endedAt ?? session.startedAt,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      exercises: sessionSteps,
    });
  }

  return { sessions, exercises };
}
