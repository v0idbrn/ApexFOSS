import { schemaMigrations } from '@nozbe/watermelondb/Schema/migrations';

/**
 * v1 is the initial (and only) release schema for v0.1.0.
 * Migration list stays empty on purpose: Day 5 does not invent a v2.
 * Future schema changes append `{ from: 1, to: 2, ... }` here — infrastructure is tested
 * in src/data/migration.test.ts.
 */
export const migrations = schemaMigrations({
  migrations: [],
});
