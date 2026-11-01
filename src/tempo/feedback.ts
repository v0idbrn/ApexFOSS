/**
 * Fail-soft haptic cues for tempo + interval trainers.
 * Never required for correctness. Dynamic-safe under Jest (Vibration mocked/absent).
 */

import { Platform, Vibration } from 'react-native';
import type { TempoEffect } from '../tempo/tempoTrainer';
import type { IntervalEffect } from '../interval/intervalEngine';

function pulse(ms: number): void {
  try {
    if (Platform.OS === 'web') return;
    if (typeof Vibration?.vibrate !== 'function') return;
    Vibration.vibrate(ms);
  } catch {
    // haptics unavailable — never break the trainer
  }
}

/**
 * Pure cue matrix (pulse ms). Pinned by tests (D-070) so the deferred-audio
 * seam cannot drift silently; a future audio adapter swaps this mapping
 * without touching engine timing.
 */
export function tempoPulseMs(effect: TempoEffect): number {
  return effect.kind === 'TEMPO_COMPLETE' ? 35 : 15;
}

/**
 * Interval cues (restrained):
 * PREP short · WORK distinct · REST medium · ROUND short · COMPLETE long.
 * Multi-boundary catch-up only emits landed effects (engine already collapses).
 * Pure; `null` means "no cue for this effect".
 */
export function intervalPulseMs(effect: IntervalEffect): number | null {
  switch (effect.kind) {
    case 'INTERVAL_COMPLETE':
      return 40;
    case 'ROUND_START':
      return 20;
    case 'PHASE_START':
      if (effect.phase === 'work') return 25;
      if (effect.phase === 'rest') return 18;
      return 12; // prep
    default:
      return null;
  }
}

export function pulseTempoHaptic(effect: TempoEffect): void {
  pulse(tempoPulseMs(effect));
}

export function pulseIntervalHaptic(effect: IntervalEffect): void {
  const ms = intervalPulseMs(effect);
  if (ms !== null) pulse(ms);
}

import {
  activateTempoKeepAwake,
  releaseTempoKeepAwake,
  activateIntervalKeepAwake,
  releaseIntervalKeepAwake,
  __keepAwakeHeldTagsForTests,
  __resetKeepAwakeForTests,
} from '../ui/keepAwake';

export {
  activateTempoKeepAwake,
  releaseTempoKeepAwake,
  activateIntervalKeepAwake,
  releaseIntervalKeepAwake,
  __keepAwakeHeldTagsForTests,
  __resetKeepAwakeForTests as __resetTempoFeedbackForTests,
};

/** Back-compat test helper: true when tempo tag is held. */
export function __tempoKeepAwakeStateForTests(): boolean {
  return __keepAwakeHeldTagsForTests().includes('apexfoss-tempo');
}
