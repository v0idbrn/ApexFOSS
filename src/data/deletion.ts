import { Database } from '@nozbe/watermelondb';
import { cancelTimerNotification } from '../notifications';
import { useTimerStore } from '../state/timerStore';
import { useActiveSessionStore } from '../state/activeSessionStore';

/**
 * Explicit local-data deletion (docs/DECISIONS.md D-037, spec section 14).
 *
 * Semantics:
 * - Permanently destroys every row of every app table (children first).
 *   `destroyPermanently` removes rows outright (no Watermelon tombstones),
 *   so no deleted content lingers in the local database.
 * - This is NOT forensic erasure: flash storage may retain old pages until
 *   the OS reuses them. Do not advertise secure deletion.
 * - Clears all related runtime state: rest-timer notification (cancel-all),
 *   zustand timer mirror, active-session mirror. Orphans cannot survive
 *   because whole tables are destroyed.
 * - Starter exercises re-seed on next launch (app content, not user data).
 */

export interface LocalDataCounts {
  exercises: number;
  routines: number;
  sessions: number;
  setLogs: number;
  readinessTests: number;
}

/** Children before parents — order matters only for clarity (full wipe). */
const WIPE_TABLES = [
  'set_logs',
  'session_exercises',
  'workout_sessions',
  'readiness_tests',
  'block_transitions',
  'routine_exercise_prescriptions',
  'routine_block_steps',
  'routine_blocks',
  'routines',
  'exercises',
] as const;

export async function countLocalData(db: Database): Promise<LocalDataCounts> {
  const [exercises, routines, sessions, setLogs, readinessTests] = await Promise.all([
    db.get('exercises').query().fetchCount(),
    db.get('routines').query().fetchCount(),
    db.get('workout_sessions').query().fetchCount(),
    db.get('set_logs').query().fetchCount(),
    db.get('readiness_tests').query().fetchCount(),
  ]);
  return { exercises, routines, sessions, setLogs, readinessTests };
}

/** DB-only wipe. Prefer `deleteAllLocalData` from UI code. */
export async function wipeAllLocalData(db: Database): Promise<LocalDataCounts> {
  const deleted = await countLocalData(db);
  await db.write(async () => {
    for (const table of WIPE_TABLES) {
      const rows = await db.get(table).query().fetch();
      for (const row of rows) {
        await row.destroyPermanently();
      }
    }
  });
  return deleted;
}

/**
 * Full local wipe: database + timer notification + runtime mirrors.
 * Call only after explicit destructive user confirmation.
 */
export async function deleteAllLocalData(db: Database): Promise<LocalDataCounts> {
  const deleted = await wipeAllLocalData(db);
  useTimerStore.getState().clear();
  useActiveSessionStore.getState().setSession(null, null);
  await cancelTimerNotification(null);
  return deleted;
}
