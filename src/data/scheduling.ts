import { Database, Q } from '@nozbe/watermelondb';
import { computeNextUp, type ProgramMember } from '../analytics/scheduling';
import { makeDbActions } from './actions';

export interface NextUpInfo {
  programId: string;
  programName: string;
  routineId: string;
  routineName: string;
  neverTrained: boolean;
  memberCount: number;
}

/**
 * Phase 4C loader: which routine would the program suggest next?
 * Picks the most recently active program (first-created on ties or when no
 * session exists yet), then applies computeNextUp to its members. Programs
 * without routines are skipped. No dates are involved.
 */
export async function loadNextUp(db: Database): Promise<NextUpInfo | null> {
  const actions = makeDbActions(db);
  const programs = await actions.listProgramsWithCounts();
  if (programs.length === 0) return null;

  const routineRows = (await db.get<any>('routines').query().fetch()) as unknown as Array<{
    id: string;
    name: string;
    programId: string | null;
    programOrder: number | null;
  }>;
  // Newest first: the first hit per routine is its latest session.
  const sessionRows = (await db
    .get<any>('workout_sessions')
    .query(Q.sortBy('started_at', 'desc'))
    .fetch()) as unknown as Array<{ routineId: string | null; startedAt: number }>;
  const lastByRoutine = new Map<string, number>();
  for (const s of sessionRows) {
    if (s.routineId != null && !lastByRoutine.has(s.routineId)) lastByRoutine.set(s.routineId, s.startedAt);
  }

  const membersByProgram = new Map<string, ProgramMember[]>();
  for (const r of routineRows) {
    if (r.programId == null) continue;
    const list = membersByProgram.get(r.programId) ?? [];
    list.push({
      routineId: r.id,
      name: r.name,
      order: r.programOrder ?? Number.MAX_SAFE_INTEGER,
      lastTrainedAt: lastByRoutine.get(r.id) ?? null,
    });
    membersByProgram.set(r.programId, list);
  }

  let chosenProgram: (typeof programs)[number] | null = null;
  let chosenMembers: ProgramMember[] = [];
  let chosenAt = Number.NEGATIVE_INFINITY;
  for (const p of programs) {
    const members = membersByProgram.get(p.id) ?? [];
    if (members.length === 0) continue;
    const at = members.reduce((acc, m) => Math.max(acc, m.lastTrainedAt ?? -1), -1);
    if (at > chosenAt) {
      chosenAt = at;
      chosenProgram = p;
      chosenMembers = members;
    }
  }
  if (!chosenProgram) return null;

  const next = computeNextUp(chosenMembers);
  if (!next) return null;
  return {
    programId: chosenProgram.id,
    programName: chosenProgram.name,
    routineId: next.routineId,
    routineName: next.name,
    neverTrained: next.neverTrained,
    memberCount: chosenMembers.length,
  };
}
