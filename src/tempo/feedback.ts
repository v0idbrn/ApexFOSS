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

export function pulseTempoHaptic(effect: TempoEffect): void {
  if (effect.kind === 'TEMPO_COMPLETE') pulse(35);
  else pulse(15);
}

/**
 * Interval cues (restrained):
 * PREP short · WORK distinct · REST medium · ROUND short · COMPLETE long.
 * Multi-boundary catch-up only emits landed effects (engine already collapses).
 */
export function pulseIntervalHaptic(effect: IntervalEffect): void {
  switch (effect.kind) {
    case 'INTERVAL_COMPLETE':
      pulse(40);
      break;
    case 'ROUND_START':
      pulse(20);
      break;
    case 'PHASE_START':
      if (effect.phase === 'work') pulse(25);
      else if (effect.phase === 'rest') pulse(18);
      else pulse(12); // prep
      break;
    default:
      break;
  }
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
