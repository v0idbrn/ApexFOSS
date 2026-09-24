import { schemaMigrations, addColumns } from '@nozbe/watermelondb/Schema/migrations';

/**
 * v1 → v2 (Phase 2C): optional interval_json on routine_blocks for interval
 * block programming. No other tables change; cursor_json gains an optional
 * runtime field without a further schema migration.
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
  ],
});
