import { Database, Q } from '@nozbe/watermelondb';
import { Routine } from '../data/models';
import { emptyPrescription, type RoutineDraft } from '../types/draft';
import { makeDbActions } from '../data/actions';
import { buildTemplateDraft } from './instantiate';
import { templateByKey } from './catalog';
import { strings } from '../constants/strings';

/**
 * Checkpoint 5: three prefilled starter routines seeded into a fresh install so
 * an athlete can begin training without authoring a plan. Unlike the Templates
 * screen (structure-only skeletons with empty prescriptions), these carry real,
 * editable prescriptions (sets/reps/weight/RIR/rest) chosen as sensible
 * starting points — not personalized, not a substitute for the user's program.
 *
 * Ids are deterministic (D-065 pattern): seeding inserts only the missing ids,
 * so an existing install receives starters it never had, and a routine the user
 * edited or deleted is never overwritten. These three routines are app content,
 * not user data.
 */
export interface StarterRoutine {
  /** Deterministic seed id (primary key for repair and learn exclusion). */
  id: string;
  /** Template whose structure this starter fills (single source of exercise order). */
  templateKey: 'fullBody' | 'pushDay' | 'legsDay';
  /** Prescription per step index, aligned to the template's step order. */
  steps: Array<Partial<RoutineDraft['blocks'][0]['steps'][0]['prescription']>>;
  /** Transition after each step index (default: rest 90s). */
  transitions?: Array<{ type: 'rest' | 'immediate' | 'auto_advance'; delayMs: number }>;
}

const REST90 = { type: 'rest' as const, delayMs: 90_000 };

export const STARTER_ROUTINE_IDS: string[] = [
  'seed_routine_full_body',
  'seed_routine_push_day',
  'seed_routine_legs_day',
];

export const STARTER_ROUTINES: StarterRoutine[] = [
  {
    id: 'seed_routine_full_body',
    templateKey: 'fullBody',
    steps: [
      // Back Squat — main strength driver.
      { targetSets: 4, targetRepsMin: 5, targetRepsMax: 5, targetWeightGrams: 60_000, targetRir: 2 },
      // Bench Press — horizontal push.
      { targetSets: 4, targetRepsMin: 6, targetRepsMax: 6, targetWeightGrams: 40_000, targetRir: 2 },
      // Barbell Row — horizontal pull, balanced against bench.
      { targetSets: 3, targetRepsMin: 8, targetRepsMax: 8, targetWeightGrams: 40_000, targetRir: 2 },
    ],
  },
  {
    id: 'seed_routine_push_day',
    templateKey: 'pushDay',
    steps: [
      // Bench Press — heavy horizontal push.
      { targetSets: 4, targetRepsMin: 5, targetRepsMax: 5, targetWeightGrams: 50_000, targetRir: 2 },
      // Overhead Press — vertical push.
      { targetSets: 3, targetRepsMin: 6, targetRepsMax: 6, targetWeightGrams: 30_000, targetRir: 2 },
      // Dip — bodyweight finisher, rep-range work.
      { targetSets: 3, targetRepsMin: 8, targetRepsMax: 10, targetRir: 2 },
    ],
  },
  {
    id: 'seed_routine_legs_day',
    templateKey: 'legsDay',
    steps: [
      // Back Squat — knee-dominant strength.
      { targetSets: 4, targetRepsMin: 5, targetRepsMax: 5, targetWeightGrams: 70_000, targetRir: 2 },
      // Romanian Deadlift — hip-dominant hinge.
      { targetSets: 3, targetRepsMin: 8, targetRepsMax: 8, targetWeightGrams: 60_000, targetRir: 2 },
      // Lunge — unilateral accessory.
      { targetSets: 3, targetRepsMin: 10, targetRepsMax: 12, targetRir: 2 },
    ],
  },
];

/**
 * Seed the three starter routines, inserting only the ids that were never
 * created. Returns the number of routines created. Existing user routines are
 * never touched, and a deletion wins over repair: a soft-deleted row keeps its
 * id in the unique index on every adapter, so a deleted starter stays deleted
 * (the true behavior for exercise starters as well — documented in D-066).
 */
export async function seedStarterRoutinesIfEmpty(db: Database): Promise<number> {
  const actions = makeDbActions(db);
  // Ensure the underlying starter exercises exist before resolving references.
  await actions.seedExercisesIfEmpty();

  const existing = await db
    .get('routines')
    .query(Q.where('id', Q.oneOf(STARTER_ROUTINE_IDS)))
    .fetch();
  const present = new Set(existing.map((r) => r.id));

  let created = 0;
  for (const starter of STARTER_ROUTINES) {
    if (present.has(starter.id)) continue;
    const template = templateByKey(starter.templateKey);
    if (!template) continue;

    // Localized routine name, resolved from the active locale at seed time.
    const displayName = strings.templates[starter.templateKey];
    // Resolve exercises BEFORE creating any row: a template whose exercises
    // are all gone must not leave an empty starter routine behind.
    let draft: RoutineDraft;
    try {
      draft = await buildTemplateDraft(db, template, displayName, starter.id);
    } catch {
      continue;
    }
    const prefilled: RoutineDraft = {
      ...draft,
      blocks: draft.blocks.map((b) => ({
        ...b,
        steps: b.steps.map((s, i) => ({
          ...s,
          prescription: { ...emptyPrescription(), ...starter.steps[i] },
          transition: starter.transitions?.[i] ?? REST90,
        })),
      })),
    };
    // Pre-create the row with its deterministic id in its own write:
    // saveRoutineDraft's update path requires an existing routine, and
    // prepareCreateFromDirtyRaw honors an explicit id (create() would generate
    // its own). A soft-deleted row still owns its id, so this batch throws for
    // a deleted starter — treated as "the athlete's delete wins": skip it and
    // keep seeding the remaining starters instead of aborting the run.
    let rowCreated = false;
    await db.write(async () => {
      try {
        const rec = db.get<Routine>('routines').prepareCreateFromDirtyRaw({
          id: starter.id,
          name: displayName,
          created_at: Date.now(),
          updated_at: Date.now(),
        });
        await db.batch(rec);
        rowCreated = true;
      } catch {
        // Id held by a soft-deleted row — skip this starter.
      }
    });
    if (!rowCreated) continue;
    await actions.saveRoutineDraft(prefilled);
    created += 1;
  }
  return created;
}
