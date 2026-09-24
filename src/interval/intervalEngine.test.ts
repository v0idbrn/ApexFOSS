import {
  cancelInterval,
  canResumeInterval,
  completeWorkPhase,
  formatIntervalCountdown,
  hasActiveInterval,
  idleIntervalRuntime,
  phaseRemainingMs,
  resumeInterval,
  restartInterval,
  roundRemainingMs,
  sampleInterval,
  skipPhase,
  startInterval,
  tickInterval,
  validateIntervalConfig,
  type IntervalConfig,
  type IntervalRuntime,
} from './intervalEngine';

const T0 = 1_700_000_000_000;

const hiit = (workMs: number, restMs: number, rounds: number, preparationMs = 0): IntervalConfig => ({
  mode: 'hiit',
  workMs,
  restMs,
  rounds,
  periodMs: null,
  preparationMs,
});

const emom = (periodMs: number, rounds: number, workMs: number, preparationMs = 0): IntervalConfig => ({
  mode: 'emom',
  workMs,
  restMs: 0,
  rounds,
  periodMs,
  preparationMs,
});

const glyco = (workMs: number, restMs: number, rounds: number): IntervalConfig => ({
  mode: 'glycolytic',
  workMs,
  restMs,
  rounds,
  periodMs: null,
  preparationMs: 0,
});

describe('interval engine — validation', () => {
  it('accepts a valid HIIT definition', () => {
    const v = validateIntervalConfig(hiit(30_000, 15_000, 8));
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.config.mode).toBe('hiit');
      expect(v.config.rounds).toBe(8);
      expect(v.config.totalMs).toBe(8 * 30_000 + 7 * 15_000);
    }
  });

  it('rejects missing definition', () => {
    expect(validateIntervalConfig(null).ok).toBe(false);
    expect(validateIntervalConfig(undefined).ok).toBe(false);
  });

  it('rejects zero rounds', () => {
    const v = validateIntervalConfig(hiit(30_000, 15_000, 0));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe('invalid_rounds');
  });

  it('rejects negative rounds (unsafe int path)', () => {
    expect(validateIntervalConfig(hiit(30_000, 15_000, -3)).ok).toBe(false);
  });

  it('rejects zero/negative work for HIIT', () => {
    const v = validateIntervalConfig(hiit(0, 15_000, 4));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe('invalid_work');
  });

  it('allows zero rest for HIIT (immediate next work)', () => {
    expect(validateIntervalConfig(hiit(30_000, 0, 4)).ok).toBe(true);
  });

  it('rejects EMOM without valid period', () => {
    const v = validateIntervalConfig(emom(0, 10, 30_000));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe('invalid_period');
  });

  it('rejects EMOM work exceeding period', () => {
    const v = validateIntervalConfig(emom(60_000, 10, 90_000));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe('work_exceeds_period');
  });

  it('normalizes EMOM workMs=0 to full period (athlete-controlled minute)', () => {
    const v = validateIntervalConfig(emom(60_000, 5, 0));
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.config.emomWorkMs).toBe(60_000);
      expect(v.config.emomRestMs).toBe(0);
      expect(v.config.totalMs).toBe(5 * 60_000);
    }
  });

  it('rejects non-finite / absurd durations', () => {
    expect(validateIntervalConfig(hiit(Number.NaN, 1000, 2)).ok).toBe(false);
    expect(validateIntervalConfig(hiit(Number.POSITIVE_INFINITY, 1000, 2)).ok).toBe(false);
    expect(validateIntervalConfig(hiit(Number.MAX_SAFE_INTEGER, 1000, 10_000)).ok).toBe(false);
  });

  it('rejects invalid mode', () => {
    const v = validateIntervalConfig({ ...hiit(1000, 1000, 2), mode: 'tabata' as never });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe('invalid_mode');
  });

  it('hasActiveInterval mirrors validation', () => {
    expect(hasActiveInterval(hiit(30_000, 15_000, 8))).toBe(true);
    expect(hasActiveInterval(hiit(0, 15_000, 8))).toBe(false);
    expect(hasActiveInterval(null)).toBe(false);
  });
});

