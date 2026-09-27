import { SEED_EXERCISES } from '../../scripts/seed-exercises';

/**
 * Phase 4F: routine templates — structure-only skeletons (exercise slots,
 * one block, empty prescriptions). No invented sets, reps or loads: the
 * athlete fills prescriptions in the routine editor.
 */

export type TemplateKey = 'fullBody' | 'pushDay' | 'pullDay' | 'legsDay';

export interface TemplateStep {
  /** Deterministic seed id (primary resolution). */
  seedId: string;
  /** Display/fallback name; also the i18n-free identifier if a seed was renamed locally. */
  name: string;
}

export interface RoutineTemplate {
  key: TemplateKey;
  steps: TemplateStep[];
}

const seedIdByName = new Map(SEED_EXERCISES.map((s) => [s.name, s.id]));

const step = (name: string): TemplateStep => ({
  seedId: seedIdByName.get(name) ?? '',
  name,
});

export const ROUTINE_TEMPLATES: RoutineTemplate[] = [
  {
    key: 'fullBody',
    steps: [step('Back Squat'), step('Bench Press'), step('Barbell Row')],
  },
  {
    key: 'pushDay',
    steps: [step('Bench Press'), step('Overhead Press'), step('Dip')],
  },
  {
    key: 'pullDay',
    steps: [step('Barbell Row'), step('Pull-up'), step('Romanian Deadlift')],
  },
  {
    key: 'legsDay',
    steps: [step('Back Squat'), step('Romanian Deadlift'), step('Lunge')],
  },
];

export function templateByKey(key: TemplateKey): RoutineTemplate | undefined {
  return ROUTINE_TEMPLATES.find((t) => t.key === key);
}
