import { ExecutionCursor, RoutineDefinition } from '../types/engine';

export function initialCursor(definition: RoutineDefinition, startedAt = Date.now()): ExecutionCursor {
  const empty = definition.blocks.length === 0 || definition.blocks[0].steps.length === 0;
  return {
    blockIndex: 0,
    stepIndex: 0,
    round: 1,
    setIndex: 1,
    status: empty ? 'completed' : 'active',
    timer: null,
    lastReversible: null,
    startedAt,
  };
}

export function parseCursor(json: string): ExecutionCursor {
  const cursor = JSON.parse(json) as ExecutionCursor;
  if (typeof cursor.blockIndex !== 'number' || typeof cursor.round !== 'number' || typeof cursor.setIndex !== 'number') {
    throw new Error('corrupt cursor_json');
  }
  // Timer pause marker is optional; drop malformed payloads rather than crash.
  if (cursor.timer && (typeof cursor.timer.pausedAt !== 'number' || !Number.isFinite(cursor.timer.pausedAt))) {
    if (cursor.timer.pausedAt !== null && cursor.timer.pausedAt !== undefined) {
      cursor.timer.pausedAt = null;
    }
  }
  // Extra-set accounting is optional; discard malformed payloads rather than crash.
  if (cursor.extraCounts !== undefined && cursor.extraCounts !== null) {
    const counts = cursor.extraCounts;
    if (typeof counts !== 'object' || Array.isArray(counts)) {
      delete cursor.extraCounts;
    } else {
      for (const [key, value] of Object.entries(counts)) {
        if (!/^\d+:\d+:\d+$/.test(key) || typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
          delete (counts as Record<string, unknown>)[key];
        }
      }
      if (Object.keys(counts).length === 0) delete cursor.extraCounts;
    }
  }
  // Interval runtime is optional; discard malformed payloads rather than crash.
  if (cursor.interval && typeof cursor.interval !== 'object') {
    cursor.interval = null;
  } else if (cursor.interval) {
    const iv = cursor.interval;
    if (
      iv.status !== 'running' ||
      typeof iv.startedAt !== 'number' ||
      !Number.isFinite(iv.startedAt) ||
      !iv.config ||
      typeof iv.config.totalMs !== 'number'
    ) {
      cursor.interval = null;
    }
  }
  return cursor;
}
