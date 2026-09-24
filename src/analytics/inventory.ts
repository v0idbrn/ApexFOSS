/**
 * Pure load inventory / plate calculator (Phase 2E).
 * Deterministic subset-sum with documented tie-breaking.
 * No React, no DB, no IO.
 */

export interface LoadItem {
  name: string;
  weightGrams: number;
  quantity: number;
  /** When true, each unit contributes 2×weightGrams (left+right pair). */
  perSide?: boolean;
}

export type InventoryStatus = 'exact' | 'closest' | 'impossible';

export interface InventoryAllocation {
  itemIndex: number;
  name: string;
  weightGrams: number;
  quantityUsed: number;
  contributionGrams: number;
}

export interface InventorySolveInput {
  targetGrams: number;
  items: LoadItem[];
  /** Bar / fixed base weight always present (default 0). */
  baseGrams?: number;
}

export interface InventorySolveResult {
  status: InventoryStatus;
  targetGrams: number;
  achievedGrams: number;
  differenceGrams: number;
  baseGrams: number;
  allocations: InventoryAllocation[];
}

function unitContribution(item: LoadItem): number {
  return item.perSide ? item.weightGrams * 2 : item.weightGrams;
}

/**
 * Solve for closest achievable load given base + item multiset.
 *
 * Algorithm: bounded knapsack DP over achievable sums (grams).
 * Search space covers base … base+maxItemTotal (full reachable set).
 *
 * Tie-breaking (documented, deterministic):
 * 1. Prefer exact match over non-exact.
 * 2. Among non-exact: prefer smaller absolute difference |achieved − target|.
 * 3. On equal |diff|: prefer achieved ≥ target (never under-load) over under-load.
 * 4. On equal achieved: prefer fewer total units used.
 * 5. On equal units: prefer allocations ordered by ascending item index.
 *
 * Status:
 * - exact: achieved === target
 * - closest: some achievable sum ≠ target (always at least base)
 * - impossible: no items and base < target (cannot attempt to reach target)
 */
export function solveLoadInventory(input: InventorySolveInput): InventorySolveResult {
  const baseGrams = Math.max(0, Math.round(input.baseGrams ?? 0));
  const targetGrams = Math.max(0, Math.round(input.targetGrams));
  const items = input.items.filter((it) => it.quantity > 0 && it.weightGrams > 0);

  if (items.length === 0) {
    const diff = baseGrams - targetGrams;
    return {
      status: baseGrams === targetGrams ? 'exact' : baseGrams > targetGrams ? 'closest' : 'impossible',
      targetGrams,
      achievedGrams: baseGrams,
      differenceGrams: diff,
      baseGrams,
      allocations: [],
    };
  }

  const unitContribs = items.map(unitContribution);
  const maxItemTotal = items.reduce((sum, it, i) => sum + unitContribs[i] * it.quantity, 0);
  const dpCap = baseGrams + maxItemTotal;
  const size = dpCap + 1;

  const reachable = new Uint8Array(size);
  const prevSum = new Int32Array(size).fill(-1);
  const prevItem = new Int32Array(size).fill(-1);
  const prevQty = new Int32Array(size).fill(0);

  reachable[baseGrams] = 1;
  prevSum[baseGrams] = -2; // root sentinel

  for (let i = 0; i < items.length; i++) {
    const unit = unitContribs[i];
    const maxQty = items[i].quantity;
    const snap = reachable.slice();
    for (let q = 1; q <= maxQty; q++) {
      const add = unit * q;
      for (let s = size - 1; s >= add; s--) {
        const from = s - add;
        if (!snap[from]) continue;
        if (reachable[s]) continue;
        reachable[s] = 1;
        prevSum[s] = from;
        prevItem[s] = i;
        prevQty[s] = q;
      }
    }
  }

  const unitsOf = (sum: number): number => {
    let s = sum;
    let units = 0;
    let guard = 0;
    while (prevSum[s] >= 0 && guard++ < 10_000) {
      units += prevQty[s];
      s = prevSum[s];
    }
    return units;
  };

  let best = baseGrams;
  let bestExact = baseGrams === targetGrams ? 0 : 1;
  let bestAbs = Math.abs(baseGrams - targetGrams);
  let bestUnder = baseGrams < targetGrams ? 1 : 0;
  let bestUnits = 0;

  for (let s = 0; s < size; s++) {
    if (!reachable[s]) continue;
    const exact = s === targetGrams ? 0 : 1;
    const absDiff = Math.abs(s - targetGrams);
    const under = s < targetGrams ? 1 : 0;
    const units = unitsOf(s);
    let better = false;
    if (exact < bestExact) better = true;
    else if (exact > bestExact) better = false;
    else if (absDiff < bestAbs) better = true;
    else if (absDiff > bestAbs) better = false;
    else if (under < bestUnder) better = true;
    else if (under > bestUnder) better = false;
    else if (units < bestUnits) better = true;
    if (better) {
      best = s;
      bestExact = exact;
      bestAbs = absDiff;
      bestUnder = under;
      bestUnits = units;
    }
  }

  const qtyByItem = new Array<number>(items.length).fill(0);
  let s = best;
  let guard = 0;
  while (prevSum[s] >= 0 && guard++ < 10_000) {
    const i = prevItem[s];
    const q = prevQty[s];
    if (i >= 0) qtyByItem[i] += q;
    s = prevSum[s];
  }

  const allocations: InventoryAllocation[] = [];
  for (let i = 0; i < items.length; i++) {
    if (qtyByItem[i] <= 0) continue;
    allocations.push({
      itemIndex: i,
      name: items[i].name,
      weightGrams: items[i].weightGrams,
      quantityUsed: qtyByItem[i],
      contributionGrams: unitContribs[i] * qtyByItem[i],
    });
  }

  const status: InventoryStatus = best === targetGrams ? 'exact' : 'closest';
  return {
    status,
    targetGrams,
    achievedGrams: best,
    differenceGrams: best - targetGrams,
    baseGrams,
    allocations,
  };
}

/** Convenience: format result lines for UI. */
export function inventorySummaryLines(result: InventorySolveResult): string[] {
  const lines: string[] = [];
  lines.push(`Target: ${result.targetGrams} g`);
  lines.push(`Achieved: ${result.achievedGrams} g`);
  lines.push(`Difference: ${result.differenceGrams} g`);
  if (result.baseGrams > 0) lines.push(`Base: ${result.baseGrams} g`);
  for (const a of result.allocations) {
    lines.push(`${a.quantityUsed}× ${a.name} (${a.contributionGrams} g)`);
  }
  return lines;
}
