import { schemaVersion, schema } from './schema';
import { migrations } from './migrations';

/**
 * Migration / data-version sanity for Phase 2J.
 * Goal: prove the installed schema is v5, migrations infrastructure is wired,
 * routine_blocks carries optional interval_json, readiness_tests and
 * equipment_items exist, and workout_sessions carries optional note.
 *
 * WatermelonDB shape: schema.tables is a name→table map;
 * schemaMigrations() returns { sortedMigrations, minVersion, maxVersion, validated }.
 */

describe('migration / data version sanity', () => {
  it('schemaVersion is 5 (Phase 2J equipment inventory + session notes)', () => {
    expect(schemaVersion).toBe(5);
    expect(schema.version).toBe(5);
  });

  it('all eleven release tables are present with expected names', () => {
    const names = Object.keys(schema.tables).sort();
    expect(names).toEqual(
      [
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
    expect(names).toHaveLength(11);
  });

  it('migrations infrastructure is validated; v1→v2 through v4→v5 steps', () => {
    expect(migrations.validated).toBe(true);
    expect(migrations.minVersion).toBe(1);
    expect(migrations.maxVersion).toBe(5);
    expect(migrations.sortedMigrations).toHaveLength(4);
    expect(migrations.sortedMigrations[0].toVersion).toBe(2);
    expect(migrations.sortedMigrations[1].toVersion).toBe(3);
    expect(migrations.sortedMigrations[2].toVersion).toBe(4);
    expect(migrations.sortedMigrations[3].toVersion).toBe(5);
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
});
