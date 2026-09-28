import {
  bodyIdentity,
  formatBodyDelta,
  formatBodyEntry,
  normalizeBodyEntries,
  summarizeBody,
  type BodyEntry,
} from './body';

const T = 1_700_000_000_000;
const DAY = 86_400_000;

function weightEntry(overrides: Partial<BodyEntry> = {}): BodyEntry {
  return {
    timestampMs: T,
    measurementType: 'body_weight',
    side: null,
    value: 80_000,
    unit: 'g',
    weightGrams: 80_000,
    waistMm: null,
    ...overrides,
  };
}

describe('normalizeBodyEntries', () => {
  it('keeps canonical entries and expands legacy weight/waist rows', () => {
    expect(
      normalizeBodyEntries([
        {
          timestampMs: T,
          measurementType: 'neck',
          side: null,
          value: 380,
          unit: 'mm',
          weightGrams: null,
          waistMm: null,
        },
        { timestampMs: T, weightGrams: 80_000, waistMm: 840 },
      ]),
    ).toEqual([
      {
        timestampMs: T,
        measurementType: 'neck',
        side: null,
        value: 380,
        unit: 'mm',
        weightGrams: null,
        waistMm: null,
      },
      {
        timestampMs: T,
        measurementType: 'body_weight',
        side: null,
        value: 80_000,
        unit: 'g',
        weightGrams: 80_000,
        waistMm: null,
      },
      {
        timestampMs: T,
        measurementType: 'waist',
        side: null,
        value: 840,
        unit: 'mm',
        weightGrams: null,
        waistMm: 840,
      },
    ]);
  });

  it('skips invalid rows without mutating the input', () => {
    const rows = [
      { timestampMs: 0, measurementType: 'body_weight', side: null, value: 80_000, unit: 'g' },
      { timestampMs: T, measurementType: 'waist', side: null, value: -5, unit: 'mm' },
    ];
    const snapshot = JSON.parse(JSON.stringify(rows));
    expect(normalizeBodyEntries(rows)).toEqual([]);
    expect(rows).toEqual(snapshot);
  });
});

describe('summarizeBody', () => {
  it('returns an empty summary without entries', () => {
    expect(summarizeBody([])).toEqual({ latest: null, latestByIdentity: {}, deltas: {}, entryCount: 0 });
  });

  it('tracks each measurement identity separately, including sides', () => {
    const summary = summarizeBody([
      weightEntry({ timestampMs: T, value: 80_000, weightGrams: 80_000 }),
      weightEntry({
        timestampMs: T + DAY,
        measurementType: 'upper_arm',
        side: 'left',
        value: 310,
        unit: 'mm',
        weightGrams: null,
      }),
      weightEntry({
        timestampMs: T + DAY,
        measurementType: 'upper_arm',
        side: 'right',
        value: 305,
        unit: 'mm',
        weightGrams: null,
      }),
    ]);
    expect(summary.entryCount).toBe(3);
    expect(summary.latestByIdentity['body_weight']?.value).toBe(80_000);
    expect(summary.latestByIdentity['upper_arm:left']?.value).toBe(310);
    expect(summary.latestByIdentity['upper_arm:right']?.value).toBe(305);
    expect(summary.deltas['upper_arm:left']).toEqual({ unit: 'mm', previousValue: null, valueDelta: null });
  });

  it('computes same-identity deltas in canonical units', () => {
    const summary = summarizeBody([
      weightEntry({ timestampMs: T, value: 80_000, weightGrams: 80_000 }),
      weightEntry({ timestampMs: T + DAY, value: 79_500, weightGrams: 79_500 }),
      weightEntry({
        timestampMs: T,
        measurementType: 'waist',
        value: 840,
        unit: 'mm',
        weightGrams: null,
        waistMm: 840,
      }),
      weightEntry({
        timestampMs: T + DAY,
        measurementType: 'waist',
        value: 835,
        unit: 'mm',
        weightGrams: null,
        waistMm: 835,
      }),
    ]);
    expect(summary.deltas['body_weight']).toEqual({ unit: 'g', previousValue: 80_000, valueDelta: -500 });
    expect(summary.deltas['waist']).toEqual({ unit: 'mm', previousValue: 840, valueDelta: -5 });
    expect(bodyIdentity('upper_arm', 'left')).toBe('upper_arm:left');
    expect(formatBodyEntry({ value: 79_500, unit: 'g' })).toBe('79.5 kg');
    expect(formatBodyDelta({ unit: 'mm', previousValue: 840, valueDelta: -5 })).toBe('-0.5 cm');
    expect(formatBodyDelta({ unit: 'g', previousValue: 1, valueDelta: 0 })).toBeNull();
  });
});
