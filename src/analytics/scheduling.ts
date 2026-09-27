/**
 * Flexible scheduling (Phase 4C, PROGRAMMING != CALENDAR).
 * Programs declare WHAT to train; completed sessions decide WHAT'S NEXT.
 * Never any dates, deadlines or mandatory calendar — the athlete stays free
 * to start anything else.
 */

export interface ProgramMember {
  routineId: string;
  name: string;
  /** program_order (ascending = authored order). */
  order: number;
  /** Max session.startedAt for this routine, null when never trained. */
  lastTrainedAt: number | null;
}

export interface NextUp {
  routineId: string;
  name: string;
  /** True when the member has no completed session yet. */
  neverTrained: boolean;
}

/**
 * The next routine of a program is its least-recently-trained member
 * (never-trained members come first), ordered by program order on ties.
 * Deterministic; empty input yields null.
 */
export function computeNextUp(members: ProgramMember[]): NextUp | null {
  if (members.length === 0) return null;
  let best = members[0];
  for (let i = 1; i < members.length; i++) {
    const m = members[i];
    const a = m.lastTrainedAt ?? Number.NEGATIVE_INFINITY;
    const b = best.lastTrainedAt ?? Number.NEGATIVE_INFINITY;
    if (a < b || (a === b && m.order < best.order)) best = m;
  }
  return {
    routineId: best.routineId,
    name: best.name,
    neverTrained: best.lastTrainedAt == null,
  };
}
