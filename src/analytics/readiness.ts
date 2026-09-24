/**
 * Readiness tap test — pure calculations (Phase 2E).
 * 10-second tap test; baseline = rolling median of previous N tests;
 * no score before minimum baseline samples.
 * No medical / CNS / injury language — neutral score + deviation only.
 * No React, no DB, no IO.
 */

export const TAP_TEST_DURATION_MS = 10_000;
export const MIN_BASELINE_SAMPLES = 3;
export const BASELINE_WINDOW = 10;

export interface ReadinessTest {
  id: string;
  testedAt: number;
  durationMs: number;
  tapCount: number;
}

export interface ReadinessBaseline {
  /** Rolling median tap count across last up-to-BASELINE_WINDOW prior tests. */
  medianTapCount: number;
  sampleCount: number;
}

export interface ReadinessScore {
  /** 0–100 scale: current taps relative to baseline median. 100 = at baseline. */
  score: number;
  /** signed deviation: (current − baseline) / baseline × 100, rounded. */
  deviationPct: number;
  baselineMedian: number;
  currentTapCount: number;
}

/** Median of integers (odd/even handled; even → lower-middle for determinism). */
export function median(values: number[]): number {
  if (values.length === 0) throw new Error('median: empty');
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return sorted[mid - 1];
}

/**
 * Compute baseline from prior tests (newest last by testedAt).
 * Uses last BASELINE_WINDOW tests; requires ≥ MIN_BASELINE_SAMPLES.
 * Returns null when insufficient history.
 */
export function computeBaseline(priorTests: ReadinessTest[]): ReadinessBaseline | null {
  if (priorTests.length < MIN_BASELINE_SAMPLES) return null;
  const sorted = priorTests.slice().sort((a, b) => a.testedAt - b.testedAt);
  const window = sorted.slice(-BASELINE_WINDOW);
  const counts = window.map((t) => t.tapCount);
  return { medianTapCount: median(counts), sampleCount: window.length };
}

/**
 * Score current test against baseline.
 * Returns null when baseline is null (insufficient history).
 * Score = round(100 × current / baseline), clamped to [0, 200] to avoid absurd outliers.
 * Deviation = round(100 × (current − baseline) / baseline).
 */
export function scoreReadiness(currentTapCount: number, baseline: ReadinessBaseline | null): ReadinessScore | null {
  if (!baseline || baseline.medianTapCount <= 0) return null;
  const raw = (100 * currentTapCount) / baseline.medianTapCount;
  const score = Math.max(0, Math.min(200, Math.round(raw)));
  const deviationPct = Math.round((100 * (currentTapCount - baseline.medianTapCount)) / baseline.medianTapCount);
  return { score, deviationPct, baselineMedian: baseline.medianTapCount, currentTapCount };
}

/** Validate a completed tap session before persisting. */
export function validateTapSession(durationMs: number, tapCount: number, now: number): string | null {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 'invalid_duration';
  if (Math.abs(durationMs - TAP_TEST_DURATION_MS) > 50) return 'wrong_duration';
  if (!Number.isFinite(tapCount) || tapCount < 0 || !Number.isInteger(tapCount)) return 'invalid_tap_count';
  if (!Number.isFinite(now) || now <= 0) return 'invalid_timestamp';
  return null;
}
