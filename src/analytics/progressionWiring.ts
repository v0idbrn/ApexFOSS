import type { AnalyticsSnapshot } from '../data/analytics';
import type { SessionExercisePrescription } from './progression';
import { solveLoadInventory, type LoadItem } from './inventory';

/**
 * Phase 3B wiring — pure transformation between the data layer and the
 * deterministic progression engine. No DB access, no UI, no IO.
 *
 * Flow (architecture invariant):
 *   stored history + equipment inventory
 *   → data transformation (here + src/data/progression.ts)
 *   → AnalyzeProgressionInput
 *   → analyzeProgression() (Phase 3A engine)
 *   → ProgressionEvidence
 *   → UI
 */

/**
 * Resolve the next achievable total load STRICTLY from the athlete's real
 * equipment inventory (schema v4 rows mapped to solver items).
 *
 * Semantics (documented in docs/PROGRESSION_ENGINE.md):
 *  - items are the athlete's own load pieces: barbell plates as per-side
 *    pairs, bars/dumbbells/kettlebells/machine stacks as fixed pieces;
 *  - `solveLoadInventory` resolves FOR a target (an exact target returns the
 *    target itself), so "next load above the target" needs two probes:
 *      1. solve(target): an achieved load ABOVE the target wins directly
 *         (the solver's tie-break prefers never under-loading);
 *      2. otherwise the target is exactly reachable → solve(target + minUnit)
 *         where minUnit is the smallest single piece contribution; an
 *         achieved load above the target is the next step up.
 *  - for barbell work the athlete registers the bar as a fixed item so
 *    totals match; a plates-only inventory cannot exceed a barbell target
 *    and yields no suggestion (conservative, never invented);
 *  - no inventory / invalid target / nothing reachable above the target
 *    → undefined: the progression opportunity stands, the UI shows no weight.
 *  - Known conservative limitation: with very sparse, irregular inventories a
 *    far-above reachable load may be skipped rather than mis-suggested.
 */
export function resolveAchievableNextWeightGrams(
  items: readonly LoadItem[],
  targetWeightGrams: number | null | undefined,
): number | undefined {
  if (targetWeightGrams == null || !Number.isFinite(targetWeightGrams) || targetWeightGrams <= 0) {
    return undefined;
  }
  const usable = items.filter((it) => Number.isFinite(it.weightGrams) && it.weightGrams > 0 && it.quantity > 0);
  if (usable.length === 0) return undefined;
  const target = Math.round(targetWeightGrams);

  const direct = solveLoadInventory({ targetGrams: target, baseGrams: 0, items: [...usable] });
  if (direct.achievedGrams > target) return direct.achievedGrams;

  const minUnit = Math.min(
    ...usable.map((it) => (it.perSide ? it.weightGrams * 2 : it.weightGrams)),
  );
  const next = solveLoadInventory({ targetGrams: target + minUnit, baseGrams: 0, items: [...usable] });
  return next.achievedGrams > target ? next.achievedGrams : undefined;
}

/**
 * Pick the most recent recorded prescription for an exercise from the
 * per-session prescription context (definition_json snapshots). This is the
 * honest "current prescription" for surfaces that are not inside a live
 * routine: the last prescription the athlete actually trained.
 * Identity mirrors the engine (ID-first): entries whose exerciseId matches
 * win; exact-name entries are the fallback when no ID-matched entry exists.
 */
export function latestPrescriptionFor(
  historicalPrescriptions: ReadonlyMap<string, SessionExercisePrescription>,
  sessionTimestamps: ReadonlyMap<string, number>,
  exerciseName: string,
  exerciseId?: string | null,
): SessionExercisePrescription | null {
  let bestId: { presc: SessionExercisePrescription; ts: number } | null = null;
  let bestName: { presc: SessionExercisePrescription; ts: number } | null = null;
  for (const [key, presc] of historicalPrescriptions) {
    if (presc.exerciseName !== exerciseName) continue;
    const sessionId = key.slice(0, key.indexOf('|'));
    const ts = sessionTimestamps.get(sessionId) ?? 0;
    if (exerciseId != null && presc.exerciseId === exerciseId) {
      if (bestId === null || ts > bestId.ts) bestId = { presc, ts };
    } else if (presc.exerciseId == null) {
      // Only trust name-keyed entries without an ID — a same-named entry with a
      // DIFFERENT valid id is a different exercise (never a fallback match).
      if (bestName === null || ts > bestName.ts) bestName = { presc, ts };
    }
  }
  return bestId?.presc ?? bestName?.presc ?? null;
}

/** Session id → completion timestamp lookup for prescription ordering. */
export function sessionTimestampsOf(snapshot: AnalyticsSnapshot): Map<string, number> {
  return new Map(snapshot.sessions.map((s) => [s.sessionId, s.timestampMs]));
}
