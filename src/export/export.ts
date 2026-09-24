import { HistoryDetail } from '../data/history';

/**
 * Pure CSV/JSON export builders. No DB, no React, no filesystem.
 * Display units: kg (from grams), seconds (from ms). Raw integers preserved in JSON.
 * RFC 4180 CSV escaping; UTF-8 string output (caller encodes).
 */

export const CSV_HEADER = [
  'session_id',
  'routine_name',
  'started_at',
  'ended_at',
  'block_index',
  'block_name',
  'step_index',
  'exercise',
  'round',
  'set',
  'target_weight_kg',
  'target_reps_min',
  'target_reps_max',
  'target_duration_s',
  'target_rir',
  'tempo',
  'actual_weight_kg',
  'actual_reps',
  'actual_duration_s',
  'actual_rir',
] as const;

function escapeCsvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function kgOrNull(grams: number | null | undefined): string {
  if (grams === null || grams === undefined) return '';
  return String(Number((grams / 1000).toFixed(3)));
}

function secondsOrNull(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '';
  return String(Number((ms / 1000).toFixed(3)));
}

function tempoString(prescription: {
  tempo: { eccentricMs: number | null; pauseBottomMs: number | null; concentricMs: number | null; pauseTopMs: number | null };
}): string {
  const t = prescription.tempo;
  if (
    t.eccentricMs === null &&
    t.pauseBottomMs === null &&
    t.concentricMs === null &&
    t.pauseTopMs === null
  ) {
    return '';
  }
  const sec = (ms: number | null) => (ms === null ? '0' : String(Math.round(ms / 1000)));
  return `${sec(t.eccentricMs)}-${sec(t.pauseBottomMs)}-${sec(t.concentricMs)}-${sec(t.pauseTopMs)}`;
}

interface ExportRow {
  sessionId: string;
  routineName: string;
  startedAt: number;
  endedAt: number | null;
  blockIndex: number | null;
  blockName: string;
  stepIndex: number | null;
  exercise: string;
  round: number | null;
  set: number | null;
  targetWeightGrams: number | null;
  targetRepsMin: number | null;
  targetRepsMax: number | null;
  targetDurationMs: number | null;
  targetRir: number | null;
  tempo: string;
  actualWeightGrams: number | null;
  actualReps: number | null;
  actualDurationMs: number | null;
  actualRir: number | null;
}

function buildRows(details: HistoryDetail[]): ExportRow[] {
  const rows: ExportRow[] = [];
  for (const d of details) {
    for (const block of d.blocks) {
      for (const step of block.steps) {
        const defStep = d.definition.blocks[block.blockIndex]?.steps[step.stepIndex];
        const tempo = defStep ? tempoString(defStep.prescription) : '';
        if (step.logs.length === 0) {
          rows.push({
            sessionId: d.id,
            routineName: d.name,
            startedAt: d.startedAt,
            endedAt: d.endedAt,
            blockIndex: block.blockIndex,
            blockName: block.name,
            stepIndex: step.stepIndex,
            exercise: step.exerciseName,
            round: null,
            set: null,
            targetWeightGrams: step.targetWeightGrams,
            targetRepsMin: step.targetRepsMin,
            targetRepsMax: step.targetRepsMax,
            targetDurationMs: step.targetDurationMs,
            targetRir: step.targetRir,
            tempo,
            actualWeightGrams: null,
            actualReps: null,
            actualDurationMs: null,
            actualRir: null,
          });
          continue;
        }
        for (const log of step.logs) {
          rows.push({
            sessionId: d.id,
            routineName: d.name,
            startedAt: d.startedAt,
            endedAt: d.endedAt,
            blockIndex: block.blockIndex,
            blockName: block.name,
            stepIndex: step.stepIndex,
            exercise: step.exerciseName,
            round: log.round,
            set: log.setIndex,
            targetWeightGrams: step.targetWeightGrams,
            targetRepsMin: step.targetRepsMin,
            targetRepsMax: step.targetRepsMax,
            targetDurationMs: step.targetDurationMs,
            targetRir: step.targetRir,
            tempo,
            actualWeightGrams: log.weightGrams,
            actualReps: log.reps,
            actualDurationMs: log.durationMs,
            actualRir: log.rir,
          });
        }
      }
    }
    // Completed session with zero logged steps still appears (session-level row).
    if (d.blocks.every((b) => b.steps.every((s) => s.logs.length === 0)) && d.blocks.flatMap((b) => b.steps).length === 0) {
      rows.push({
        sessionId: d.id,
        routineName: d.name,
        startedAt: d.startedAt,
        endedAt: d.endedAt,
        blockIndex: null,
        blockName: '',
        stepIndex: null,
        exercise: '',
        round: null,
        set: null,
        targetWeightGrams: null,
        targetRepsMin: null,
        targetRepsMax: null,
        targetDurationMs: null,
        targetRir: null,
        tempo: '',
        actualWeightGrams: null,
        actualReps: null,
        actualDurationMs: null,
        actualRir: null,
      });
    }
  }
  return rows;
}

/** CSV with header. Empty history → header only (no fake rows). */
export function sessionsToCsv(details: HistoryDetail[]): string {
  const lines: string[] = [CSV_HEADER.join(',')];
  for (const r of buildRows(details)) {
    lines.push(
      [
        escapeCsvField(r.sessionId),
        escapeCsvField(r.routineName),
        escapeCsvField(r.startedAt),
        escapeCsvField(r.endedAt),
        escapeCsvField(r.blockIndex),
        escapeCsvField(r.blockName),
        escapeCsvField(r.stepIndex),
        escapeCsvField(r.exercise),
        escapeCsvField(r.round),
        escapeCsvField(r.set),
        escapeCsvField(kgOrNull(r.targetWeightGrams)),
        escapeCsvField(r.targetRepsMin),
        escapeCsvField(r.targetRepsMax),
        escapeCsvField(secondsOrNull(r.targetDurationMs)),
        escapeCsvField(r.targetRir),
        escapeCsvField(r.tempo),
        escapeCsvField(kgOrNull(r.actualWeightGrams)),
        escapeCsvField(r.actualReps),
        escapeCsvField(secondsOrNull(r.actualDurationMs)),
        escapeCsvField(r.actualRir),
      ].join(','),
    );
  }
  return lines.join('\r\n') + '\r\n';
}

/** Structured JSON preserving raw integer units + definition snapshot. */
export function sessionsToJson(details: HistoryDetail[], exportedAtIso?: string): string {
  return JSON.stringify(
    {
      format: 'apexfoss-export',
      formatVersion: 1,
      exportedAt: exportedAtIso ?? new Date().toISOString(),
      sessions: details.map((d) => ({
        id: d.id,
        name: d.name,
        startedAt: d.startedAt,
        endedAt: d.endedAt,
        durationMs: d.durationMs,
        status: d.status,
        totalCompletedSets: d.totalCompletedSets,
        definition: d.definition,
        blocks: d.blocks,
      })),
    },
    null,
    2,
  );
}
