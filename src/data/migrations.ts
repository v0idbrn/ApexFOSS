import { schemaMigrations } from '@nozbe/watermelondb/Schema/migrations';

/** v1 is the initial schema. Day 5 adds a dummy v1→v2 migration and a test for it. */
export const migrations = schemaMigrations({
  migrations: [],
});