describe('interval engine — HIIT work/rest', () => {
  it('starts in work with correct phase end', () => {
    const { runtime, effects } = startInterval(hiit(30_000, 15_000, 8), T0);
    expect(runtime.status).toBe('running');
    expect(runtime.phase).toBe('work');
    expect(runtime.round).toBe(1);
    expect(runtime.phaseEndsAt).toBe(T0 + 30_000);
    expect(effects).toEqual([{ kind: 'PHASE_START', phase: 'work', round: 1 }]);
    expect(phaseRemainingMs(runtime, T0)).toBe(30_000);
  });

  it('work expires → rest at exact boundary', () => {
    let { runtime } = startInterval(hiit(30_000, 15_000, 8), T0);
    const step = tickInterval(runtime, T0 + 30_000);
    runtime = step.runtime;
    expect(runtime.phase).toBe('rest');
    expect(runtime.round).toBe(1);
    expect(runtime.phaseEndsAt).toBe(T0 + 45_000);
    expect(step.effects).toContainEqual({ kind: 'PHASE_START', phase: 'rest', round: 1 });
  });

  it('rest expires → next round work', () => {
    let { runtime } = startInterval(hiit(30_000, 15_000, 8), T0);
    runtime = tickInterval(runtime, T0 + 45_000).runtime;
    expect(runtime.phase).toBe('work');
    expect(runtime.round).toBe(2);
    expect(runtime.phaseStartsAt).toBe(T0 + 45_000);
    expect(runtime.phaseEndsAt).toBe(T0 + 75_000);
  });

  it('final work end → completed (no trailing rest)', () => {
    let { runtime } = startInterval(hiit(30_000, 15_000, 3), T0);
    // timeline: W30 R15 W30 R15 W30 = 120s
    const total = 3 * 30_000 + 2 * 15_000;
    const step = tickInterval(runtime, T0 + total);
    expect(step.runtime.status).toBe('completed');
    expect(step.effects).toEqual([{ kind: 'INTERVAL_COMPLETE' }]);
    expect(phaseRemainingMs(step.runtime, T0 + total)).toBe(0);
  });

  it('skip work → rest immediately', () => {
    let { runtime } = startInterval(hiit(30_000, 15_000, 8), T0);
    const step = skipPhase(runtime, T0 + 5_000);
    expect(step.runtime.phase).toBe('rest');
    expect(step.runtime.round).toBe(1);
  });

  it('skip rest → next work', () => {
    let { runtime } = startInterval(hiit(30_000, 15_000, 8), T0);
    runtime = tickInterval(runtime, T0 + 30_000).runtime; // in rest
    const step = skipPhase(runtime, T0 + 32_000);
    expect(step.runtime.phase).toBe('work');
    expect(step.runtime.round).toBe(2);
  });

  it('skip final work → completed', () => {
    let { runtime } = startInterval(hiit(30_000, 15_000, 2), T0);
    runtime = tickInterval(runtime, T0 + 45_000).runtime; // round 2 work
    const step = skipPhase(runtime, T0 + 50_000);
    expect(step.runtime.status).toBe('completed');
    expect(step.effects).toEqual([{ kind: 'INTERVAL_COMPLETE' }]);
  });

  it('catch-up across multiple phases on background resume', () => {
    let { runtime } = startInterval(hiit(30_000, 15_000, 8), T0);
    // 95s later: W30 R15 W30 R15 W(5 into third work? 90s boundary → round 3 work at 90s)
    const step = tickInterval(runtime, T0 + 95_000);
    expect(step.runtime.round).toBe(3);
    expect(step.runtime.phase).toBe('work');
    // single terminal effect only (no burst)
    expect(step.effects.length).toBeLessThanOrEqual(2);
    expect(step.effects[step.effects.length - 1]).toEqual({ kind: 'PHASE_START', phase: 'work', round: 3 });
  });

  it('restart resets to round 1 work', () => {
    let { runtime } = startInterval(hiit(30_000, 15_000, 8), T0);
    runtime = tickInterval(runtime, T0 + 50_000).runtime;
    const step = restartInterval(runtime, T0 + 60_000);
    expect(step.runtime.status).toBe('running');
    expect(step.runtime.round).toBe(1);
    expect(step.runtime.phase).toBe('work');
    expect(step.runtime.startedAt).toBe(T0 + 60_000);
  });

  it('cancel clears runtime', () => {
    const { runtime } = startInterval(hiit(30_000, 15_000, 8), T0);
    const cancelled = cancelInterval();
    expect(cancelled.status).toBe('idle');
    expect(cancelled.config).toBeNull();
    expect(sampleInterval(cancelled, T0 + 99_000).status).toBe('idle');
    void runtime;
  });

  it('start with invalid config → idle, no effects', () => {
    const step = startInterval(hiit(0, 1000, 4), T0);
    expect(step.runtime.status).toBe('idle');
    expect(step.effects).toEqual([]);
  });
});

