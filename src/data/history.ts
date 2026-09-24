import { Database, Q } from '@nozbe/watermelondb';
import { WorkoutSession, SetLog } from './models';
import { definitionOf } from './serialize';
import type { RoutineDefinition, BlockDef, StepDef } from '../types/engine';

/**
 * History queries — narrow, completed-only, newest first.
 * Historical structure always comes from the session's immutable definition_json snapshot.
 */

export interface HistoryListItem {
  id: string;
  name: string;
  startedAt: number;
  endedAt: number | null;
  durationMs: number | null;
  setCount: number;
}

export interface HistorySetLog {
  id: string;
  blockIndex: number;
  stepIndex: number;
  round: number;
  setIndex: number;
  weightGrams: number | null;
  reps: number | null;
  durationMs: number | null;
  distanceMm: number | null;
  rir: number | null;
  isCompleted: number;
  completedAt: number | null;
}

export interface HistoryStepRow {
  blockIndex: number;
  stepIndex: number;
  round: number;
  setIndex: number;
  weightGrams: number | null;
  reps: number | null;
  durationMs: number | null;
  rir: number | null;
}

export interface HistoryBlockView {
  blockIndex: number;
  name: string;
  kind: string;
  rounds: number;
  steps: Array<{
    stepIndex: number;
    exerciseName: string;
    targetSets: number | null;
    targetRepsMin: number | null;
    targetRepsMax: number | null;
    targetWeightGrams: number | null;
    targetDurationMs: number | null;
    targetRir: number | null;
    logs: HistoryStepRow[];
  }>;
}

export interface HistoryDetail {
  id: string;
  name: string;
  startedAt: number;
  endedAt: number | null;
  durationMs: number | null;
  status: string;
  definition: RoutineDefinition;
  blocks: HistoryBlockView[];
  totalCompletedSets: number;
}

function durationOf(startedAt: number, endedAt: number | null): number | null {
  if (endedAt === null || endedAt < startedAt) return null;
  return endedAt - startedAt;
}

/** Completed sessions only, newest first. Does not load set_logs (N+1 avoided via one grouped query). */
export async function listCompletedSessions(db: Database): Promise<HistoryListItem[]> {
  const sessions = await db
    .get<WorkoutSession>('workout_sessions')
    .query(Q.where('session_status', 'completed'), Q.sortBy('ended_at', 'desc'))
    .fetch();

  if (sessions.length === 0) return [];

  const sessionIds = sessions.map((s) => s.id);
  const logs = await db
    .get<SetLog>('set_logs')
    .query(Q.where('session_exercise_id', Q.oneOf(await sessionExerciseIds(db, sessionIds))))
    .fetch();

  // Count completed sets per session via session_exercises bridge.
  const seRows = await db
    .get<any>('session_exercises')
    .query(Q.where('session_id', Q.oneOf(sessionIds)))
    .fetch();
  const seById = new Map(seRows.map((r: { id: string; sessionId: string }) => [r.id, r.sessionId]));
  const countBySession = new Map<string, number>();
  for (const log of logs) {
    if (log.isCompleted !== 1) continue;
    const sid = seById.get(log.sessionExerciseId);
    if (!sid) continue;
    countBySession.set(sid, (countBySession.get(sid) ?? 0) + 1);
  }

  return sessions.map((s) => ({
    id: s.id,
    name: s.name,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    durationMs: durationOf(s.startedAt, s.endedAt),
    setCount: countBySession.get(s.id) ?? 0,
  }));
}

async function sessionExerciseIds(db: Database, sessionIds: string[]): Promise<string[]> {
  const rows = await db
    .get<any>('session_exercises')
    .query(Q.where('session_id', Q.oneOf(sessionIds)))
    .fetch();
  return rows.map((r: { id: string }) => r.id);
}

/**
 * Load one completed session's detail from its snapshot + set_logs.
 * Returns null if missing / not completed / corrupt snapshot.
 */
export async function loadSessionDetail(db: Database, sessionId: string): Promise<HistoryDetail | null> {
  try {
    const session = await db.get<WorkoutSession>('workout_sessions').find(sessionId);
    if (!session || session.sessionStatus !== 'completed') return null;
    const definition = definitionOf(session);
    if (!definition || !Array.isArray(definition.blocks)) return null;

    const seRows = await db
      .get<any>('session_exercises')
      .query(Q.where('session_id', sessionId))
      .fetch();
    const seIds = seRows.map((r: { id: string }) => r.id);

    const allLogs: SetLog[] =
      seIds.length === 0
        ? []
        : await db.get<SetLog>('set_logs').query(Q.where('session_exercise_id', Q.oneOf(seIds))).fetch();

    // Group logs by block/step (ignore voided rows for display of performed sets).
    const logsByStep = new Map<string, HistoryStepRow[]>();
    let totalCompletedSets = 0;
    for (const log of allLogs) {
      if (log.isCompleted !== 1) continue;
      totalCompletedSets += 1;
      const key = `${log.blockIndex}:${log.stepIndex}`;
      const list = logsByStep.get(key) ?? [];
      list.push({
        blockIndex: log.blockIndex,
        stepIndex: log.stepIndex,
        round: log.round,
        setIndex: log.setIndex,
        weightGrams: log.weightGrams,
        reps: log.reps,
        durationMs: log.durationMs,
        rir: log.rir,
      });
      logsByStep.set(key, list);
    }

    const blocks: HistoryBlockView[] = definition.blocks.map((block: BlockDef, blockIndex: number) => ({
      blockIndex,
      name: block.name,
      kind: block.kind,
      rounds: block.rounds,
      steps: block.steps.map((step: StepDef, stepIndex: number) => {
        const logs = (logsByStep.get(`${blockIndex}:${stepIndex}`) ?? []).slice().sort((a, b) => {
          if (a.round !== b.round) return a.round - b.round;
          return a.setIndex - b.setIndex;
        });
        const p = step.prescription;
        return {
          stepIndex,
          exerciseName: step.exerciseName,
          targetSets: p.targetSets,
          targetRepsMin: p.targetRepsMin,
          targetRepsMax: p.targetRepsMax,
          targetWeightGrams: p.targetWeightGrams,
          targetDurationMs: p.targetDurationMs,
          targetRir: p.targetRir,
          logs,
        };
      }),
    }));

    return {
      id: session.id,
      name: session.name,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      durationMs: durationOf(session.startedAt, session.endedAt),
      status: session.sessionStatus,
      definition,
      blocks,
      totalCompletedSets,
    };
  } catch {
    return null;
  }
}
