import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import { schema } from './schema';
import { migrations } from './migrations';
import { modelClasses } from './models';
import { loadEquipmentItems, replaceEquipmentItems } from './equipment';

function makeDb(): Database {
  const adapter = new LokiJSAdapter({
    dbName: `apex-equipment-${Math.random().toString(36).slice(2)}`,
    schema,
    migrations,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
  });
  return new Database({ adapter, modelClasses: modelClasses as any });
}

describe('equipment inventory data layer (schema v4)', () => {
  it('loads an empty inventory on a fresh database', async () => {
    expect(await loadEquipmentItems(makeDb())).toEqual([]);
  });

  it('creates items with defaults and returns them in deterministic order', async () => {
    const db = makeDb();
    const saved = await replaceEquipmentItems(db, [
      { name: '  Plate 20kg  ', weightGrams: 20_000, quantity: 4 },
      { name: '', weightGrams: 1_250, quantity: 2, perSide: true },
    ]);
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({ name: 'Plate 20kg', weightGrams: 20_000, quantity: 4, perSide: false });
    expect(saved[0].id).toBeTruthy();
    expect(saved[1]).toMatchObject({ name: '1.25kg', weightGrams: 1_250, quantity: 2, perSide: true });
    expect(await loadEquipmentItems(db)).toEqual(saved);
  });

  it('replaces atomically: updates kept ids, creates new rows, deletes removed rows', async () => {
    const db = makeDb();
    const initial = await replaceEquipmentItems(db, [
      { name: 'Plate 25kg', weightGrams: 25_000, quantity: 2 },
      { name: 'Plate 5kg', weightGrams: 5_000, quantity: 4 },
    ]);
    const keep = initial[0];

    const next = await replaceEquipmentItems(db, [
      { id: keep.id, name: 'Plate 25kg', weightGrams: 25_000, quantity: 6 },
      { name: 'Collar 2.5kg', weightGrams: 2_500, quantity: 2 },
    ]);

    expect(next).toHaveLength(2);
    const updated = next.find((i) => i.id === keep.id);
    expect(updated).toMatchObject({ name: 'Plate 25kg', quantity: 6, weightGrams: 25_000 });
    expect(next.find((i) => i.name === 'Collar 2.5kg')).toMatchObject({ weightGrams: 2_500, quantity: 2 });
    expect(next.find((i) => i.name === 'Plate 5kg')).toBeUndefined();
    expect(await loadEquipmentItems(db)).toHaveLength(2);
  });

  it('drops invalid rows instead of throwing (weights > 0, quantities >= 1)', async () => {
    const db = makeDb();
    const saved = await replaceEquipmentItems(db, [
      { name: 'Zero', weightGrams: 0, quantity: 1 },
      { name: 'Negative', weightGrams: -1000, quantity: 1 },
      { name: 'No qty', weightGrams: 10_000, quantity: 0 },
      { name: 'Float weight', weightGrams: 1_250.4, quantity: 1.9 },
      { name: 'NaN', weightGrams: Number.NaN, quantity: Number.NaN },
    ]);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ name: 'Float weight', weightGrams: 1_250, quantity: 1 });
  });

  it('treats unknown ids as new rows (safe across device restores)', async () => {
    const db = makeDb();
    const saved = await replaceEquipmentItems(db, [
      { id: 'ghost-from-another-device', name: 'Plate 10kg', weightGrams: 10_000, quantity: 2 },
    ]);
    expect(saved).toHaveLength(1);
    expect(saved[0].id).not.toBe('ghost-from-another-device');
    expect(saved[0].name).toBe('Plate 10kg');
  });

  it('persists perSide as a boolean across save and load', async () => {
    const db = makeDb();
    const saved = await replaceEquipmentItems(db, [
      { name: 'Pair 2.5kg', weightGrams: 2_500, quantity: 2, perSide: true },
    ]);
    expect(saved[0].perSide).toBe(true);
    const reloaded = await loadEquipmentItems(db);
    expect(reloaded[0].perSide).toBe(true);
  });
});
