import {
  intervalPulseMs,
  pulseIntervalHaptic,
  pulseTempoHaptic,
  tempoPulseMs,
} from './feedback';
import type { TempoEffect } from './tempoTrainer';
import type { IntervalEffect } from '../interval/intervalEngine';

/**
 * D-070: the deferred-audio feedback seam (D-011) rests on a cue matrix that
 * was previously only embedded in adapter side effects. These tests pin the
 * pure mappings so a future audio adapter can swap them with regression proof.
 * Behavior is identical to the pre-refactor adapter.
 */
describe('haptic cue matrix (pure, D-070)', () => {
  it('pins the tempo matrix: complete 35ms, phase 15ms', () => {
    expect(tempoPulseMs({ kind: 'TEMPO_COMPLETE' })).toBe(35);
    const phase: TempoEffect = { kind: 'PHASE_START', phase: 'eccentric' };
    expect(tempoPulseMs(phase)).toBe(15);
  });

  it('pins the interval matrix: prep 12 · work 25 · rest 18 · round 20 · complete 40', () => {
    expect(intervalPulseMs({ kind: 'PHASE_START', phase: 'prep', round: 1 })).toBe(12);
    expect(intervalPulseMs({ kind: 'PHASE_START', phase: 'work', round: 1 })).toBe(25);
    expect(intervalPulseMs({ kind: 'PHASE_START', phase: 'rest', round: 1 })).toBe(18);
    expect(intervalPulseMs({ kind: 'ROUND_START', round: 2 })).toBe(20);
    expect(intervalPulseMs({ kind: 'INTERVAL_COMPLETE' })).toBe(40);
  });

  it('adapters stay fail-soft under Jest (Vibration absent)', () => {
    expect(() => pulseTempoHaptic({ kind: 'TEMPO_COMPLETE' })).not.toThrow();
    expect(() =>
      pulseIntervalHaptic({ kind: 'PHASE_START', phase: 'work', round: 1 }),
    ).not.toThrow();
    expect(() => pulseIntervalHaptic({ kind: 'INTERVAL_COMPLETE' })).not.toThrow();
  });
});
