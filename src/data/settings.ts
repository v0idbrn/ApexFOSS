import { Database, Q } from '@nozbe/watermelondb';

/**
 * App settings accessor (schema v6 `app_settings`).
 * Key/value rows for DEVICE preferences (locale today) — never training data.
 * Deliberately excluded from backup export/restore (see src/portability/*).
 *
 * Style mirrors src/data/equipment.ts: the caller passes the Database so
 * tests can drive a LokiJS instance instead of the app SQLite adapter.
 */

export async function getSetting(db: Database, key: string): Promise<string | null> {
  const rows = await db.get<any>('app_settings').query(Q.where('key', key)).fetch();
  if (rows.length === 0) return null;
  const value = rows[0].value;
  return value == null ? null : String(value);
}

/** Upsert: updates the row for `key` when present, creates it otherwise. */
export async function setSetting(db: Database, key: string, value: string): Promise<void> {
  await db.write(async () => {
    const rows = await db.get<any>('app_settings').query(Q.where('key', key)).fetch();
    const ts = Date.now();
    if (rows.length > 0) {
      await rows[0].update((rec: any) => {
        rec.value = value;
        rec.updatedAt = ts;
      });
    } else {
      await db.get<any>('app_settings').create((rec: any) => {
        rec.key = key;
        rec.value = value;
        rec.createdAt = ts;
        rec.updatedAt = ts;
      });
    }
  });
}
