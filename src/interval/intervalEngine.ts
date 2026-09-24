/**
 * Pure Interval Engine — EMOM / HIIT / glycolytic-style work-rest protocols.
 * Separate from the workout engine (never advances blocks/steps/session) and
 * from the tempo trainer (intra-set aid). Timestamp-based; UI derives remaining.
 * Ephemeral runtime is optional-persisted on ExecutionCursor.interval for recovery.
 */

export type IntervalMode = 'hiit' | 'emom' | 'glycolytic';
export type IntervalPhaseId = 'prep' | 'work' | 'rest';
export type IntervalStatus = 'idle' | 'running' | 'completed';

/** Declarative protocol. Integer milliseconds only. */
export interface IntervalConfig {
  mode: IntervalMode;
  /** Work phase duration. For EMOM: work window inside periodMs (0 → full period). */
  workMs: number;
  /** Recovery between rounds (HIIT/glycolytic). EMOM derives from period − work. */
  restMs: number;
  /** Protocol rounds (≥ 1). Not the workout block.rounds field. */
  rounds: number;
  /** EMOM fixed round window. Required for emom; null otherwise. */
  periodMs: number | null;
  /** Optional countdown before first work. 0 = none. */
  preparationMs: number;
}

export interface NormalizedIntervalConfig {
  mode: IntervalMode;
  workMs: number;
  restMs: number;
  rounds: number;
  periodMs: number | null;
  preparationMs: number;
  /** EMOM only: effective work inside the period (workMs clamped/normalized). */
  emomWorkMs: number;
  /** EMOM only: wait inside period after work (period − emomWorkMs). */
  emomRestMs: number;
  totalMs: number;
}

/**
 * Active interval runtime. Only `running` is meaningfully persisted;
 * completed/idle clear the cursor field.
 */
export interface IntervalRuntime {
  status: IntervalStatus;
  config: NormalizedIntervalConfig | null;
  /** Absolute protocol anchor (prep+rounds measured from here for linear; round 1 work from here after prep). */
  startedAt: number;
  /** 1-based current round (1 during prep). */
  round: number;
  phase: IntervalPhaseId | null;
  phaseStartsAt: number;
  phaseEndsAt: number;
  /**
   * EMOM: athlete marked current-round work complete before workMs elapsed.
   * Cleared automatically when the fixed clock advances into the next round.
   */
  workDoneEarly: boolean;
}

export type IntervalEffect =
  | { kind: 'PHASE_START'; phase: IntervalPhaseId; round: number }
  | { kind: 'ROUND_START'; round: number }
  | { kind: 'INTERVAL_COMPLETE' };

export interface IntervalStepResult {
  runtime: IntervalRuntime;
  effects: IntervalEffect[];
}

const MAX_MS = Number.MAX_SAFE_INTEGER;
const MAX_ROUNDS = 10_000;

function safeInt(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  const n = Math.trunc(v);
  if (n < 0) return 0;
  if (n > MAX_MS) return MAX_MS;
  return n;
}

export function idleIntervalRuntime(): IntervalRuntime {
  return {
    status: 'idle',
    config: null,
    startedAt: 0,
    round: 1,
    phase: null,
    phaseStartsAt: 0,
    phaseEndsAt: 0,
    workDoneEarly: false,
  };
}

export type IntervalValidation =
  | { ok: true; config: NormalizedIntervalConfig }
  | { ok: false; reason: string };

/**
 * Validate + normalize a raw definition.
 * Rejects zero/negative rounds, non-positive work (after EMOM normalize),
 * missing/invalid EMOM period, non-finite input, and absurd magnitudes.
 */
