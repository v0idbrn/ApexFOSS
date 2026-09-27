import type { ExecutionType } from '../types/engine';

/**
 * Session adherence (Phase 3D): raw facts about what the athlete performed
 * against the immutable prescription. Counts only — deliberately never a
 * single composite score. Execution types are recorded facts (Phase 3C);
 * nothing here is inferred. No React, no DB, no IO.
 */

export interface AdherenceRow {
  isCompleted: boolean;
  executionType?: ExecutionType | null;
}

export interface AdherenceInput {
  /** Planned positions from the immutable prescription (definition-derived). */
  planned: number;
  /** Completed set rows (normal / modified / extra / drop). */
  performed: AdherenceRow[];
  /** Prescribed positions recorded as skipped (Phase 3C rows). */
  skipped: number;
}

export interface AdherenceCounts {
  /** Prescription positions (planned denominator). */
  planned: number;
  /** Prescribed positions actually performed (normal + modified). */
  plannedPerformed: number;
  skipped: number;
  modified: number;
  extra: number;
  drop: number;
  /** Every completed row, including additions beyond the prescription. */
  performed: number;
}

export type AdherenceStatus = 'complete' | 'partial' | 'none';

export interface AdherenceSummary extends AdherenceCounts {
  status: AdherenceStatus;
}

/**
 * Summarize adherence from the prescription denominator plus the athlete's
 * recorded rows. Extra/drop rows are additions and never satisfy a skipped
 * prescribed position. Voided rows (isCompleted false) are not performed.
 */
export function summarizeAdherence(input: AdherenceInput): AdherenceSummary {
  let modified = 0;
  let extra = 0;
  let drop = 0;
  let performed = 0;
  for (const row of input.performed) {
    if (!row.isCompleted || row.executionType === 'skipped') continue;
    performed += 1;
    if (row.executionType === 'modified') modified += 1;
    else if (row.executionType === 'extra') extra += 1;
    else if (row.executionType === 'drop') drop += 1;
  }
  const planned = Number.isFinite(input.planned) ? Math.max(0, Math.round(input.planned)) : 0;
  const skipped = Number.isFinite(input.skipped) ? Math.max(0, Math.round(input.skipped)) : 0;
  const plannedPerformed = Math.max(0, performed - extra - drop);
  const status: AdherenceStatus =
    planned === 0
      ? performed > 0
        ? 'complete'
        : 'none'
      : skipped === 0 && plannedPerformed >= planned
        ? 'complete'
        : plannedPerformed === 0
          ? 'none'
          : 'partial';
  return { planned, plannedPerformed, skipped, modified, extra, drop, performed, status };
}
