/**
 * Pure Tempo Trainer — intra-set execution aid.
 * Separate from the workout engine: never advances steps, rounds, rests, or sessions.
 * Timing is timestamp-based (startedAt + phase offsets); UI derives remaining from Date.now().
 * Ephemeral: not persisted (process death cancels the aid; workout cursor is untouched).
 */

import type { TempoSpec } from '../types/engine';

export type TempoPhaseId = 'eccentric' | 'pauseBottom' | 'concentric' | 'pauseTop';

export interface TempoPhase {
  id: TempoPhaseId;
  /** Integer milliseconds; always > 0 in an active list. */
  durationMs: number;
}

export type TempoStatus = 'idle' | 'running' | 'completed';

export interface TempoRuntime {
  status: TempoStatus;
  /** Non-zero phases only, prescription order. Empty when idle. */
  phases: TempoPhase[];
  /** Index into phases while running; last phase when completed. */
  phaseIndex: number;
  startedAt: number;
  phaseStartsAt: number;
  phaseEndsAt: number;
  totalMs: number;
}

export type TempoEffect =
  | { kind: 'PHASE_START'; phase: TempoPhaseId }
  | { kind: 'TEMPO_COMPLETE' };

export interface TempoStepResult {
  runtime: TempoRuntime;
  effects: TempoEffect[];
}

const PHASE_ORDER: readonly TempoPhaseId[] = ['eccentric', 'pauseBottom', 'concentric', 'pauseTop'];

function safeMs(v: number | null | undefined): number {
  if (v === null || v === undefined || !Number.isFinite(v)) return 0;
  const n = Math.floor(v);
  if (n < 0) return 0;
  // Guard absurd values that would break safe integer arithmetic.
  if (n > Number.MAX_SAFE_INTEGER) return Number.MAX_SAFE_INTEGER;
  return n;
}

export interface NormalizedTempo {
  eccentricMs: number;
  pauseBottomMs: number;
  concentricMs: number;
  pauseTopMs: number;
}

/** Clamp prescription tempo to non-negative finite integers (ms). */
export function normalizeTempoSpec(tempo: TempoSpec): NormalizedTempo {
  return {
    eccentricMs: safeMs(tempo.eccentricMs),
    pauseBottomMs: safeMs(tempo.pauseBottomMs),
    concentricMs: safeMs(tempo.concentricMs),
    pauseTopMs: safeMs(tempo.pauseTopMs),
  };
}

/** Non-zero phases in execution order (zero-duration phases are skipped). */
export function activeTempoPhases(tempo: TempoSpec): TempoPhase[] {
  const n = normalizeTempoSpec(tempo);
  const map: Record<TempoPhaseId, number> = {
    eccentric: n.eccentricMs,
    pauseBottom: n.pauseBottomMs,
    concentric: n.concentricMs,
    pauseTop: n.pauseTopMs,
  };
  return PHASE_ORDER.filter((id) => map[id] > 0).map((id) => ({ id, durationMs: map[id] }));
}

/** True when at least one phase has duration > 0 (trainer can run). */
export function hasActiveTempo(tempo: TempoSpec): boolean {
  return activeTempoPhases(tempo).length > 0;
}

export function idleTempoRuntime(): TempoRuntime {
  return {
    status: 'idle',
    phases: [],
    phaseIndex: 0,
    startedAt: 0,
    phaseStartsAt: 0,
    phaseEndsAt: 0,
    totalMs: 0,
  };
}

/**
 * Start tempo from phase 1 at `now`.
 * All-zero / empty tempo → idle with no effects (no infinite loop).
 */
export function startTempo(tempo: TempoSpec, now: number): TempoStepResult {
  const phases = activeTempoPhases(tempo);
  if (phases.length === 0 || !Number.isFinite(now)) {
    return { runtime: idleTempoRuntime(), effects: [] };
  }
  const totalMs = phases.reduce((s, p) => s + p.durationMs, 0);
  const runtime: TempoRuntime = {
    status: 'running',
    phases,
    phaseIndex: 0,
    startedAt: now,
    phaseStartsAt: now,
    phaseEndsAt: now + phases[0].durationMs,
    totalMs,
  };
  return { runtime, effects: [{ kind: 'PHASE_START', phase: phases[0].id }] };
}

