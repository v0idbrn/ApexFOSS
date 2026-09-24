import { schemaVersion, schema } from './schema';
import { migrations } from './migrations';

/**
 * Migration / data-version sanity for the Day 5 release.
 * Goal: prove the installed schema is v1, migrations infrastructure is wired,
 * and a future v1→v2 path can be added without redesign — no v2 invented today.
 *
 * WatermelonDB shape: schema.tables is a name→table map;
 * schemaMigrations() returns { sortedMigrations, minVersion, maxVersion, validated }.
 */

describe('migration / data version sanity', () => {
  it('schemaVersion is 1 (initial release schema)', () => {
    expect(schemaVersion).toBe(1);
    expect(schema.version).toBe(1);
  });

  it('all nine release tables are present with expected names', () => {
    const names = Object.keys(schema.tables).sort();
    expect(names).toEqual(
      [
        'block_transitions',
        'exercises',
        'routine_block_steps',
        'routine_blocks',
        'routine_exercise_prescriptions',
        'routines',
        'set_logs',
        'session_exercises',
        'workout_sessions',
      ].sort(),
    );
    expect(names).toHaveLength(9);
  });

  it('migrations infrastructure is validated; empty list = fresh v1 install only', () => {
    expect(migrations.validated).toBe(true);
    expect(migrations.minVersion).toBe(1);
    expect(migrations.maxVersion).toBe(1);
    // Day 5 deliberately does NOT invent a v2 schema — migration steps stay empty for v1.
    expect(migrations.sortedMigrations).toHaveLength(0);
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
