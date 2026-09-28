/** Body metrics: pure trend math over normalized body-measurement entries. */

import { formatCm, formatKg } from '../utils/units';

export interface RawBodyRow {
  timestampMs: number;
  measurementType?: string | null;
  side?: string | null;
  value?: number | null;
  unit?: string | null;
  weightGrams?: number | null;
  waistMm?: number | null;
}

export interface BodyEntry {
  timestampMs: number;
  measurementType: string;
  side: string | null;
  value: number;
  unit: 'g' | 'mm';
  weightGrams: number | null;
  waistMm: number | null;
}

export interface BodyMeasurementDelta {
  unit: 'g' | 'mm';
  previousValue: number | null;
  valueDelta: number | null;
}

export interface BodySummary {
  /** Newest valid entry across all measurement identities. Null when there are none. */
  latest: BodyEntry | null;
  /** Newest entry for each measurement identity (`type` or `type:side`). */
  latestByIdentity: Record<string, BodyEntry>;
  /** Change from the previous same-identity entry, in canonical storage units. */
  deltas: Record<string, BodyMeasurementDelta>;
  entryCount: number;
}

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

export function bodyIdentity(measurementType: string, side: string | null): string {
  return side ? `${measurementType}:${side}` : measurementType;
}

/**
 * Normalize database/backward-compatible rows into canonical integer-unit entries.
 * New rows are used as written; legacy rows carrying only weight/waist values
 * are expanded into body_weight/waist measurements. Invalid rows are skipped.
 */
export function normalizeBodyEntries(rows: RawBodyRow[]): BodyEntry[] {
  const entries: BodyEntry[] = [];
  for (const row of rows) {
    if (!Number.isFinite(row.timestampMs) || row.timestampMs <= 0) continue;
    if (
      typeof row.measurementType === 'string' &&
      row.measurementType.length > 0 &&
      isPositiveInteger(row.value) &&
      (row.unit === 'g' || row.unit === 'mm')
    ) {
      entries.push({
        timestampMs: row.timestampMs,
        measurementType: row.measurementType,
        side: typeof row.side === 'string' && row.side.length > 0 ? row.side : null,
        value: row.value,
        unit: row.unit,
        weightGrams:
          row.measurementType === 'body_weight'
            ? row.value
            : isPositiveInteger(row.weightGrams)
              ? row.weightGrams
              : null,
        waistMm:
          row.measurementType === 'waist'
            ? row.value
            : isPositiveInteger(row.waistMm)
              ? row.waistMm
              : null,
      });
      continue;
    }
    if (isPositiveInteger(row.weightGrams)) {
      entries.push({
        timestampMs: row.timestampMs,
        measurementType: 'body_weight',
        side: null,
        value: row.weightGrams,
        unit: 'g',
        weightGrams: row.weightGrams,
        waistMm: null,
      });
    }
    if (isPositiveInteger(row.waistMm)) {
      entries.push({
        timestampMs: row.timestampMs,
        measurementType: 'waist',
        side: null,
        value: row.waistMm,
        unit: 'mm',
        weightGrams: null,
        waistMm: row.waistMm,
      });
    }
  }
  return entries;
}

export function summarizeBody(rows: RawBodyRow[] | BodyEntry[]): BodySummary {
  const entries = normalizeBodyEntries(rows);
  if (entries.length === 0) {
    return { latest: null, latestByIdentity: {}, deltas: {}, entryCount: 0 };
  }
  const sorted = entries.slice().sort((a, b) => b.timestampMs - a.timestampMs);
  const latest = sorted[0];
  const latestByIdentity: Record<string, BodyEntry> = {};
  for (const entry of sorted) {
    const identity = bodyIdentity(entry.measurementType, entry.side);
    latestByIdentity[identity] ??= entry;
  }
  const deltas: Record<string, BodyMeasurementDelta> = {};
  for (const identity of Object.keys(latestByIdentity)) {
    const identityEntries = sorted.filter(
      (entry) => bodyIdentity(entry.measurementType, entry.side) === identity,
    );
    const current = identityEntries[0];
    const previous = identityEntries[1] ?? null;
    deltas[identity] =
      previous == null
        ? { unit: current.unit, previousValue: null, valueDelta: null }
        : { unit: current.unit, previousValue: previous.value, valueDelta: current.value - previous.value };
  }
  return { latest, latestByIdentity, deltas, entryCount: entries.length };
}

export function formatBodyEntry(entry: Pick<BodyEntry, 'value' | 'unit'>): string {
  if (entry.unit === 'g') return `${formatKg(entry.value)} kg`;
  return `${formatCm(entry.value)} cm`;
}

export function formatBodyDelta(delta: BodyMeasurementDelta): string | null {
  if (delta.valueDelta == null || delta.valueDelta === 0) return null;
  const sign = delta.valueDelta >= 0 ? '+' : '-';
  const magnitude = Math.abs(delta.valueDelta);
  if (delta.unit === 'g') return `${sign}${formatKg(magnitude)} kg`;
  return `${sign}${formatCm(magnitude)} cm`;
}