/**
 * Derive runtime at `now` from absolute timestamps (background/resume safe).
 * Boundary: now >= phaseEndsAt advances (exact end is deterministic).
 * Catch-up: may skip multiple phases when `now` is far past phaseEndsAt.
 */
export function sampleTempo(runtime: TempoRuntime, now: number): TempoRuntime {
  if (runtime.status !== 'running') return runtime;
  if (!Number.isFinite(now)) return runtime;
  if (now < runtime.phaseEndsAt) return runtime;

  const { phases, startedAt } = runtime;
  if (phases.length === 0) return idleTempoRuntime();

  const elapsed = now - startedAt;
  let acc = 0;
  for (let i = 0; i < phases.length; i++) {
    acc += phases[i].durationMs;
    if (elapsed < acc) {
      const phaseStartsAt = startedAt + (acc - phases[i].durationMs);
      const phaseEndsAt = startedAt + acc;
      if (i === runtime.phaseIndex && phaseStartsAt === runtime.phaseStartsAt && phaseEndsAt === runtime.phaseEndsAt) {
        return runtime;
      }
      return { ...runtime, phaseIndex: i, phaseStartsAt, phaseEndsAt };
    }
  }

  // Entire tempo expired (including exact total boundary).
  const totalEnd = startedAt + acc;
  return {
    ...runtime,
    status: 'completed',
    phaseIndex: phases.length - 1,
    phaseStartsAt: totalEnd - phases[phases.length - 1].durationMs,
    phaseEndsAt: totalEnd,
  };
}

/**
 * Advance runtime to `now` and emit effects for meaningful boundaries only.
 * Multi-phase catch-up emits a single terminal effect (landed PHASE_START or TEMPO_COMPLETE)
 * so haptics do not burst after resume.
 */
export function tickTempo(runtime: TempoRuntime, now: number): TempoStepResult {
  const next = sampleTempo(runtime, now);
  if (next.status === runtime.status && next.phaseIndex === runtime.phaseIndex) {
    return { runtime: next, effects: [] };
  }
  if (next.status === 'completed' && runtime.status !== 'completed') {
    return { runtime: next, effects: [{ kind: 'TEMPO_COMPLETE' }] };
  }
  if (next.status === 'running' && next.phaseIndex !== runtime.phaseIndex) {
    const phase = next.phases[next.phaseIndex];
    if (phase) {
      return { runtime: next, effects: [{ kind: 'PHASE_START', phase: phase.id }] };
    }
  }
  return { runtime: next, effects: [] };
}

/** Cancel: wipe runtime so no stale phase timestamps survive restart. */
export function cancelTempo(): TempoRuntime {
  return idleTempoRuntime();
}

/** Remaining ms in the current phase (0 when not running / past end). */
export function phaseRemainingMs(runtime: TempoRuntime, now: number): number {
  if (runtime.status !== 'running') return 0;
  return Math.max(0, runtime.phaseEndsAt - now);
}

/** Elapsed ms since tempo start, clamped to [0, totalMs]. */
export function tempoElapsedMs(runtime: TempoRuntime, now: number): number {
  if (runtime.status === 'idle') return 0;
  if (runtime.status === 'completed') return runtime.totalMs;
  return Math.min(runtime.totalMs, Math.max(0, now - runtime.startedAt));
}

/** Current phase id, or null when idle. */
export function currentTempoPhase(runtime: TempoRuntime): TempoPhaseId | null {
  if (runtime.status === 'idle' || runtime.phases.length === 0) return null;
  return runtime.phases[Math.min(runtime.phaseIndex, runtime.phases.length - 1)].id;
}

/** Display countdown: seconds with one decimal (e.g. "3.0"). Visual only. */
export function formatPhaseCountdown(msRemaining: number): string {
  const clamped = Math.max(0, msRemaining);
  const s = clamped / 1000;
  return s.toFixed(1);
}
