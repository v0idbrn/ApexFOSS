import { schemaVersion, schema } from './schema';
import { migrations } from './migrations';

/**
 * Migration / data-version sanity for Phase 2J + i18n (schema v6) + Phase 3C (schema v7).
 * Goal: prove the installed schema is v7, migrations infrastructure is wired,
 * routine_blocks carries optional interval_json, readiness_tests,
 * equipment_items and app_settings exist, workout_sessions carries
 * optional note, and set_logs carries optional execution metadata.
 *
 * WatermelonDB shape: schema.tables is a name→table map;
 * schemaMigrations() returns { sortedMigrations, minVersion, maxVersion, validated }.
 */

describe('migration / data version sanity', () => {
  it('schemaVersion is 7 (Phase 3C adaptive execution metadata)', () => {
    expect(schemaVersion).toBe(7);
    expect(schema.version).toBe(7);
  });

  it('all twelve release tables are present with expected names', () => {
    const names = Object.keys(schema.tables).sort();
    expect(names).toEqual(
      [
        'app_settings',
        'block_transitions',
        'equipment_items',
        'exercises',
        'readiness_tests',
        'routine_block_steps',
        'routine_blocks',
        'routine_exercise_prescriptions',
        'routines',
        'set_logs',
        'session_exercises',
        'workout_sessions',
      ].sort(),
    );
    expect(names).toHaveLength(12);
  });

  it('migrations infrastructure is validated; v1→v2 through v6→v7 steps', () => {
    expect(migrations.validated).toBe(true);
    expect(migrations.minVersion).toBe(1);
    expect(migrations.maxVersion).toBe(7);
    expect(migrations.sortedMigrations).toHaveLength(6);
    expect(migrations.sortedMigrations[0].toVersion).toBe(2);
    expect(migrations.sortedMigrations[1].toVersion).toBe(3);
    expect(migrations.sortedMigrations[2].toVersion).toBe(4);
    expect(migrations.sortedMigrations[3].toVersion).toBe(5);
    expect(migrations.sortedMigrations[4].toVersion).toBe(6);
    expect(migrations.sortedMigrations[5].toVersion).toBe(7);
  });

  it('app_settings has key/value + timestamps (schema v6)', () => {
    const t = schema.tables['app_settings'];
    expect(t).toBeDefined();
    const byName = new Map(t.columnArray.map((c) => [c.name, c]));
    expect(byName.get('key')?.type).toBe('string');
    expect(byName.get('value')?.type).toBe('string');
    expect(byName.get('created_at')?.type).toBe('number');
    expect(byName.get('updated_at')?.type).toBe('number');
  });

  it('routine_blocks has optional interval_json', () => {
    const t = schema.tables['routine_blocks'];
    expect(t).toBeDefined();
    const byName = new Map(t.columnArray.map((c) => [c.name, c]));
    expect(byName.get('interval_json')?.isOptional).toBe(true);
    expect(byName.get('interval_json')?.type).toBe('string');
  });

  it('readiness_tests has required columns', () => {
    const t = schema.tables['readiness_tests'];
    expect(t).toBeDefined();
    const byName = new Map(t.columnArray.map((c) => [c.name, c]));
    expect(byName.get('tested_at')?.type).toBe('number');
    expect(byName.get('duration_ms')?.type).toBe('number');
    expect(byName.get('tap_count')?.type).toBe('number');
  });

  it('equipment_items has required columns for persistent inventory', () => {
    const t = schema.tables['equipment_items'];
    expect(t).toBeDefined();
    const byName = new Map(t.columnArray.map((c) => [c.name, c]));
    expect(byName.get('name')?.type).toBe('string');
    expect(byName.get('weight_grams')?.type).toBe('number');
    expect(byName.get('quantity')?.type).toBe('number');
    expect(byName.get('per_side')?.type).toBe('number');
    expect(byName.get('created_at')?.type).toBe('number');
    expect(byName.get('updated_at')?.type).toBe('number');
  });

  it('critical columns exist on workout_sessions (cursor is authoritative)', () => {
    const t = schema.tables['workout_sessions'];
    expect(t).toBeDefined();
    const cols = t.columnArray.map((c) => c.name);
    for (const required of [
      'definition_json',
      'cursor_json',
      'session_status',
      'started_at',
      'ended_at',
      'timer_expires_at',
    ]) {
      expect(cols).toContain(required);
    }
  });

  it('workout_sessions has optional note (schema v5 session notes)', () => {
    const t = schema.tables['workout_sessions'];
    const byName = new Map(t.columnArray.map((c) => [c.name, c]));
    expect(byName.get('note')?.isOptional).toBe(true);
    expect(byName.get('note')?.type).toBe('string');
  });

  it('set_logs retains nullable optional measurement columns', () => {
    const t = schema.tables['set_logs'];
    const byName = new Map(t.columnArray.map((c) => [c.name, c]));
    expect(byName.get('weight_grams')?.isOptional).toBe(true);
    expect(byName.get('reps')?.isOptional).toBe(true);
    expect(byName.get('duration_ms')?.isOptional).toBe(true);
    expect(byName.get('rir')?.isOptional).toBe(true);
    expect(byName.get('is_completed')?.isOptional).toBeFalsy();
  });

  it('set_logs has optional execution metadata (schema v7 adaptive execution)', () => {
    const t = schema.tables['set_logs'];
    const byName = new Map(t.columnArray.map((c) => [c.name, c]));
    expect(byName.get('execution_type')?.isOptional).toBe(true);
    expect(byName.get('execution_type')?.type).toBe('string');
    expect(byName.get('override_reason')?.isOptional).toBe(true);
    expect(byName.get('override_reason')?.type).toBe('string');
  });
});
