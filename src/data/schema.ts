import { appSchema, tableSchema } from '@nozbe/watermelondb';

/**
 * ApexFOSS schema v1. Units: grams / milliseconds / millimeters (integers only).
 * Canonical execution state: workout_sessions.cursor_json (+ definition_json snapshot).
 * session_status / timer_expires_at / current_* are derived caches only (cursor_json wins).
 */
export const schemaVersion = 1;

export const schema = appSchema({
  version: schemaVersion,
  tables: [
    tableSchema({
      name: 'exercises',
      columns: [
        { name: 'name', type: 'string', isIndexed: true },
        { name: 'category', type: 'string' },
        { name: 'equipment', type: 'string' },
        { name: 'metric_flags', type: 'number' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'routines',
      columns: [
        { name: 'name', type: 'string' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'routine_blocks',
      columns: [
        { name: 'routine_id', type: 'string', isIndexed: true },
        { name: 'name', type: 'string' },
        { name: 'block_kind', type: 'string' },
        { name: 'sort_order', type: 'number' },
        { name: 'rounds', type: 'number' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'routine_block_steps',
      columns: [
        { name: 'block_id', type: 'string', isIndexed: true },
        { name: 'sort_order', type: 'number' },
        { name: 'step_role', type: 'string' },
        { name: 'exercise_id', type: 'string', isIndexed: true, isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'routine_exercise_prescriptions',
      columns: [
        { name: 'step_id', type: 'string', isIndexed: true },
        { name: 'target_sets', type: 'number', isOptional: true },
        { name: 'target_reps_min', type: 'number', isOptional: true },
        { name: 'target_reps_max', type: 'number', isOptional: true },
        { name: 'target_duration_ms', type: 'number', isOptional: true },
        { name: 'target_weight_grams', type: 'number', isOptional: true },
        { name: 'target_rir', type: 'number', isOptional: true },
        { name: 'tempo_eccentric_ms', type: 'number', isOptional: true },
        { name: 'tempo_pause_bottom_ms', type: 'number', isOptional: true },
        { name: 'tempo_concentric_ms', type: 'number', isOptional: true },
        { name: 'tempo_pause_top_ms', type: 'number', isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'block_transitions',
      columns: [
        { name: 'block_id', type: 'string', isIndexed: true },
        { name: 'from_step_id', type: 'string', isIndexed: true },
        { name: 'to_step_id', type: 'string', isIndexed: true, isOptional: true },
        { name: 'delay_ms', type: 'number' },
        { name: 'transition_type', type: 'string' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'workout_sessions',
      columns: [
        { name: 'routine_id', type: 'string', isIndexed: true, isOptional: true },
        { name: 'name', type: 'string' },
        { name: 'started_at', type: 'number' },
        { name: 'ended_at', type: 'number', isOptional: true },
        { name: 'session_status', type: 'string', isIndexed: true },
        { name: 'definition_json', type: 'string' },
        { name: 'cursor_json', type: 'string' },
        { name: 'current_block_index', type: 'number' },
        { name: 'current_step_id', type: 'string', isOptional: true },
        { name: 'current_round', type: 'number' },
        { name: 'current_set_index', type: 'number' },
        { name: 'timer_expires_at', type: 'number', isIndexed: true, isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'session_exercises',
      columns: [
        { name: 'session_id', type: 'string', isIndexed: true },
        { name: 'exercise_id', type: 'string', isIndexed: true, isOptional: true },
        { name: 'exercise_name', type: 'string' },
        { name: 'block_index', type: 'number' },
        { name: 'order_index', type: 'number' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'set_logs',
      columns: [
        { name: 'session_exercise_id', type: 'string', isIndexed: true },
        { name: 'block_index', type: 'number' },
        { name: 'step_index', type: 'number' },
        { name: 'round', type: 'number' },
        { name: 'set_index', type: 'number' },
        { name: 'weight_grams', type: 'number', isOptional: true },
        { name: 'reps', type: 'number', isOptional: true },
        { name: 'duration_ms', type: 'number', isOptional: true },
        { name: 'distance_mm', type: 'number', isOptional: true },
        { name: 'rir', type: 'number', isOptional: true },
        { name: 'is_completed', type: 'number' },
        { name: 'completed_at', type: 'number', isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
  ],
});