describe('interval engine — EMOM fixed-clock', () => {
  it('rounds start at fixed period anchors (0, 60s, 120s)', () => {
    let { runtime } = startInterval(emom(60_000, 3, 30_000), T0);
    expect(runtime.phase).toBe('work');
    expect(runtime.round).toBe(1);

    // still round 1 work at 20s
    runtime = sampleInterval(runtime, T0 + 20_000);
    expect(runtime.round).toBe(1);
    expect(runtime.phase).toBe('work');

    // work ended → rest wait within minute
    runtime = sampleInterval(runtime, T0 + 35_000);
    expect(runtime.phase).toBe('rest');
    expect(runtime.phaseEndsAt).toBe(T0 + 60_000);

    // round 2 at exactly 60s
    runtime = sampleInterval(runtime, T0 + 60_000);
    expect(runtime.round).toBe(2);
    expect(runtime.phase).toBe('work');

    // round 3 at 120s
    runtime = sampleInterval(runtime, T0 + 120_000);
    expect(runtime.round).toBe(3);

    // complete at 180s
    const done = sampleInterval(runtime, T0 + 180_000);
    expect(done.status).toBe('completed');
  });

  it('early work completion does not shift next round (critical EMOM test)', () => {
    let { runtime } = startInterval(emom(60_000, 3, 30_000), T0);
    // Athlete finishes work at 35s into minute 1 (work window was 30s — already in rest naturally).
    // Use open work (workMs=0 → full minute) and complete at 35s.
    let open = startInterval(emom(60_000, 3, 0), T0).runtime;
    open = completeWorkPhase(open, T0 + 35_000).runtime;
    expect(open.phase).toBe('rest');
    expect(open.workDoneEarly).toBe(true);
    expect(open.phaseEndsAt).toBe(T0 + 60_000); // remaining 25s of the minute

    // Round 2 still anchored at 60s — not 35s+60s
    const at60 = sampleInterval(open, T0 + 60_000);
    expect(at60.round).toBe(2);
    expect(at60.phase).toBe('work');
    expect(at60.phaseStartsAt).toBe(T0 + 60_000);

    // 25s of wait was preserved (35→60)
    expect(roundRemainingMs(open, T0 + 35_000)).toBe(25_000);
    void runtime;
  });

  it('skip work preserves schedule (enters wait, not next minute early)', () => {
    const { runtime } = startInterval(emom(60_000, 10, 0), T0);
    const step = skipPhase(runtime, T0 + 10_000);
    expect(step.runtime.phase).toBe('rest');
    expect(step.runtime.phaseEndsAt).toBe(T0 + 60_000);
    expect(step.runtime.round).toBe(1);
  });

  it('skip during wait jumps to minute boundary', () => {
    let { runtime } = startInterval(emom(60_000, 10, 30_000), T0);
    runtime = sampleInterval(runtime, T0 + 40_000); // in rest
    expect(runtime.phase).toBe('rest');
    const step = skipPhase(runtime, T0 + 40_000);
    expect(step.runtime.round).toBe(2);
    expect(step.runtime.phase).toBe('work');
  });

  it('background recovery lands on correct round from timestamps alone', () => {
    const { runtime } = startInterval(emom(60_000, 3, 30_000), T0);
    // Return after 95s → round 2 (60–120), work if <30s into round → 95-60=35 → rest wait
    const recovered = sampleInterval(runtime, T0 + 95_000);
    expect(recovered.round).toBe(2);
    expect(recovered.phase).toBe('rest');
    expect(recovered.phaseEndsAt).toBe(T0 + 120_000);
  });

  it('exact minute boundary advances round', () => {
    const { runtime } = startInterval(emom(60_000, 5, 20_000), T0);
    const at = sampleInterval(runtime, T0 + 60_000);
    expect(at.round).toBe(2);
    expect(at.phase).toBe('work');
  });

  it('final round completion at rounds*period', () => {
    const { runtime } = startInterval(emom(60_000, 3, 30_000), T0);
    const step = tickInterval(runtime, T0 + 180_000);
    expect(step.runtime.status).toBe('completed');
    expect(step.effects).toEqual([{ kind: 'INTERVAL_COMPLETE' }]);
  });

  it('preparation countdown runs before first EMOM minute', () => {
    const { runtime, effects } = startInterval(emom(60_000, 3, 30_000, 3_000), T0);
    expect(runtime.phase).toBe('prep');
    expect(runtime.phaseEndsAt).toBe(T0 + 3_000);
    expect(effects).toEqual([{ kind: 'PHASE_START', phase: 'prep', round: 1 }]);

    const work = sampleInterval(runtime, T0 + 3_000);
    expect(work.phase).toBe('work');
    expect(work.round).toBe(1);
    expect(work.phaseStartsAt).toBe(T0 + 3_000);
    // Round 1 window still ends at prep+period
    expect(work.phaseEndsAt).toBe(T0 + 3_000 + 30_000);
  });

  it('skip prep → first work', () => {
    const { runtime } = startInterval(emom(60_000, 3, 30_000, 5_000), T0);
    const step = skipPhase(runtime, T0 + 1_000);
    expect(step.runtime.phase).toBe('work');
    expect(step.runtime.round).toBe(1);
  });
});

