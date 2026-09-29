import { appSchema, tableSchema } from '@nozbe/watermelondb';

/**
 * ApexFOSS schema. Units: grams / milliseconds / millimeters (integers only).
 * Canonical execution state: workout_sessions.cursor_json (+ definition_json snapshot).
 * session_status / timer_expires_at / current_* are derived caches only (cursor_json wins).
 * v2 (Phase 2C): optional routine_blocks.interval_json for interval block programming.
 * v3 (Phase 2E): readiness_tests for tap-test baseline history.
 * v4 (Phase 2J): equipment_items for persistent gym inventory (per-side plates etc).
 * v5 (Phase 2J): optional workout_sessions.note — post-workout session notes.
 * v6 (i18n): app_settings for device preferences (locale override). Not backed up.
 * v7 (Phase 3C): optional set_logs.execution_type + set_logs.override_reason
 * for adaptive execution (skipped/extra/drop/modified marking + athlete-stated
 * reason). Older rows read null ��' treated as legacy normal/voided rows.
 * v8 (Phase 4A): programs table (higher-level training structure) plus
 * optional routines.program_id / routines.program_order linking an ordered
 * list of existing routines to a program. Older rows read null - unassigned.
 * v9 (Phase 4B): mesocycles table (ordered training phases inside a program)
 * plus optional routines.mesocycle_id. Older rows read null - not staged.
 * v10 (Phase 4D): goals table (athlete-declared strength targets per
 * exercise; target e1RM in grams). Achieved state is derived, never stored.
 * v11 (Phase 4E): body_metrics table (body weight grams + waist mm at an
 * absolute timestamp; at least one value per row). Logging only - no
 * medical interpretation.
  * v12: optional canonical body-measurement columns alongside legacy
  * weight_grams/waist_mm. New entries populate measurement_type/side/value/unit;
  * legacy rows remain readable through analytics normalization.
  * v13 (1.1.0): optional execution-fidelity columns (session_exercises note +
  * explicit substitution actuals), optional routine_blocks.block_role
  * (main/warmup/cooldown metadata) and mesocycles.stage (normal/deload
  * metadata). All nullable; legacy rows read null = defaults.
  */
export const schemaVersion = 13;

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
        { name: 'program_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'program_order', type: 'number', isOptional: true },
        { name: 'mesocycle_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'programs',
      columns: [
        { name: 'name', type: 'string' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'mesocycles',
      columns: [
        { name: 'name', type: 'string' },
        { name: 'program_id', type: 'string', isIndexed: true },
        { name: 'sort_order', type: 'number' },
        { name: 'stage', type: 'string', isOptional: true },
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
        { name: 'block_role', type: 'string', isOptional: true },
        { name: 'sort_order', type: 'number' },
        { name: 'rounds', type: 'number' },
        { name: 'interval_json', type: 'string', isOptional: true },
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
        { name: 'note', type: 'string', isOptional: true },
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
        { name: 'exercise_note', type: 'string', isOptional: true },
        { name: 'actual_exercise_id', type: 'string', isOptional: true },
        { name: 'actual_exercise_name', type: 'string', isOptional: true },
        { name: 'substitution_reason', type: 'string', isOptional: true },
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
        { name: 'execution_type', type: 'string', isOptional: true },
        { name: 'override_reason', type: 'string', isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'readiness_tests',
      columns: [
        { name: 'tested_at', type: 'number', isIndexed: true },
        { name: 'duration_ms', type: 'number' },
        { name: 'tap_count', type: 'number' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'equipment_items',
      columns: [
        { name: 'name', type: 'string' },
        { name: 'weight_grams', type: 'number' },
        { name: 'quantity', type: 'number' },
        { name: 'per_side', type: 'number' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'goals',
      columns: [
        { name: 'exercise_id', type: 'string', isIndexed: true },
        { name: 'target_weight_grams', type: 'number' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'body_metrics',
      columns: [
        { name: 'measured_at', type: 'number', isIndexed: true },
        { name: 'measurement_type', type: 'string', isIndexed: true, isOptional: true },
        { name: 'side', type: 'string', isOptional: true },
        { name: 'value', type: 'number', isOptional: true },
        { name: 'unit', type: 'string', isOptional: true },
        { name: 'weight_grams', type: 'number', isOptional: true },
        { name: 'waist_mm', type: 'number', isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'app_settings',
      columns: [
        { name: 'key', type: 'string' },
        { name: 'value', type: 'string' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
  ],
});
