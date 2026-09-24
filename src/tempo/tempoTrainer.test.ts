import {
  activeTempoPhases,
  cancelTempo,
  currentTempoPhase,
  formatPhaseCountdown,
  hasActiveTempo,
  idleTempoRuntime,
  normalizeTempoSpec,
  phaseRemainingMs,
  sampleTempo,
  startTempo,
  tempoElapsedMs,
  tickTempo,
  type TempoRuntime,
} from './tempoTrainer';
import type { TempoSpec } from '../types/engine';

const tempo = (
  eccentricMs: number | null,
  pauseBottomMs: number | null,
  concentricMs: number | null,
  pauseTopMs: number | null,
): TempoSpec => ({ eccentricMs, pauseBottomMs, concentricMs, pauseTopMs });

const T0 = 1_700_000_000_000;

describe('tempo trainer pure logic', () => {
  describe('A) 3-1-1-0 full sequence', () => {
    const spec = tempo(3000, 1000, 1000, 0);

    it('starts in eccentric with correct duration', () => {
      const { runtime, effects } = startTempo(spec, T0);
      expect(runtime.status).toBe('running');
      expect(currentTempoPhase(runtime)).toBe('eccentric');
      expect(runtime.phaseEndsAt).toBe(T0 + 3000);
      expect(runtime.totalMs).toBe(5000);
      expect(effects).toEqual([{ kind: 'PHASE_START', phase: 'eccentric' }]);
      expect(phaseRemainingMs(runtime, T0)).toBe(3000);
    });

    it('transitions eccentric → bottom pause → concentric and skips top pause', () => {
      let { runtime } = startTempo(spec, T0);

      let step = tickTempo(runtime, T0 + 3000);
      runtime = step.runtime;
      expect(step.effects).toEqual([{ kind: 'PHASE_START', phase: 'pauseBottom' }]);
      expect(currentTempoPhase(runtime)).toBe('pauseBottom');
      expect(runtime.phaseEndsAt).toBe(T0 + 4000);

      step = tickTempo(runtime, T0 + 4000);
      runtime = step.runtime;
      expect(step.effects).toEqual([{ kind: 'PHASE_START', phase: 'concentric' }]);
      expect(currentTempoPhase(runtime)).toBe('concentric');

      step = tickTempo(runtime, T0 + 5000);
      runtime = step.runtime;
      expect(step.effects).toEqual([{ kind: 'TEMPO_COMPLETE' }]);
      expect(runtime.status).toBe('completed');
      expect(currentTempoPhase(runtime)).toBe('concentric'); // last active phase
    });
  });

  describe('B) 0-0-0-0 inactive', () => {
    it('does not activate', () => {
      expect(hasActiveTempo(tempo(0, 0, 0, 0))).toBe(false);
      expect(hasActiveTempo(tempo(null, null, null, null))).toBe(false);
      const { runtime, effects } = startTempo(tempo(0, 0, 0, 0), T0);
      expect(runtime.status).toBe('idle');
      expect(effects).toEqual([]);
      expect(runtime.phases).toEqual([]);
    });
  });

  describe('C) 3-0-1-0 zero pause skipped', () => {
    it('runs only eccentric and concentric', () => {
      const phases = activeTempoPhases(tempo(3000, 0, 1000, 0));
      expect(phases.map((p) => p.id)).toEqual(['eccentric', 'concentric']);

      let { runtime } = startTempo(tempo(3000, 0, 1000, 0), T0);
      const step = tickTempo(runtime, T0 + 3000);
      runtime = step.runtime;
      expect(step.effects).toEqual([{ kind: 'PHASE_START', phase: 'concentric' }]);
      expect(currentTempoPhase(runtime)).toBe('concentric');
    });
  });

  describe('D) 0-1-1-0 starts at bottom pause', () => {
    it('first phase is pauseBottom', () => {
      const { runtime, effects } = startTempo(tempo(0, 1000, 1000, 0), T0);
      expect(currentTempoPhase(runtime)).toBe('pauseBottom');
      expect(effects).toEqual([{ kind: 'PHASE_START', phase: 'pauseBottom' }]);
      expect(runtime.phaseEndsAt).toBe(T0 + 1000);
    });
  });

  describe('E) 0-0-0-2 starts at top pause', () => {
    it('first phase is pauseTop', () => {
      const { runtime, effects } = startTempo(tempo(0, 0, 0, 2000), T0);
      expect(currentTempoPhase(runtime)).toBe('pauseTop');
      expect(effects).toEqual([{ kind: 'PHASE_START', phase: 'pauseTop' }]);
    });
  });

  describe('F/G) timestamp expiry and exact boundary', () => {
    it('no drift: remaining derived from phaseEndsAt', () => {
      const { runtime } = startTempo(tempo(3000, 0, 0, 0), T0);
      expect(phaseRemainingMs(runtime, T0 + 1000)).toBe(2000);
      expect(phaseRemainingMs(runtime, T0 + 2500)).toBe(500);
      expect(phaseRemainingMs(runtime, T0 + 9999)).toBe(0);
    });

    it('now === phaseEndsAt advances deterministically', () => {
      const { runtime } = startTempo(tempo(3000, 1000, 0, 0), T0);
      const atBoundary = tickTempo(runtime, T0 + 3000);
      expect(atBoundary.effects[0]).toEqual({ kind: 'PHASE_START', phase: 'pauseBottom' });
      const completeAtBoundary = tickTempo(atBoundary.runtime, T0 + 4000);
      expect(completeAtBoundary.effects).toEqual([{ kind: 'TEMPO_COMPLETE' }]);
      expect(completeAtBoundary.runtime.status).toBe('completed');
    });

    it('one tick before boundary stays on same phase', () => {
      const { runtime } = startTempo(tempo(3000, 0, 0, 0), T0);
      const step = tickTempo(runtime, T0 + 2999);
      expect(step.effects).toEqual([]);
      expect(step.runtime.phaseIndex).toBe(0);
    });
  });

  describe('H) background catch-up across multiple phases', () => {
    it('derives correct phase from absolute elapsed time', () => {
      const spec = tempo(3000, 1000, 1000, 0); // ends at +5000
      const { runtime } = startTempo(spec, T0);

      // Resume at +3500 → inside bottom pause (3000–4000)
      const mid = sampleTempo(runtime, T0 + 3500);
      expect(currentTempoPhase(mid)).toBe('pauseBottom');
      expect(mid.phaseStartsAt).toBe(T0 + 3000);
      expect(mid.phaseEndsAt).toBe(T0 + 4000);

      // Resume at +4500 → inside concentric
      const late = sampleTempo(runtime, T0 + 4500);
      expect(currentTempoPhase(late)).toBe('concentric');
      expect(late.phaseStartsAt).toBe(T0 + 4000);

      // Tick emits single terminal effect, not a burst of intermediate phases
      const step = tickTempo(runtime, T0 + 4500);
      expect(step.effects).toEqual([{ kind: 'PHASE_START', phase: 'concentric' }]);
    });
  });

  describe('I) full tempo expired while backgrounded', () => {
    it('returns completion', () => {
      const { runtime } = startTempo(tempo(1000, 1000, 1000, 1000), T0);
      const step = tickTempo(runtime, T0 + 999_999);
      expect(step.runtime.status).toBe('completed');
      expect(step.effects).toEqual([{ kind: 'TEMPO_COMPLETE' }]);
      expect(tempoElapsedMs(step.runtime, T0 + 999_999)).toBe(4000);
    });

    it('exact total boundary completes', () => {
      const { runtime } = startTempo(tempo(2000, 0, 0, 0), T0);
      const step = tickTempo(runtime, T0 + 2000);
      expect(step.runtime.status).toBe('completed');
      expect(step.effects).toEqual([{ kind: 'TEMPO_COMPLETE' }]);
    });
  });

  describe('J/K) cancel and restart', () => {
    it('cancel resets runtime with no stale timestamps', () => {
      const { runtime } = startTempo(tempo(3000, 1000, 0, 0), T0);
      const cancelled = cancelTempo();
      expect(cancelled).toEqual(idleTempoRuntime());
      expect(cancelled.status).toBe('idle');
      expect(cancelled.phaseEndsAt).toBe(0);
      expect(cancelled.startedAt).toBe(0);
      expect(phaseRemainingMs(cancelled, T0 + 1000)).toBe(0);
      expect(currentTempoPhase(cancelled)).toBeNull();
      // original object untouched (pure)
      expect(runtime.status).toBe('running');
    });

    it('restart after cancel begins at phase 1', () => {
      cancelTempo();
      const { runtime, effects } = startTempo(tempo(3000, 1000, 0, 0), T0 + 10_000);
      expect(runtime.startedAt).toBe(T0 + 10_000);
      expect(currentTempoPhase(runtime)).toBe('eccentric');
      expect(effects).toEqual([{ kind: 'PHASE_START', phase: 'eccentric' }]);
    });

    it('tick on idle / completed is a no-op', () => {
      const idle = tickTempo(idleTempoRuntime(), T0);
      expect(idle.effects).toEqual([]);
      expect(idle.runtime.status).toBe('idle');

      const { runtime } = startTempo(tempo(1000, 0, 0, 0), T0);
      const done = tickTempo(runtime, T0 + 1000);
      const again = tickTempo(done.runtime, T0 + 9999);
      expect(again.effects).toEqual([]);
      expect(again.runtime.status).toBe('completed');
    });
  });

  describe('L) malformed / negative values', () => {
    it('clamps negatives and non-finite to zero', () => {
      expect(normalizeTempoSpec(tempo(-500, -1, Number.NaN, Infinity))).toEqual({
        eccentricMs: 0,
        pauseBottomMs: 0,
        concentricMs: 0,
        pauseTopMs: 0,
      });
      expect(hasActiveTempo(tempo(-1, null, undefined as unknown as number, 0))).toBe(false);
      const { runtime, effects } = startTempo(tempo(-1000, -1, -1, -1), T0);
      expect(runtime.status).toBe('idle');
      expect(effects).toEqual([]);
    });

    it('treats invalid now as no-op sample', () => {
      const { runtime } = startTempo(tempo(3000, 0, 0, 0), T0);
      expect(sampleTempo(runtime, Number.NaN)).toBe(runtime);
      const idleStart = startTempo(tempo(3000, 0, 0, 0), Number.NaN);
      expect(idleStart.runtime.status).toBe('idle');
    });
  });

  describe('M) large durations', () => {
    it('handles large phase without overflow into invalid state', () => {
      // Stay within safe integer arithmetic when added to wall-clock timestamps.
      const huge = 86_400_000; // 24h
      const { runtime } = startTempo(tempo(huge, 1, 0, 0), T0);
      expect(runtime.status).toBe('running');
      expect(Number.isFinite(runtime.phaseEndsAt)).toBe(true);
      expect(phaseRemainingMs(runtime, T0)).toBe(huge);
      expect(phaseRemainingMs(runtime, T0 + huge - 1)).toBe(1);
      const clamped = normalizeTempoSpec(tempo(Number.MAX_VALUE, -1, Number.NaN, Infinity));
      expect(clamped.eccentricMs).toBe(Number.MAX_SAFE_INTEGER);
      expect(clamped.pauseBottomMs).toBe(0);
      expect(clamped.concentricMs).toBe(0);
      expect(clamped.pauseTopMs).toBe(0);
    });
  });

  describe('elapsed / countdown helpers', () => {
    it('formats phase countdown with one decimal', () => {
      expect(formatPhaseCountdown(3000)).toBe('3.0');
      expect(formatPhaseCountdown(1500)).toBe('1.5');
      expect(formatPhaseCountdown(0)).toBe('0.0');
      expect(formatPhaseCountdown(-10)).toBe('0.0');
    });

    it('elapsed clamps to total', () => {
      const { runtime } = startTempo(tempo(1000, 1000, 0, 0), T0);
      expect(tempoElapsedMs(runtime, T0 + 500)).toBe(500);
      expect(tempoElapsedMs(runtime, T0 + 99_999)).toBe(2000);
      expect(tempoElapsedMs(idleTempoRuntime(), T0)).toBe(0);
    });
  });

  describe('sample does not mutate input', () => {
    it('returns same reference when still in phase', () => {
      const { runtime } = startTempo(tempo(3000, 0, 0, 0), T0);
      expect(sampleTempo(runtime, T0 + 10)).toBe(runtime);
    });
  });

  describe('restart while running (startTempo again)', () => {
    it('discards previous phase timestamps', () => {
      const first = startTempo(tempo(3000, 1000, 0, 0), T0);
      const second = startTempo(tempo(3000, 1000, 0, 0), T0 + 7000);
      expect(second.runtime.startedAt).toBe(T0 + 7000);
      expect(second.runtime.phaseStartsAt).toBe(T0 + 7000);
      expect(second.runtime.phaseEndsAt).toBe(T0 + 10000);
      expect(first.runtime.phaseEndsAt).toBe(T0 + 3000);
    });
  });

  describe('tempo isolation contract', () => {
    it('runtime carries no cursor / session / set fields', () => {
      const { runtime } = startTempo(tempo(1000, 0, 0, 0), T0);
      const keys = Object.keys(runtime).sort();
      expect(keys).toEqual(['phaseEndsAt', 'phaseIndex', 'phaseStartsAt', 'phases', 'startedAt', 'status', 'totalMs']);
      expect(runtime).not.toHaveProperty('cursor');
      expect(runtime).not.toHaveProperty('sessionId');
      expect(runtime).not.toHaveProperty('setIndex');
    });
  });
});

describe('tempo feedback adapters (no hardware)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('pulseTempoHaptic does not throw when Vibration missing', () => {
    const { pulseTempoHaptic } = require('./feedback') as typeof import('./feedback');
    expect(() => pulseTempoHaptic({ kind: 'PHASE_START', phase: 'eccentric' })).not.toThrow();
    expect(() => pulseTempoHaptic({ kind: 'TEMPO_COMPLETE' })).not.toThrow();
  });

  it('keep-awake activate/release fail soft without expo module in node', () => {
    const fb = require('./feedback') as typeof import('./feedback');
    fb.__resetTempoFeedbackForTests();
    expect(() => fb.activateTempoKeepAwake()).not.toThrow();
    expect(() => fb.releaseTempoKeepAwake()).not.toThrow();
    expect(fb.__tempoKeepAwakeStateForTests()).toBe(false);
  });
});

function unusedTypeCheck(_r: TempoRuntime): void {}
void unusedTypeCheck;
