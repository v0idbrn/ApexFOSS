import { summarizeBody, type BodyEntry } from './body';

const T = 1_700_000_000_000;
const DAY = 86_400_000;

describe('summarizeBody (Phase 4E, pure)', () => {
  it('returns an empty summary without entries', () => {
    expect(summarizeBody([])).toEqual({
      latest: null,
      weightDeltaGrams: null,
      waistDeltaMm: null,
      entryCount: 0,
    });
  });

  it('picks the most recent entry regardless of input order', () => {
    const entries: BodyEntry[] = [
      { timestampMs: T, weightGrams: 80_000, waistMm: 840 },
      { timestampMs: T + DAY, weightGrams: 79_000, waistMm: 830 },
    ];
    const s = summarizeBody(entries);
    expect(s.latest?.timestampMs).toBe(T + DAY);
    expect(s.entryCount).toBe(2);
  });

  it('computes deltas against the previous bearing entry', () => {
    const entries: BodyEntry[] = [
      { timestampMs: T, weightGrams: 80_000, waistMm: 840 },
      { timestampMs: T + DAY, weightGrams: null, waistMm: 835 }, // weight-only gap entry skipped
      { timestampMs: T + 2 * DAY, weightGrams: 79_000, waistMm: 830 },
    ];
    const s = summarizeBody(entries);
    expect(s.weightDeltaGrams).toBe(79_000 - 80_000);
    expect(s.waistDeltaMm).toBe(830 - 835);
  });

  it('yields null deltas on the first entry or for missing values', () => {
    const single = summarizeBody([{ timestampMs: T, weightGrams: 80_000, waistMm: null }]);
    expect(single.weightDeltaGrams).toBeNull();
    expect(single.waistDeltaMm).toBeNull();

    const noWeight = summarizeBody([
      { timestampMs: T, weightGrams: null, waistMm: 840 },
      { timestampMs: T + DAY, weightGrams: null, waistMm: 830 },
    ]);
    expect(noWeight.weightDeltaGrams).toBeNull();
    expect(noWeight.waistDeltaMm).toBe(-10);
  });
});
