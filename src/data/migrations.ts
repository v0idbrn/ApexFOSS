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
  ],
});