export function validateIntervalConfig(raw: IntervalConfig | null | undefined): IntervalValidation {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'missing' };
  }
  const mode = raw.mode;
  if (mode !== 'hiit' && mode !== 'emom' && mode !== 'glycolytic') {
    return { ok: false, reason: 'invalid_mode' };
  }

  const rounds = safeInt(raw.rounds);
  if (rounds < 1 || rounds > MAX_ROUNDS) {
    return { ok: false, reason: 'invalid_rounds' };
  }

  const preparationMs = safeInt(raw.preparationMs);
  let workMs = safeInt(raw.workMs);
  let restMs = safeInt(raw.restMs);
  let periodMs: number | null = null;

  if (mode === 'emom') {
    periodMs = safeInt(raw.periodMs);
    if (periodMs < 1) {
      return { ok: false, reason: 'invalid_period' };
    }
    // workMs 0 → athlete works the full minute window.
    if (workMs === 0) workMs = periodMs;
    if (workMs > periodMs) {
      return { ok: false, reason: 'work_exceeds_period' };
    }
    restMs = periodMs - workMs;
  } else {
    if (workMs < 1) {
      return { ok: false, reason: 'invalid_work' };
    }
    // restMs may be 0 (immediate next work) — still deterministic.
    periodMs = null;
  }

  // Overflow guard on total timeline length.
  const linearTotal =
    preparationMs +
    rounds * workMs +
    (mode === 'emom' ? rounds * periodMs! : Math.max(0, rounds - 1) * restMs);
  if (linearTotal > MAX_MS || !Number.isFinite(linearTotal)) {
    return { ok: false, reason: 'duration_overflow' };
  }

  const emomWorkMs = mode === 'emom' ? workMs : 0;
  const emomRestMs = mode === 'emom' ? restMs : 0;
  const totalMs =
    mode === 'emom'
      ? preparationMs + rounds * periodMs!
      : preparationMs + rounds * workMs + Math.max(0, rounds - 1) * restMs;

  return {
    ok: true,
    config: {
      mode,
      workMs,
      restMs,
      rounds,
      periodMs,
      preparationMs,
      emomWorkMs,
      emomRestMs,
      totalMs,
    },
  };
}

/** True when the definition can start (validation passes). */
export function hasActiveInterval(raw: IntervalConfig | null | undefined): boolean {
  return validateIntervalConfig(raw).ok;
}

/** Linear phase timeline offsets from protocolStartedAt (prep included). */
interface LinearPhase {
  phase: IntervalPhaseId;
  round: number;
  startOffset: number;
  durationMs: number;
}

function linearPhases(cfg: NormalizedIntervalConfig): LinearPhase[] {
  const out: LinearPhase[] = [];
  let t = 0;
  if (cfg.preparationMs > 0) {
    out.push({ phase: 'prep', round: 1, startOffset: 0, durationMs: cfg.preparationMs });
    t = cfg.preparationMs;
  }
  for (let r = 1; r <= cfg.rounds; r++) {
    out.push({ phase: 'work', round: r, startOffset: t, durationMs: cfg.workMs });
    t += cfg.workMs;
    if (r < cfg.rounds && cfg.restMs > 0) {
      out.push({ phase: 'rest', round: r, startOffset: t, durationMs: cfg.restMs });
      t += cfg.restMs;
    } else if (r < cfg.rounds) {
      // restMs = 0 → no rest phase; next work starts immediately.
    }
  }
  return out;
}

/**
 * EMOM position from fixed clock.
 * Round n window: [startedAt + prep + (n-1)*period, + period).
 * Within window: work [0, emomWorkMs), then rest until period end.
 */
function emomAt(
  cfg: NormalizedIntervalConfig,
  startedAt: number,
  now: number,
  workDoneEarlyRound: number | null,
): {
  status: 'running' | 'completed';
  round: number;
  phase: IntervalPhaseId;
  phaseStartsAt: number;
  phaseEndsAt: number;
  workDoneEarly: boolean;
} {
  const prepEnd = startedAt + cfg.preparationMs;
  const protocolEnd = prepEnd + cfg.rounds * cfg.periodMs!;

  if (now >= protocolEnd) {
    return {
      status: 'completed',
      round: cfg.rounds,
      phase: 'rest',
      phaseStartsAt: protocolEnd,
      phaseEndsAt: protocolEnd,
      workDoneEarly: false,
    };
  }

  if (cfg.preparationMs > 0 && now < prepEnd) {
    return {
      status: 'running',
      round: 1,
      phase: 'prep',
      phaseStartsAt: startedAt,
      phaseEndsAt: prepEnd,
      workDoneEarly: false,
    };
  }

  const elapsed = now - prepEnd;
  const roundIdx = Math.min(cfg.rounds - 1, Math.floor(elapsed / cfg.periodMs!)); // 0-based
  const round = roundIdx + 1;
  const roundStart = prepEnd + roundIdx * cfg.periodMs!;
  const roundEnd = roundStart + cfg.periodMs!;
  const inRound = now - roundStart;

  const early = workDoneEarlyRound === round;
  const inWork = inRound < cfg.emomWorkMs && !early;

  if (inWork) {
    return {
      status: 'running',
      round,
      phase: 'work',
      phaseStartsAt: roundStart,
      phaseEndsAt: roundStart + cfg.emomWorkMs,
      workDoneEarly: false,
    };
  }

  // Waiting out the remainder of the minute (or open work already marked done).
  return {
    status: 'running',
    round,
    phase: 'rest',
    phaseStartsAt: early ? now : roundStart + cfg.emomWorkMs,
    phaseEndsAt: roundEnd,
    workDoneEarly: early || cfg.emomRestMs === 0 ? early : false,
  };
}

