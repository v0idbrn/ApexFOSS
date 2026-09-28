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

describe('body metric actions (Phase 4E/5+)', () => {
  it('logs weight-only, waist-only and combined entries', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    await actions.logBodyMetrics({ measuredAt: T, measurementType: 'body_weight', value: 80000, unit: 'g' });
    await actions.logBodyMetrics({ measuredAt: T + DAY, measurementType: 'waist', value: 840, unit: 'mm' });
    await actions.logBodyMetrics({ measuredAt: T + 2 * DAY, measurementType: 'body_weight', value: 79500, unit: 'g' });
    const rows = await actions.listBodyMetrics();
    expect(rows.map((r) => [r.measuredAt, r.measurementType, r.value, r.unit])).toEqual([
      [T + 2 * DAY, 'body_weight', 79500, 'g'],
      [T + DAY, 'waist', 840, 'mm'],
      [T, 'body_weight', 80000, 'g'],
    ]);
  });

  it('rejects entries without any value', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    await expect(actions.logBodyMetrics({ measuredAt: T, measurementType: 'body_weight', value: 0, unit: 'g' })).rejects.toThrow('value must be a positive integer');
  });

  it('rejects non-integer or non-positive values', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    await expect(actions.logBodyMetrics({ measuredAt: T, measurementType: 'body_weight', value: 80.5, unit: 'g' })).rejects.toThrow('positive integer');
    await expect(actions.logBodyMetrics({ measuredAt: T, measurementType: 'waist', value: -3, unit: 'mm' })).rejects.toThrow('positive integer');
    await expect(actions.logBodyMetrics({ measuredAt: 0, measurementType: 'body_weight', value: 80000, unit: 'g' })).rejects.toThrow('timestamp');
  });

  it('requires side for bilateral measurements', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    await expect(actions.logBodyMetrics({ measuredAt: T, measurementType: 'upper_arm', value: 300, unit: 'mm' })).rejects.toThrow(
      'side must be left or right for bilateral measurements',
    );
  });

  it('deletes an entry', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    const id = await actions.logBodyMetrics({ measuredAt: T, measurementType: 'body_weight', value: 80000, unit: 'g' });
    await actions.deleteBodyMetric(id);
    expect(await actions.listBodyMetrics()).toEqual([]);
  });
});