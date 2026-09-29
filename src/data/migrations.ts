import { schemaMigrations, addColumns, createTable } from '@nozbe/watermelondb/Schema/migrations';

/**
 * v1 → v2 (Phase 2C): optional interval_json on routine_blocks for interval
 * block programming. No other tables change; cursor_json gains an optional
 * runtime field without a further schema migration.
 *
 * v2 → v3 (Phase 2E): new readiness_tests table for tap-test baseline history.
 * Older installs get an empty table; backups without readiness remain valid
 * (optional field in BackupData).
 *
 * v3 → v4 (Phase 2J): new equipment_items table for persistent gym inventory.
 * Older installs start with an empty inventory; backups without equipment
 * remain valid (optional field in BackupData).
 *
 * v4 → v5 (Phase 2J): optional workout_sessions.note for post-workout
 * session notes. Older rows simply read null; backups without a note
 * remain valid (optional field on BackupSession).
 *
 * v5 → v6 (i18n): new app_settings table for device preferences (locale
 * override keyed by `locale`). Older installs start empty → device locale.
 * app_settings is intentionally absent from backups (device preference,
 * not training data) — pre-v5 backup files restore unchanged.
 *
 * v6 → v7 (Phase 3C): optional set_logs.execution_type +
 * set_logs.override_reason for adaptive execution marking. Older rows read
 * null → legacy normal/voided semantics preserved.
 */
export const migrations = schemaMigrations({
  migrations: [
    {
      toVersion: 2,
      steps: [
        addColumns({
          table: 'routine_blocks',
          columns: [{ name: 'interval_json', type: 'string', isOptional: true }],
        }),
      ],
    },
    {
      toVersion: 3,
      steps: [
        createTable({
          name: 'readiness_tests',
          columns: [
            { name: 'tested_at', type: 'number', isIndexed: true },
            { name: 'duration_ms', type: 'number' },
            { name: 'tap_count', type: 'number' },
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
      ],
    },
    {
      toVersion: 4,
      steps: [
        createTable({
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
      ],
    },
    {
      toVersion: 5,
      steps: [
        addColumns({
          table: 'workout_sessions',
          columns: [{ name: 'note', type: 'string', isOptional: true }],
        }),
      ],
    },
    {
      toVersion: 6,
      steps: [
        createTable({
          name: 'app_settings',
          columns: [
            { name: 'key', type: 'string' },
            { name: 'value', type: 'string' },
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
      ],
    },
    {
      toVersion: 7,
      steps: [
        addColumns({
          table: 'set_logs',
          columns: [
            { name: 'execution_type', type: 'string', isOptional: true },
            { name: 'override_reason', type: 'string', isOptional: true },
          ],
        }),
      ],
    },
    {
      // v8 (Phase 4A): programs container + optional routine linkage.
      // Older routines read null program_id = unassigned; backups without
      // programs remain valid (optional BackupData.programs).
      toVersion: 8,
      steps: [
        addColumns({
          table: 'routines',
          columns: [
            { name: 'program_id', type: 'string', isOptional: true, isIndexed: true },
            { name: 'program_order', type: 'number', isOptional: true },
          ],
        }),
        createTable({
          name: 'programs',
          columns: [
            { name: 'name', type: 'string' },
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
      ],
    },
    {
      // v9 (Phase 4B): mesocycles table (ordered phases inside a program) +
      // optional routines.mesocycle_id. Older routines read null = not staged.
      toVersion: 9,
      steps: [
        addColumns({
          table: 'routines',
          columns: [{ name: 'mesocycle_id', type: 'string', isOptional: true, isIndexed: true }],
        }),
        createTable({
          name: 'mesocycles',
          columns: [
            { name: 'name', type: 'string' },
            { name: 'program_id', type: 'string', isIndexed: true },
            { name: 'sort_order', type: 'number' },
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
      ],
    },
    {
      // v10 (Phase 4D): goals table (strength targets per exercise).
      toVersion: 10,
      steps: [
        createTable({
          name: 'goals',
          columns: [
            { name: 'exercise_id', type: 'string', isIndexed: true },
            { name: 'target_weight_grams', type: 'number' },
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
      ],
    },
    {
      // v11 (Phase 4E): body_metrics table (weight and/or waist per entry).
      toVersion: 11,
      steps: [
        createTable({
          name: 'body_metrics',
          columns: [
            { name: 'measured_at', type: 'number', isIndexed: true },
            { name: 'weight_grams', type: 'number', isOptional: true },
            { name: 'waist_mm', type: 'number', isOptional: true },
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
      ],
    },
    {
      // v12: add optional canonical body-measurement columns. Optional columns
      // preserve existing v11 weight/waist rows without a data rewrite; new
      // entries populate measurement_type/side/value/unit.
      toVersion: 12,
      steps: [
        addColumns({
          table: 'body_metrics',
          columns: [
            { name: 'measurement_type', type: 'string', isIndexed: true, isOptional: true },
            { name: 'side', type: 'string', isOptional: true },
            { name: 'value', type: 'number', isOptional: true },
            { name: 'unit', type: 'string', isOptional: true },
          ],
        }),
      ],
    },
    {
      // v13 (1.1.0): optional execution-fidelity + programming-metadata
      // columns. All nullable — legacy rows read null = defaults, no rewrite.
      toVersion: 13,
      steps: [
        addColumns({
          table: 'session_exercises',
          columns: [
            { name: 'exercise_note', type: 'string', isOptional: true },
            { name: 'actual_exercise_id', type: 'string', isOptional: true },
            { name: 'actual_exercise_name', type: 'string', isOptional: true },
            { name: 'substitution_reason', type: 'string', isOptional: true },
          ],
        }),
        addColumns({
          table: 'routine_blocks',
          columns: [{ name: 'block_role', type: 'string', isOptional: true }],
        }),
        addColumns({
          table: 'mesocycles',
          columns: [{ name: 'stage', type: 'string', isOptional: true }],
        }),
      ],
    },
  ],
});
