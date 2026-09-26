import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import { schema } from './schema';
import { migrations } from './migrations';
import { modelClasses } from './models';
import { getSetting, setSetting } from './settings';

/**
 * app_settings (schema v6) — device-preference key/value rows.
 * Mirrors the equipment.ts test style: LokiJS adapter + registered models.
 */

function makeDb(): Database {
  const adapter = new LokiJSAdapter({
    dbName: `apex-settings-${Math.random().toString(36).slice(2)}`,
    schema,
    migrations,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
  });
  return new Database({ adapter, modelClasses: modelClasses as any });
}

describe('app_settings accessor (schema v6)', () => {
  it('returns null for a key that was never written', async () => {
    const db = makeDb();
    expect(await getSetting(db, 'locale')).toBeNull();
  });

  it('round-trips setSetting → getSetting and upserts on the second write', async () => {
    const db = makeDb();
    await setSetting(db, 'locale', 'es');
    expect(await getSetting(db, 'locale')).toBe('es');

    await setSetting(db, 'locale', 'en');
    expect(await getSetting(db, 'locale')).toBe('en');

    const rows = await db.get<any>('app_settings').query().fetch();
    expect(rows).toHaveLength(1); // upsert — one row per key
    expect(rows[0].key).toBe('locale');
  });
});
