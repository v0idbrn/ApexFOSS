import { Database, Q } from '@nozbe/watermelondb';
import { gramsToKg } from '../utils/units';

/**
 * Persistent gym equipment inventory (Phase 2J, schema v4).
 * Feeds the load-inventory solver (src/analytics/inventory.ts) with the
 * athlete's real plates/load pieces. Units: grams / integers, like everything else.
 */

export interface EquipmentItem {
  id: string;
  name: string;
  weightGrams: number;
  quantity: number;
  perSide: boolean;
}

export interface EquipmentItemInput {
  /** Existing row id to update; omit/unknown to create. */
  id?: string | null;
  name: string;
  weightGrams: number;
  quantity: number;
  perSide?: boolean;
}

interface NormalizedItem {
  name: string;
  weightGrams: number;
  quantity: number;
  perSide: boolean;
}

/**
 * Validation (documented): non-positive weights and quantities below 1 are
 * dropped, weight/quantity are rounded down to integers, names fall back to
 * the weight (`20kg`). replaceEquipmentItems never throws on bad rows —
 * the UI re-syncs from the returned list so drops are visible.
 */
function normalize(input: EquipmentItemInput): NormalizedItem | null {
  const weightGrams = Math.round(input.weightGrams);
  const quantity = Math.floor(input.quantity);
  if (!Number.isFinite(weightGrams) || weightGrams <= 0) return null;
  if (!Number.isFinite(quantity) || quantity < 1) return null;
  const trimmed = (input.name ?? '').trim();
  return {
    name: trimmed || `${gramsToKg(weightGrams)}kg`,
    weightGrams,
    quantity,
    perSide: input.perSide === true,
  };
}

function rowToItem(row: any): EquipmentItem {
  return {
    id: row.id,
    name: row.name,
    weightGrams: row.weightGrams,
    quantity: row.quantity,
    perSide: row.perSide === true || row.perSide === 1,
  };
}

/**
 * Strictly monotonic created_at for batch creates: two rows created in the
 * same millisecond would otherwise tie in loadEquipmentItems and fall back to
 * id order (random), breaking input-order determinism within one replace call.
 */
let lastCreatedAt = 0;
function nextCreatedAt(): number {
  const t = Date.now();
  lastCreatedAt = t > lastCreatedAt ? t : lastCreatedAt + 1;
  return lastCreatedAt;
}

export async function loadEquipmentItems(db: Database): Promise<EquipmentItem[]> {
  const rows = await db.get<any>('equipment_items').query(Q.sortBy('created_at', 'asc')).fetch();
  const byCreated = new Map(rows.map((r: any) => [r.id, r.createdAt as number]));
  return rows
    .map(rowToItem)
    .sort((a, b) => {
      // Stable order: creation time, then id (LokiJS/SQLite timestamp ties).
      const ca = byCreated.get(a.id) ?? 0;
      const cb = byCreated.get(b.id) ?? 0;
      return ca !== cb ? ca - cb : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}

/**
 * Full-replace write (single transaction): updates rows whose id is kept,
 * creates rows without a usable id, deletes rows absent from the input.
 * Returns the fresh persisted list in deterministic order.
 */
export async function replaceEquipmentItems(
  db: Database,
  items: EquipmentItemInput[],
): Promise<EquipmentItem[]> {
  const valid: { id: string | null; value: NormalizedItem }[] = [];
  for (const input of items) {
    const value = normalize(input);
    if (value) valid.push({ id: input.id ?? null, value });
  }

  await db.write(async () => {
    const existing = await db.get<any>('equipment_items').query().fetch();
    const existingById = new Map(existing.map((r: any) => [r.id as string, r]));
    const keepIds = new Set(valid.map((v) => v.id).filter((id): id is string => !!id && existingById.has(id)));

    for (const row of existing) {
      if (!keepIds.has(row.id)) await row.markAsDeleted();
    }

    for (const { id, value } of valid) {
      const row = id != null ? existingById.get(id) : undefined;
      if (row) {
        await row.update((rec: any) => {
          rec.name = value.name;
          rec.weightGrams = value.weightGrams;
          rec.quantity = value.quantity;
          rec.perSide = value.perSide ? 1 : 0;
          rec.updatedAt = Date.now();
        });
      } else {
        await db.get<any>('equipment_items').create((rec: any) => {
          rec.name = value.name;
          rec.weightGrams = value.weightGrams;
          rec.quantity = value.quantity;
          rec.perSide = value.perSide ? 1 : 0;
          rec.createdAt = nextCreatedAt();
          rec.updatedAt = Date.now();
        });
      }
    }
  });

  return loadEquipmentItems(db);
}
