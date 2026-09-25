import { Database } from '@nozbe/watermelondb';
import { WorkoutSession } from './models';

/**
 * Session workout notes (schema v5). Notes are free text attached to a
 * completed workout: written from the post-workout summary screen, editable
 * later from History → Session. Not part of the immutable set-log snapshot.
 */

/** Hard cap on stored note length (characters). Longer input is truncated. */
export const NOTE_MAX_LENGTH = 2000;

/** Trim + clamp a note. Empty / whitespace-only input becomes null. */
export function normalizeNote(note: string): string | null {
  const trimmed = note.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, NOTE_MAX_LENGTH);
}

/** Read a session's note. Missing / unreadable session → null. */
export async function loadSessionNote(db: Database, sessionId: string): Promise<string | null> {
  try {
    const session = await db.get<WorkoutSession>('workout_sessions').find(sessionId);
    return session.note ?? null;
  } catch {
    return null;
  }
}

/**
 * Persist a session note (full replace). Returns the stored value.
 * Rejects when the session row no longer exists.
 */
export async function saveSessionNote(db: Database, sessionId: string, note: string): Promise<string | null> {
  const session = await db.get<WorkoutSession>('workout_sessions').find(sessionId);
  const value = normalizeNote(note);
  await db.write(async () => {
    await session.update((rec) => {
      rec.note = value;
    });
  });
  return value;
}