describe('interval engine — glycolytic', () => {
  it('runs work/recovery cycles with long recovery', () => {
    let { runtime } = startInterval(glyco(30_000, 90_000, 6), T0);
    expect(runtime.phase).toBe('work');

    runtime = tickInterval(runtime, T0 + 30_000).runtime;
    expect(runtime.phase).toBe('rest');
    expect(runtime.phaseEndsAt).toBe(T0 + 120_000);

    runtime = tickInterval(runtime, T0 + 120_000).runtime;
    expect(runtime.phase).toBe('work');
    expect(runtime.round).toBe(2);
  });

  it('completes after final work (no trailing recovery)', () => {
    const { runtime } = startInterval(glyco(30_000, 90_000, 2), T0);
    // W30 R90 W30 = 150s
    const step = tickInterval(runtime, T0 + 150_000);
    expect(step.runtime.status).toBe('completed');
  });

  it('skip recovery → next work', () => {
    let { runtime } = startInterval(glyco(30_000, 90_000, 6), T0);
    runtime = tickInterval(runtime, T0 + 40_000).runtime;
    expect(runtime.phase).toBe('rest');
    const step = skipPhase(runtime, T0 + 45_000);
    expect(step.runtime.phase).toBe('work');
    expect(step.runtime.round).toBe(2);
  });
});

describe('interval engine — preparation', () => {
  it('prep expires into HIIT work', () => {
    const { runtime } = startInterval(hiit(30_000, 15_000, 4, 10_000), T0);
    expect(runtime.phase).toBe('prep');
    const step = tickInterval(runtime, T0 + 10_000);
    expect(step.runtime.phase).toBe('work');
    expect(step.runtime.phaseStartsAt).toBe(T0 + 10_000);
  });

  it('zero prep skips straight to work', () => {
    const { runtime } = startInterval(hiit(30_000, 15_000, 4, 0), T0);
    expect(runtime.phase).toBe('work');
  });

  it('cancel during prep is safe', () => {
    const { runtime } = startInterval(hiit(30_000, 15_000, 4, 10_000), T0);
    expect(cancelInterval().status).toBe('idle');
    expect(canResumeInterval(cancelInterval())).toBe(false);
    void runtime;
  });
});

