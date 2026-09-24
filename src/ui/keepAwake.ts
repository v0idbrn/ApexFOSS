/**
 * Shared keep-awake ownership for athlete feedback surfaces (tempo + interval).
 * Tag-scoped locks: one feature releasing never drops another feature's hold.
 * Fail-soft: missing native module never breaks execution.
 */

const TAG_TEMPO = 'apexfoss-tempo';
const TAG_INTERVAL = 'apexfoss-interval';

const held = new Set<string>();

function tryRequire(): typeof import('expo-keep-awake') | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('expo-keep-awake');
  } catch {
    return null;
  }
}

export function activateKeepAwakeTag(tag: string): void {
  try {
    if (held.has(tag)) return;
    const keepAwake = tryRequire();
    if (keepAwake && typeof keepAwake.activateKeepAwake === 'function') {
      keepAwake.activateKeepAwake(tag);
      held.add(tag);
    }
  } catch {
    // fail-soft
  }
}

export function releaseKeepAwakeTag(tag: string): void {
  try {
    if (!held.has(tag)) return;
    const keepAwake = tryRequire();
    if (keepAwake && typeof keepAwake.deactivateKeepAwake === 'function') {
      keepAwake.deactivateKeepAwake(tag);
    }
    held.delete(tag);
  } catch {
    held.delete(tag);
  }
}

export function activateTempoKeepAwake(): void {
  activateKeepAwakeTag(TAG_TEMPO);
}

export function releaseTempoKeepAwake(): void {
  releaseKeepAwakeTag(TAG_TEMPO);
}

export function activateIntervalKeepAwake(): void {
  activateKeepAwakeTag(TAG_INTERVAL);
}

export function releaseIntervalKeepAwake(): void {
  releaseKeepAwakeTag(TAG_INTERVAL);
}

/** Test hooks */
export function __keepAwakeHeldTagsForTests(): string[] {
  return [...held];
}

export function __resetKeepAwakeForTests(): void {
  held.clear();
}