/**
 * Derive runtime at `now` from absolute timestamps (background/resume safe).
 * Boundary: now >= phaseEndsAt advances. Multi-boundary catch-up lands on final state.
 */
export function sampleInterval(runtime: IntervalRuntime, now: number): IntervalRuntime {
  if (runtime.status !== 'running' || !runtime.config) return runtime;
  if (!Number.isFinite(now)) return runtime;
  const cfg = runtime.config;

  if (cfg.mode === 'emom') {
    const earlyRound = runtime.workDoneEarly ? runtime.round : null;
    const pos = emomAt(cfg, runtime.startedAt, now, earlyRound);
    // Crossing into a new round clears workDoneEarly (handled inside emomAt via round match).
    const next: IntervalRuntime = {
      ...runtime,
      status: pos.status,
      round: pos.round,
      phase: pos.phase,
      phaseStartsAt: pos.phaseStartsAt,
      phaseEndsAt: pos.phaseEndsAt,
      workDoneEarly: pos.workDoneEarly,
    };
    return next;
  }

  // Linear (HIIT / glycolytic)
  const phases = linearPhases(cfg);
  if (phases.length === 0) return { ...idleIntervalRuntime(), status: 'completed' };
  const total = cfg.totalMs;
  if (now - runtime.startedAt >= total) {
    const last = phases[phases.length - 1];
    return {
      ...runtime,
      status: 'completed',
      round: cfg.rounds,
      phase: last.phase,
      phaseStartsAt: runtime.startedAt + last.startOffset,
      phaseEndsAt: runtime.startedAt + last.startOffset + last.durationMs,
      workDoneEarly: false,
    };
  }

  const elapsed = now - runtime.startedAt;
  // Find last phase with startOffset <= elapsed
  let cur = phases[0];
  for (const p of phases) {
    if (elapsed >= p.startOffset) cur = p;
    else break;
  }
  const phaseStartsAt = runtime.startedAt + cur.startOffset;
  const phaseEndsAt = phaseStartsAt + cur.durationMs;
  if (
    runtime.phase === cur.phase &&
    runtime.round === cur.round &&
    runtime.phaseStartsAt === phaseStartsAt &&
    runtime.phaseEndsAt === phaseEndsAt
  ) {
    return runtime;
  }
  return {
    ...runtime,
    status: 'running',
    round: cur.round,
    phase: cur.phase,
    phaseStartsAt,
    phaseEndsAt,
    workDoneEarly: false,
  };
}

function effectsForTransition(prev: IntervalRuntime, next: IntervalRuntime): IntervalEffect[] {
  if (next.status === 'completed' && prev.status !== 'completed') {
    return [{ kind: 'INTERVAL_COMPLETE' }];
  }
  if (next.status !== 'running' || prev.status !== 'running') return [];
  const effects: IntervalEffect[] = [];
  if (next.round !== prev.round) {
    effects.push({ kind: 'ROUND_START', round: next.round });
  }
  if (next.phase !== prev.phase || next.round !== prev.round) {
    if (next.phase) {
      effects.push({ kind: 'PHASE_START', phase: next.phase, round: next.round });
    }
  }
  return effects;
}

/**
 * Advance to `now`, emitting effects only for meaningful boundaries.
 * Multi-phase catch-up emits the landed transition (or single COMPLETE) — no haptic burst.
 */
export function tickInterval(runtime: IntervalRuntime, now: number): IntervalStepResult {
  const next = sampleInterval(runtime, now);
  if (next === runtime) return { runtime, effects: [] };
  return { runtime: next, effects: effectsForTransition(runtime, next) };
}

/**
 * Start protocol at `now`. Invalid/all-zero → idle, no effects (no infinite loop).
 */
export function startInterval(raw: IntervalConfig, now: number): IntervalStepResult {
  const v = validateIntervalConfig(raw);
  if (!v.ok || !Number.isFinite(now)) {
    return { runtime: idleIntervalRuntime(), effects: [] };
  }
  const cfg = v.config;
  const runtime: IntervalRuntime = {
    status: 'running',
    config: cfg,
    startedAt: now,
    round: 1,
    phase: null,
    phaseStartsAt: now,
    phaseEndsAt: now,
    workDoneEarly: false,
  };
  const sampled = sampleInterval(runtime, now);
  return {
    runtime: sampled,
    effects: [{ kind: 'PHASE_START', phase: sampled.phase ?? 'work', round: sampled.round }],
  };
}

/** Cancel: wipe runtime (stale timestamps never survive). */
export function cancelInterval(): IntervalRuntime {
  return idleIntervalRuntime();
}

/**
 * Athlete marked current-round work complete early (EMOM wait, or linear work skip-to-rest).
 * No-op when not running / already resting / completed.
 */