describe('interval engine — recovery / persistence', () => {
  it('canResumeInterval requires running + config + positive start', () => {
    const { runtime } = startInterval(hiit(30_000, 15_000, 4), T0);
    expect(canResumeInterval(runtime)).toBe(true);
    expect(canResumeInterval(idleIntervalRuntime())).toBe(false);
    expect(canResumeInterval(null)).toBe(false);
    expect(canResumeInterval({ ...runtime, startedAt: 0 })).toBe(false);
    expect(canResumeInterval({ ...runtime, status: 'completed' })).toBe(false);
  });

  it('resumeInterval re-samples and emits terminal complete when expired', () => {
    const { runtime } = startInterval(hiit(30_000, 15_000, 2), T0);
    // total = 75s; resume after 10 min
    const step = resumeInterval(runtime, T0 + 600_000);
    expect(step.runtime.status).toBe('completed');
    expect(step.effects).toEqual([{ kind: 'INTERVAL_COMPLETE' }]);
  });

  it('resumeInterval with corrupt state → idle', () => {
    const step = resumeInterval(null, T0);
    expect(step.runtime.status).toBe('idle');
    const bad = { ...startInterval(hiit(1000, 1000, 2), T0).runtime, startedAt: Number.NaN };
    expect(resumeInterval(bad, T0).runtime.status).toBe('idle');
  });

  it('malformed config on runtime → sample leaves idle/completed safely', () => {
    const broken: IntervalRuntime = {
      ...idleIntervalRuntime(),
      status: 'running',
      config: null,
      startedAt: T0,
    };
    expect(sampleInterval(broken, T0 + 1000).status).toBe('running'); // no config → unchanged guard
    expect(canResumeInterval(broken)).toBe(false);
  });
});

describe('interval engine — race / double events', () => {
  it('double tick at same timestamp is idempotent', () => {
    const { runtime } = startInterval(hiit(30_000, 15_000, 4), T0);
    const a = tickInterval(runtime, T0 + 10_000);
    const b = tickInterval(a.runtime, T0 + 10_000);
    expect(b.runtime).toBe(a.runtime);
    expect(b.effects).toEqual([]);
  });

  it('double skip on final work does not double-complete', () => {
    let { runtime } = startInterval(hiit(30_000, 15_000, 2), T0);
    runtime = tickInterval(runtime, T0 + 45_000).runtime; // final work
    const first = skipPhase(runtime, T0 + 50_000);
    expect(first.runtime.status).toBe('completed');
    const second = skipPhase(first.runtime, T0 + 50_000);
    expect(second.runtime.status).toBe('completed');
    expect(second.effects).toEqual([]);
  });

  it('completeWorkPhase on rest is a no-op', () => {
    let { runtime } = startInterval(hiit(30_000, 15_000, 4), T0);
    runtime = tickInterval(runtime, T0 + 30_000).runtime;
    const step = completeWorkPhase(runtime, T0 + 32_000);
    expect(step.runtime.phase).toBe('rest');
    expect(step.effects).toEqual([]);
  });
});

describe('interval engine — display helpers', () => {
  it('formats countdown as mm:ss', () => {
    expect(formatIntervalCountdown(0)).toBe('00:00');
    expect(formatIntervalCountdown(1)).toBe('00:01');
    expect(formatIntervalCountdown(65_000)).toBe('01:05');
    expect(formatIntervalCountdown(-5)).toBe('00:00');
  });

  it('roundRemainingMs uses EMOM period window', () => {
    const { runtime } = startInterval(emom(60_000, 5, 30_000), T0);
    expect(roundRemainingMs(runtime, T0 + 10_000)).toBe(50_000);
    expect(roundRemainingMs(idleIntervalRuntime(), T0)).toBe(0);
  });

  it('phaseRemainingMs is 0 when idle/completed', () => {
    expect(phaseRemainingMs(idleIntervalRuntime(), T0)).toBe(0);
    const { runtime } = startInterval(hiit(1000, 1000, 1), T0);
    const done = tickInterval(runtime, T0 + 2_000).runtime;
    expect(done.status).toBe('completed');
    expect(phaseRemainingMs(done, T0)).toBe(0);
  });
});
