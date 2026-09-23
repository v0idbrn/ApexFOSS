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
  return cursor;
}
