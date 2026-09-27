import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import { schema } from './schema';
import { migrations } from './migrations';
import { modelClasses } from './models';
import { makeDbActions } from './actions';

function makeDb(): Database {
  const adapter = new LokiJSAdapter({
    dbName: `apexfoss-body-test-${Math.random().toString(36).slice(2)}`,
    schema,
    migrations,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
  });
  return new Database({ adapter, modelClasses: modelClasses as any });
}

const T = 1_700_000_000_000;
const DAY = 86_400_000;

describe('body metric actions (Phase 4E)', () => {
  it('logs weight-only, waist-only and combined entries', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    await actions.logBodyMetrics({ measuredAt: T, weightGrams: 80_000 });
    await actions.logBodyMetrics({ measuredAt: T + DAY, waistMm: 840 });
    await actions.logBodyMetrics({ measuredAt: T + 2 * DAY, weightGrams: 79_500, waistMm: 835 });
    const rows = await actions.listBodyMetrics();
    expect(rows.map((r) => [r.measuredAt, r.weightGrams, r.waistMm])).toEqual([
      [T + 2 * DAY, 79_500, 835],
      [T + DAY, null, 840],
      [T, 80_000, null],
    ]);
  });

  it('rejects entries without any value', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    await expect(actions.logBodyMetrics({ measuredAt: T })).rejects.toThrow('weight or waist');
  });

  it('rejects non-integer or non-positive values', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    await expect(actions.logBodyMetrics({ measuredAt: T, weightGrams: 80.5 })).rejects.toThrow('grams');
    await expect(actions.logBodyMetrics({ measuredAt: T, waistMm: -3 })).rejects.toThrow('millimeters');
    await expect(actions.logBodyMetrics({ measuredAt: 0, weightGrams: 80_000 })).rejects.toThrow('timestamp');
  });

  it('deletes an entry', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    const id = await actions.logBodyMetrics({ measuredAt: T, weightGrams: 80_000 });
    await actions.deleteBodyMetric(id);
    expect(await actions.listBodyMetrics()).toEqual([]);
  });
});
