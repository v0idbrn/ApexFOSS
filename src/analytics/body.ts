/** Phase 4E body metrics: pure trend math over logged measurements. */

export interface BodyEntry {
  timestampMs: number;
  weightGrams: number | null;
  waistMm: number | null;
}

export interface BodySummary {
  /** Most recent entry, any timestamp order. Null when no entries exist. */
  latest: BodyEntry | null;
  /** latest weight minus the previous weight-bearing entry (grams). */
  weightDeltaGrams: number | null;
  /** latest waist minus the previous waist-bearing entry (millimeters). */
  waistDeltaMm: number | null;
  entryCount: number;
}

export function summarizeBody(entries: BodyEntry[]): BodySummary {
  if (entries.length === 0) return { latest: null, weightDeltaGrams: null, waistDeltaMm: null, entryCount: 0 };
  const sorted = entries.slice().sort((a, b) => b.timestampMs - a.timestampMs);
  const latest = sorted[0];
  let prevWeight: number | null = null;
  let prevWaist: number | null = null;
  for (const e of sorted.slice(1)) {
    if (prevWeight === null && e.weightGrams != null) prevWeight = e.weightGrams;
    if (prevWaist === null && e.waistMm != null) prevWaist = e.waistMm;
    if (prevWeight !== null && prevWaist !== null) break;
  }
  return {
    latest,
    weightDeltaGrams: latest.weightGrams != null && prevWeight != null ? latest.weightGrams - prevWeight : null,
    waistDeltaMm: latest.waistMm != null && prevWaist != null ? latest.waistMm - prevWaist : null,
    entryCount: entries.length,
  };
}
