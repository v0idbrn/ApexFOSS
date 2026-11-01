import { Database } from '@nozbe/watermelondb';
import { Exercise } from '../data/models';
import { makeDbActions } from '../data/actions';
import { emptyPrescription, type RoutineDraft } from '../types/draft';
import type { RoutineTemplate } from './catalog';

/**
 * Resolves a template's steps against local exercises (seed id first, then
 * name), skipping missing ones, and builds a single-block draft with empty
 * prescriptions. Shared by the Templates screen (no id) and the starter
 * routines (deterministic seed id).
 */
export async function buildTemplateDraft(
  db: Database,
  template: RoutineTemplate,
  displayName: string,
  id: string | null = null,
): Promise<RoutineDraft> {
  const exercises = await db.get<Exercise>('exercises').query().fetch();
  const byId = new Map(exercises.map((e) => [e.id, e]));
  const byName = new Map(exercises.map((e) => [e.name.trim().toLowerCase(), e]));

  const resolved: Exercise[] = [];
  for (const s of template.steps) {
    const hit =
      (s.seedId ? byId.get(s.seedId) : undefined) ??
      byName.get(s.name.trim().toLowerCase());
    if (hit && !resolved.some((r) => r.id === hit.id)) resolved.push(hit);
  }
  if (resolved.length === 0) throw new Error('no template exercises available');

  return {
    id,
    name: displayName,
    blocks: [
      {
        localId: 'b1',
        name: displayName,
        kind: 'normal',
        rounds: 1,
        steps: resolved.map((ex, i) => ({
          localId: `s${i + 1}`,
          exerciseId: ex.id,
          exerciseName: ex.name,
          prescription: emptyPrescription(),
          transition: { type: 'immediate' as const, delayMs: 0 },
        })),
      },
    ],
  };
}

/**
 * Creates a routine from a template: resolves each step against local
 * exercises (seed id first, then name), skips missing exercises, and saves
 * a single-block draft with empty prescriptions for the athlete to fill.
 */
export async function instantiateTemplate(
  db: Database,
  template: RoutineTemplate,
  displayName: string,
): Promise<string> {
  const draft = await buildTemplateDraft(db, template, displayName);
  return makeDbActions(db).saveRoutineDraft(draft);
}