export function completeWorkPhase(runtime: IntervalRuntime, now: number): IntervalStepResult {
  if (runtime.status !== 'running' || !runtime.config) {
    return { runtime, effects: [] };
  }
  const cfg = runtime.config;
  const current = sampleInterval(runtime, now);

  if (cfg.mode === 'emom') {
    if (current.phase !== 'work') return { runtime: current, effects: [] };
    const next: IntervalRuntime = {
      ...current,
      phase: 'rest',
      phaseStartsAt: now,
      phaseEndsAt: current.phaseEndsAt, // still the minute boundary
      workDoneEarly: true,
    };
    return { runtime: next, effects: [{ kind: 'PHASE_START', phase: 'rest', round: next.round }] };
  }

  // Linear: completing work early → jump sample to work end (rest or complete).
  if (current.phase !== 'work') return { runtime: current, effects: [] };
  const stepped = tickInterval(current, current.phaseEndsAt);
  return stepped;
}

/**
 * Skip current phase deterministically.
 * - Linear WORK → REST (or complete on final work)
 * - Linear REST → next WORK (or complete)
 * - EMOM WORK → wait remainder of fixed minute (schedule preserved)
 * - EMOM REST (wait) → jump to minute boundary (next round on clock)
 * - EMOM PREP → first work at prep end
 */
export function skipPhase(runtime: IntervalRuntime, now: number): IntervalStepResult {
  if (runtime.status !== 'running' || !runtime.config) {
    return { runtime, effects: [] };
  }
  const current = sampleInterval(runtime, now);
  if (current.status !== 'running') {
    return tickInterval(current, now);
  }

  const cfg = current.config!;
  if (cfg.mode === 'emom') {
    if (current.phase === 'prep') {
      return tickInterval(current, current.phaseEndsAt);
    }
    if (current.phase === 'work') {
      return completeWorkPhase(current, now);
    }
    // rest wait → end of minute
    return tickInterval(current, current.phaseEndsAt);
  }

  // Linear: advance to phase end (may complete).
  return tickInterval(current, current.phaseEndsAt);
}

/** Restart from the beginning (same config). */
export function restartInterval(runtime: IntervalRuntime, now: number): IntervalStepResult {
  if (!runtime.config) return { runtime: idleIntervalRuntime(), effects: [] };
  // Re-validate from the normalized shape (already valid).
  const raw: IntervalConfig = {
    mode: runtime.config.mode,
    workMs: runtime.config.mode === 'emom' ? runtime.config.emomWorkMs : runtime.config.workMs,
    restMs: runtime.config.mode === 'emom' ? runtime.config.emomRestMs : runtime.config.restMs,
    rounds: runtime.config.rounds,
    periodMs: runtime.config.periodMs,
    preparationMs: runtime.config.preparationMs,
  };
  return startInterval(raw, now);
}

/** Remaining ms in current phase (0 when not running). */
export function phaseRemainingMs(runtime: IntervalRuntime, now: number): number {
  if (runtime.status !== 'running') return 0;
  return Math.max(0, runtime.phaseEndsAt - now);
}

/** Remaining ms in current EMOM/round window (0 when not running). */
export function roundRemainingMs(runtime: IntervalRuntime, now: number): number {
  if (runtime.status !== 'running' || !runtime.config) return 0;
  const cfg = runtime.config;
  if (cfg.mode === 'emom' && cfg.periodMs) {
    const prepEnd = runtime.startedAt + cfg.preparationMs;
    const roundIdx = Math.max(0, runtime.round - 1);
    const roundEnd = prepEnd + (roundIdx + 1) * cfg.periodMs;
    return Math.max(0, roundEnd - now);
  }
  return phaseRemainingMs(runtime, now);
}

/** Display countdown mm:ss (visual only). */
export function formatIntervalCountdown(msRemaining: number): string {
  const total = Math.max(0, Math.ceil(msRemaining / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** True when runtime can be resumed from persisted cursor state (valid + mid-protocol). */
export function canResumeInterval(runtime: IntervalRuntime | null | undefined): runtime is IntervalRuntime {
  if (!runtime || runtime.status !== 'running' || !runtime.config) return false;
  return runtime.config.totalMs > 0 && Number.isFinite(runtime.startedAt) && runtime.startedAt > 0;
}

/**
 * Recover after process death: re-sample from timestamps.
 * Corrupt / expired state → idle (caller keeps workout session intact).
 */
export function resumeInterval(runtime: IntervalRuntime | null | undefined, now: number): IntervalStepResult {
  if (!canResumeInterval(runtime)) {
    return { runtime: idleIntervalRuntime(), effects: [] };
  }
  return tickInterval(runtime, now);
}
