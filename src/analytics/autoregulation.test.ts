import {
  recommendNextLoad,
  idleAutoregRuntime,
  DEFAULT_AUTOREG_CONFIG,
  type AutoregConfig,
} from './autoregulation';

const cfg = (partial: Partial<AutoregConfig> = {}): AutoregConfig => ({
  enabled: true,
  targetRir: 2,
  stepGrams: 2500,
  minWeightGrams: 20_000,
  maxWeightGrams: 200_000,
  ...partial,
});

describe('recommendNextLoad', () => {
  it('holds when disabled', () => {
    const r = recommendNextLoad(100_000, 0, cfg({ enabled: false }));
    expect(r.direction).toBe('hold');
    expect(r.deltaGrams).toBe(0);
    expect(r.reason).toBe('disabled');
    expect(r.recommendedWeightGrams).toBe(100_000);
  });

  it('holds when no target RIR', () => {
    const r = recommendNextLoad(100_000, 0, cfg({ targetRir: null }));
    expect(r.reason).toBe('no_target_rir');
    expect(r.deltaGrams).toBe(0);
  });

  it('holds when current weight missing', () => {
    const r = recommendNextLoad(null, 0, cfg());
    expect(r.reason).toBe('no_current_weight');
    expect(r.deltaGrams).toBe(0);
  });

  it('holds when actual RIR invalid', () => {
    const r = recommendNextLoad(100_000, null, cfg());
    expect(r.reason).toBe('invalid_actual_rir');
    expect(r.deltaGrams).toBe(0);
    expect(r.recommendedWeightGrams).toBe(100_000);
  });

  it('holds when actual equals target', () => {
    const r = recommendNextLoad(100_000, 2, cfg({ targetRir: 2 }));
    expect(r.direction).toBe('hold');
    expect(r.deltaGrams).toBe(0);
    expect(r.reason).toBe('at_target');
    expect(r.recommendedWeightGrams).toBe(100_000);
  });

  it('increases when actual RIR below target (harder than planned)', () => {
    const r = recommendNextLoad(100_000, 0, cfg({ targetRir: 2 }));
    expect(r.direction).toBe('increase');
    expect(r.deltaGrams).toBe(2500);
    expect(r.recommendedWeightGrams).toBe(102_500);
    expect(r.reason).toBe('below_target');
  });

  it('decreases when actual RIR above target (easier than planned)', () => {
    const r = recommendNextLoad(100_000, 4, cfg({ targetRir: 2 }));
    expect(r.direction).toBe('decrease');
    expect(r.deltaGrams).toBe(-2500);
    expect(r.recommendedWeightGrams).toBe(97_500);
    expect(r.reason).toBe('above_target');
  });

  it('clamps to min and reports clamped_min', () => {
    const r = recommendNextLoad(21_000, 5, cfg({ targetRir: 2, minWeightGrams: 20_000 }));
    expect(r.recommendedWeightGrams).toBe(20_000);
    expect(r.deltaGrams).toBe(-1000);
    expect(r.reason).toBe('clamped_min');
    expect(r.direction).toBe('decrease');
  });

  it('clamps to max and reports clamped_max', () => {
    const r = recommendNextLoad(198_000, 0, cfg({ targetRir: 2, maxWeightGrams: 200_000 }));
    expect(r.recommendedWeightGrams).toBe(200_000);
    expect(r.deltaGrams).toBe(2000);
    expect(r.reason).toBe('clamped_max');
    expect(r.direction).toBe('increase');
  });

  it('holds when already at min and would decrease further', () => {
    const r = recommendNextLoad(20_000, 5, cfg({ targetRir: 2, minWeightGrams: 20_000 }));
    expect(r.recommendedWeightGrams).toBe(20_000);
    expect(r.deltaGrams).toBe(0);
    expect(r.direction).toBe('hold');
    expect(r.reason).toBe('clamped_min');
  });

  it('holds when already at max and would increase further', () => {
    const r = recommendNextLoad(200_000, 0, cfg({ targetRir: 2, maxWeightGrams: 200_000 }));
    expect(r.recommendedWeightGrams).toBe(200_000);
    expect(r.deltaGrams).toBe(0);
    expect(r.direction).toBe('hold');
    expect(r.reason).toBe('clamped_max');
  });

  it('is deterministic for same inputs', () => {
    const a = recommendNextLoad(100_000, 1, cfg());
    const b = recommendNextLoad(100_000, 1, cfg());
    expect(a).toEqual(b);
  });

  it('uses custom stepGrams', () => {
    const r = recommendNextLoad(100_000, 0, cfg({ stepGrams: 5000 }));
    expect(r.deltaGrams).toBe(5000);
    expect(r.recommendedWeightGrams).toBe(105_000);
  });
});

describe('idleAutoregRuntime', () => {
  it('starts with null recommendation', () => {
    const rt = idleAutoregRuntime();
    expect(rt.lastRecommendation).toBeNull();
    expect(rt.config.enabled).toBe(DEFAULT_AUTOREG_CONFIG.enabled);
  });
});
