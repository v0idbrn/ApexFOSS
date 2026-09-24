import { solveLoadInventory, inventorySummaryLines, type LoadItem } from './inventory';

const items = (...list: Array<[name: string, weightGrams: number, quantity: number, perSide?: boolean]>): LoadItem[] =>
  list.map(([name, weightGrams, quantity, perSide]) => ({ name, weightGrams, quantity, perSide }));

describe('solveLoadInventory', () => {
  it('returns exact with no items when target equals base', () => {
    const r = solveLoadInventory({ targetGrams: 20_000, items: [], baseGrams: 20_000 });
    expect(r.status).toBe('exact');
    expect(r.achievedGrams).toBe(20_000);
    expect(r.allocations).toHaveLength(0);
  });

  it('returns impossible with no items when target exceeds base', () => {
    const r = solveLoadInventory({ targetGrams: 100_000, items: [], baseGrams: 20_000 });
    expect(r.status).toBe('impossible');
    expect(r.achievedGrams).toBe(20_000);
    expect(r.differenceGrams).toBe(-80_000);
  });

  it('returns closest when base exceeds target with no items', () => {
    const r = solveLoadInventory({ targetGrams: 10_000, items: [], baseGrams: 20_000 });
    expect(r.status).toBe('closest');
    expect(r.achievedGrams).toBe(20_000);
    expect(r.differenceGrams).toBe(10_000);
  });

  it('solves exact with single plate type', () => {
    const r = solveLoadInventory({
      targetGrams: 40_000,
      items: items(['20kg', 20_000, 2]),
      baseGrams: 0,
    });
    expect(r.status).toBe('exact');
    expect(r.achievedGrams).toBe(40_000);
    expect(r.allocations).toEqual([
      { itemIndex: 0, name: '20kg', weightGrams: 20_000, quantityUsed: 2, contributionGrams: 40_000 },
    ]);
  });

  it('solves exact with bar + plates', () => {
    const r = solveLoadInventory({
      targetGrams: 60_000,
      items: items(['20kg', 20_000, 4], ['10kg', 10_000, 2]),
      baseGrams: 20_000,
    });
    expect(r.status).toBe('exact');
    expect(r.achievedGrams).toBe(60_000);
    // Prefer fewer units: one 20kg + one 10kg = 30k + base 20k = 50k no;
    // Need 40k from plates: two 20kg (2 units) vs four 10kg (4 units) → two 20kg.
    expect(r.allocations).toEqual([
      { itemIndex: 0, name: '20kg', weightGrams: 20_000, quantityUsed: 2, contributionGrams: 40_000 },
    ]);
  });

  it('returns closest when exact unreachable', () => {
    const r = solveLoadInventory({
      targetGrams: 55_000,
      items: items(['20kg', 20_000, 3], ['10kg', 10_000, 1]),
      baseGrams: 20_000,
    });
    expect(r.status).toBe('closest');
    expect(r.achievedGrams).not.toBe(55_000);
    // Reachable: 20, 40, 30(base+10), 50, 60, 70, 80...
    // Closest to 55: 50 or 60, |diff| 5 both → prefer ≥ target → 60.
    expect(r.achievedGrams).toBe(60_000);
    expect(r.differenceGrams).toBe(5_000);
  });

  it('prefers fewer units on equal achieved', () => {
    const r = solveLoadInventory({
      targetGrams: 40_000,
      items: items(['20kg', 20_000, 4], ['10kg', 10_000, 4]),
      baseGrams: 0,
    });
    expect(r.status).toBe('exact');
    // Two 20kg (2 units) vs four 10kg (4 units)
    expect(r.allocations).toHaveLength(1);
    expect(r.allocations[0].name).toBe('20kg');
    expect(r.allocations[0].quantityUsed).toBe(2);
  });

  it('handles perSide items contributing double', () => {
    const r = solveLoadInventory({
      targetGrams: 40_000,
      items: items(['pair-10', 10_000, 2, true]),
      baseGrams: 0,
    });
    expect(r.status).toBe('exact');
    expect(r.achievedGrams).toBe(40_000);
    expect(r.allocations[0].contributionGrams).toBe(40_000);
    expect(r.allocations[0].quantityUsed).toBe(2);
  });

  it('ignores zero-quantity and zero-weight items', () => {
    const r = solveLoadInventory({
      targetGrams: 20_000,
      items: items(['empty', 20_000, 0], ['zero', 0, 5], ['ok', 20_000, 1]),
      baseGrams: 0,
    });
    expect(r.status).toBe('exact');
    expect(r.allocations).toHaveLength(1);
    expect(r.allocations[0].name).toBe('ok');
  });

  it('is deterministic across repeated calls', () => {
    const input = {
      targetGrams: 70_000,
      items: items(['25kg', 25_000, 4], ['20kg', 20_000, 4], ['10kg', 10_000, 4], ['5kg', 5_000, 4]),
      baseGrams: 20_000,
    };
    const a = solveLoadInventory(input);
    const b = solveLoadInventory(input);
    expect(a).toEqual(b);
  });

  it('prefers not to under-load when |diff| ties', () => {
    // target 30; reachable 20 and 40 both |diff|=10 → prefer 40
    const r = solveLoadInventory({
      targetGrams: 30_000,
      items: items(['20kg', 20_000, 1], ['40kg', 40_000, 1]),
      baseGrams: 0,
    });
    expect(r.status).toBe('closest');
    expect(r.achievedGrams).toBe(40_000);
  });

  it('handles large quantity without exceeding item stock', () => {
    const r = solveLoadInventory({
      targetGrams: 100_000,
      items: items(['1.25kg', 1250, 100]),
      baseGrams: 0,
    });
    expect(r.status).toBe('exact');
    expect(r.achievedGrams).toBe(100_000);
    expect(r.allocations[0].quantityUsed).toBe(80);
  });

  it('clamps negative target to zero', () => {
    const r = solveLoadInventory({ targetGrams: -5000, items: [], baseGrams: 0 });
    expect(r.targetGrams).toBe(0);
    expect(r.status).toBe('exact');
  });
});

describe('inventorySummaryLines', () => {
  it('includes target, achieved, difference, and allocations', () => {
    const r = solveLoadInventory({
      targetGrams: 40_000,
      items: items(['20kg', 20_000, 2]),
      baseGrams: 20_000,
    });
    const lines = inventorySummaryLines(r);
    expect(lines[0]).toContain('Target');
    expect(lines.some((l) => l.includes('20kg'))).toBe(true);
    expect(lines.some((l) => l.includes('Base'))).toBe(true);
  });
});
