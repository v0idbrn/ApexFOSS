import {
  median,
  computeBaseline,
  scoreReadiness,
  validateTapSession,
  TAP_TEST_DURATION_MS,
  MIN_BASELINE_SAMPLES,
  type ReadinessTest,
} from './readiness';

const test = (id: string, testedAt: number, tapCount: number, durationMs = TAP_TEST_DURATION_MS): ReadinessTest => ({
  id,
  testedAt,
  durationMs,
  tapCount,
});

describe('median', () => {
  it('returns middle of odd-length list', () => {
    expect(median([1, 3, 2])).toBe(2);
    expect(median([5, 1, 3])).toBe(3);
  });

  it('returns lower-middle of even-length list', () => {
    expect(median([1, 2, 3, 4])).toBe(2);
    expect(median([10, 20, 30, 40])).toBe(20);
  });

  it('throws on empty', () => {
    expect(() => median([])).toThrow();
  });
});

describe('computeBaseline', () => {
  it('returns null with fewer than MIN_BASELINE_SAMPLES', () => {
    const tests = [test('a', 1, 40), test('b', 2, 42)];
    expect(tests.length).toBeLessThan(MIN_BASELINE_SAMPLES);
    expect(computeBaseline(tests)).toBeNull();
  });

  it('computes median with exactly MIN_BASELINE_SAMPLES', () => {
    const tests = [test('a', 1, 40), test('b', 2, 42), test('c', 3, 44)];
    const b = computeBaseline(tests);
    expect(b).not.toBeNull();
    expect(b!.medianTapCount).toBe(42);
    expect(b!.sampleCount).toBe(3);
  });

  it('uses last BASELINE_WINDOW tests only', () => {
    const tests: ReadinessTest[] = [];
    for (let i = 0; i < 15; i++) {
      tests.push(test(`t${i}`, i, i < 5 ? 0 : 50));
    }
    const b = computeBaseline(tests);
    expect(b).not.toBeNull();
    // Last 10 are all 50 (indices 5..14)
    expect(b!.medianTapCount).toBe(50);
    expect(b!.sampleCount).toBe(10);
  });

  it('sorts by testedAt before windowing', () => {
    const tests = [
      test('c', 30, 44),
      test('a', 10, 40),
      test('b', 20, 42),
    ];
    const b = computeBaseline(tests);
    expect(b!.medianTapCount).toBe(42);
  });
});

describe('scoreReadiness', () => {
  const baseline = { medianTapCount: 40, sampleCount: 5 };

  it('returns null without baseline', () => {
    expect(scoreReadiness(40, null)).toBeNull();
  });

  it('returns null when baseline median is zero', () => {
    expect(scoreReadiness(40, { medianTapCount: 0, sampleCount: 3 })).toBeNull();
  });

  it('scores 100 at baseline', () => {
    const s = scoreReadiness(40, baseline);
    expect(s).not.toBeNull();
    expect(s!.score).toBe(100);
    expect(s!.deviationPct).toBe(0);
  });

  it('scores above 100 when above baseline', () => {
    const s = scoreReadivitySafe(44, baseline);
    expect(s.score).toBe(110);
    expect(s.deviationPct).toBe(10);
  });

  it('scores below 100 when below baseline', () => {
    const s = scoreReadivitySafe(36, baseline);
    expect(s.score).toBe(90);
    expect(s.deviationPct).toBe(-10);
  });

  it('clamps score to [0, 200]', () => {
    expect(scoreReadivitySafe(0, baseline).score).toBe(0);
    expect(scoreReadivitySafe(1000, baseline).score).toBe(200);
  });
});

// Helper to narrow null for readability in tests above.
function scoreReadivitySafe(taps: number, baseline: { medianTapCount: number; sampleCount: number }) {
  const s = scoreReadiness(taps, baseline);
  if (!s) throw new Error('expected score');
  return s;
}

describe('validateTapSession', () => {
  const now = 1_000_000;

  it('accepts valid session', () => {
    expect(validateTapSession(TAP_TEST_DURATION_MS, 40, now)).toBeNull();
  });

  it('rejects wrong duration', () => {
    expect(validateTapSession(5000, 40, now)).toBe('wrong_duration');
  });

  it('rejects non-positive duration', () => {
    expect(validateTapSession(0, 40, now)).toBe('invalid_duration');
  });

  it('rejects negative tap count', () => {
    expect(validateTapSession(TAP_TEST_DURATION_MS, -1, now)).toBe('invalid_tap_count');
  });

  it('rejects non-integer tap count', () => {
    expect(validateTapSession(TAP_TEST_DURATION_MS, 40.5, now)).toBe('invalid_tap_count');
  });

  it('rejects invalid timestamp', () => {
    expect(validateTapSession(TAP_TEST_DURATION_MS, 40, 0)).toBe('invalid_timestamp');
  });
});
