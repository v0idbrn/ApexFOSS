/**
 * Side-effect adapters for the tempo trainer (haptics + keep-awake).
 * Never required for correctness — all calls are fail-soft.
 * Dynamic requires keep Jest/node free of native module resolution.
 */

import { Platform, Vibration } from 'react-native';
import type { TempoEffect } from './tempoTrainer';

const KEEP_AWAKE_TAG = 'apexfoss-tempo';
let keepAwakeActive = false;

/** Restrained single pulse at phase boundaries / completion. */
export function pulseTempoHaptic(effect: TempoEffect): void {
  try {
    if (Platform.OS === 'web') return;
    if (typeof Vibration?.vibrate !== 'function') return;
    if (effect.kind === 'TEMPO_COMPLETE') {
      Vibration.vibrate(35);
    } else {
      Vibration.vibrate(15);
    }
  } catch {
    // haptics unavailable — never break the trainer
  }
}

/** Hold screen awake while tempo is running. Fail-soft. */
export function activateTempoKeepAwake(): void {
  try {
    if (keepAwakeActive) return;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const keepAwake = require('expo-keep-awake');
    if (typeof keepAwake.activateKeepAwake === 'function') {
      keepAwake.activateKeepAwake(KEEP_AWAKE_TAG);
      keepAwakeActive = true;
    }
  } catch {
    // library missing / unsupported — document limitation, continue
  }
}

export function releaseTempoKeepAwake(): void {
  try {
    if (!keepAwakeActive) return;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const keepAwake = require('expo-keep-awake');
    if (typeof keepAwake.deactivateKeepAwake === 'function') {
      keepAwake.deactivateKeepAwake(KEEP_AWAKE_TAG);
    }
    keepAwakeActive = false;
  } catch {
    // ignore
  }
}

/** Test hook: inspect / reset keep-awake latch. */
export function __tempoKeepAwakeStateForTests(): boolean {
  return keepAwakeActive;
}

export function __resetTempoFeedbackForTests(): void {
  keepAwakeActive = false;
}
