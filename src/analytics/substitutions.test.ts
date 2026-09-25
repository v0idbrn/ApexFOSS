import {
  equipmentClassOf,
  movementPatternOf,
  rankSubstitutions,
  SUBSTITUTION_WEIGHTS,
  type SubstitutionExercise,
} from './substitutions';
import type { Contributions, MuscleId } from './muscles';

const contributions = (...entries: Array<[MuscleId, number]>): Contributions => entries as Contributions;

const ex = (
  id: string | null,
  name: string,
  category: string,
  equipment: string,
  contrib: Contributions | null = null,
  metricFlags = 3,
): SubstitutionExercise => ({ id, name, category, equipment, metricFlags, contributions: contrib });

const quadsHeavy = contributions(['quads', 5500], ['glutes', 3000], ['adductors', 500], ['lower_back', 500], ['hamstrings', 500]);
const quadsSimilar = contributions(['quads', 6500], ['glutes', 2000], ['lower_back', 500], ['adductors', 500], ['abs', 500]);
const chestHeavy = contributions(['chest', 6000], ['front_delts', 2000], ['triceps', 2000]);

describe('movementPatternOf (Phase 2J substitutions)', () => {
  it('maps common movement names to product patterns', () => {
    expect(movementPatternOf('Back Squat', 'legs')).toBe('squat');
    expect(movementPatternOf('Leg Press', 'legs')).toBe('squat');
    expect(movementPatternOf('Romanian Deadlift', 'legs')).toBe('hinge');
    expect(movementPatternOf('Bulgarian Split Squat', 'legs')).toBe('lunge'); // before generic squat
    expect(movementPatternOf('Walking Lunge', 'legs')).toBe('lunge');
    expect(movementPatternOf('Bench Press', 'push')).toBe('press_horizontal');
    expect(movementPatternOf('Overhead Press', 'push')).toBe('press_vertical');
    expect(movementPatternOf('Pull-Up', 'pull')).toBe('pull_vertical');
    expect(movementPatternOf('Seated Cable Row', 'pull')).toBe('pull_horizontal');
    expect(movementPatternOf('Plank', 'core')).toBe('core_brace');
    expect(movementPatternOf('Dumbbell Curl', 'pull')).toBe('isolation_pull');
    expect(movementPatternOf('Triceps Pushdown', 'push')).toBe('isolation_push');
    expect(movementPatternOf('Leg Extension', 'legs')).toBe('isolation_leg');
    expect(movementPatternOf('Farmer Walk', 'other')).toBe('carry');
  });

  it('treats cardio category as cardio regardless of name', () => {
    expect(movementPatternOf('5k Steady', 'cardio')).toBe('cardio');
    expect(movementPatternOf('Row Erg Intervals', 'cardio')).toBe('cardio');
  });

  it('returns unknown for unmapped custom names', () => {
    expect(movementPatternOf('My Custom Move', 'custom')).toBe('unknown');
    expect(movementPatternOf('', '')).toBe('unknown');
  });

  it('prefers cardio name keywords over pull patterns', () => {
    expect(movementPatternOf('Rowing Machine', 'other')).toBe('cardio');
    expect(movementPatternOf('Seated Row', 'pull')).toBe('pull_horizontal');
  });
});

describe('equipmentClassOf (Phase 2J substitutions)', () => {
  it('classifies common equipment strings', () => {
    expect(equipmentClassOf('Barbell')).toBe('barbell');
    expect(equipmentClassOf('Olympic Bar')).toBe('barbell');
    expect(equipmentClassOf('Dumbbell')).toBe('dumbbell');
    expect(equipmentClassOf('Kettlebell')).toBe('kettlebell');
    expect(equipmentClassOf('Cable')).toBe('cable');
    expect(equipmentClassOf('Smith Machine')).toBe('machine');
    expect(equipmentClassOf('Resistance Band')).toBe('band');
    expect(equipmentClassOf('Bodyweight')).toBe('bodyweight');
  });

  it('maps empty equipment to bodyweight and unknown strings to other', () => {
    expect(equipmentClassOf('')).toBe('bodyweight');
    expect(equipmentClassOf('   ')).toBe('bodyweight');
    expect(equipmentClassOf('Mystery Gear')).toBe('other');
  });
});

describe('rankSubstitutions (Phase 2J substitutions)', () => {
  const target = ex('seed_back_squat', 'Back Squat', 'legs', 'barbell', quadsHeavy);
  const frontSquat = ex('seed_front_squat', 'Front Squat', 'legs', 'barbell', quadsSimilar);
  const bench = ex('seed_bench', 'Bench Press', 'push', 'barbell', chestHeavy);
  const treadmill = ex('seed_run', 'Treadmill Run', 'cardio', 'machine', null);

  it('ranks the closest match first with ordered reasons', () => {
    const ranked = rankSubstitutions(target, [bench, treadmill, frontSquat]);
    expect(ranked[0].exercise.name).toBe('Front Squat');
    expect(ranked[0].reasons).toEqual(['pattern', 'equipment', 'muscles', 'category']);
    expect(ranked[0].score).toBe(
      SUBSTITUTION_WEIGHTS.pattern + SUBSTITUTION_WEIGHTS.equipment + SUBSTITUTION_WEIGHTS.category + Math.round((Math.min(5500, 6500) + Math.min(3000, 2000) + Math.min(500, 500) + Math.min(500, 500)) / 10_000 * SUBSTITUTION_WEIGHTS.muscles),
    );
  });

  it('drops candidates with no matching signal', () => {
    const ranked = rankSubstitutions(target, [treadmill]);
    expect(ranked).toEqual([]);
  });

  it('keeps partial matches with only their matched reasons', () => {
    const ranked = rankSubstitutions(target, [bench]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].exercise.name).toBe('Bench Press');
    expect(ranked[0].reasons).toEqual(['equipment']);
    expect(ranked[0].score).toBe(SUBSTITUTION_WEIGHTS.equipment);
  });

  it('scores muscle overlap when patterns and equipment differ', () => {
    const goodMorning = ex('a', 'Good Morning', 'legs', 'barbell', quadsHeavy);
    const backExtension = ex('b', '45° Back Extension', 'other', '', contributions(['lower_back', 5000], ['glutes', 3000], ['hamstrings', 2000]));
    const ranked = rankSubstitutions(goodMorning, [backExtension]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].reasons).toEqual(['muscles']);
    // shared: lower_back 500 + glutes 3000 + hamstrings 500 = 4000 bp → 120 pts
    expect(ranked[0].score).toBe(120);
  });

  it('never scores an unknown pattern but still allows equipment/category matches', () => {
    const custom = ex('x', 'Mystery Move', 'legs', 'barbell', null);
    const ranked = rankSubstitutions(custom, [frontSquat]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].reasons).toEqual(['equipment', 'category']);
    expect(ranked[0].reasons).not.toContain('pattern');
  });

  it('excludes the target itself by id and by name/category/equipment identity', () => {
    expect(rankSubstitutions(target, [target])).toEqual([]);
    const sameByAttrs = ex(null, 'Back Squat', 'legs', 'barbell', quadsHeavy);
    expect(rankSubstitutions({ ...target, id: null }, [sameByAttrs])).toEqual([]);
  });

  it('honors the limit and rejects non-positive limits', () => {
    const many = [
      ex('1', 'Front Squat', 'legs', 'barbell', quadsSimilar),
      ex('2', 'Goblet Squat', 'legs', 'dumbbell', quadsSimilar),
      ex('3', 'Hack Squat', 'legs', 'machine', quadsSimilar),
      ex('4', 'Pause Squat', 'legs', 'barbell', quadsHeavy),
      ex('5', 'Squat Jump', 'legs', 'bodyweight', quadsHeavy),
      ex('6', 'Belt Squat', 'legs', 'machine', quadsHeavy),
    ];
    expect(rankSubstitutions(target, many, { limit: 3 })).toHaveLength(3);
    expect(rankSubstitutions(target, many, { limit: 0 })).toEqual([]);
    expect(rankSubstitutions(target, many, { limit: 99 })).toHaveLength(6);
  });

  it('breaks score ties deterministically by name then id', () => {
    const a = ex('z', 'AAA Squat', 'legs', 'barbell', null);
    const b = ex('a', 'AAA Squat', 'legs', 'barbell', null); // same name, different id
    const c = ex('c', 'ZZZ Squat', 'legs', 'barbell', null);
    const ranked = rankSubstitutions(target, [c, b, a]);
    expect(ranked.map((r) => `${r.exercise.name}#${r.exercise.id}`)).toEqual(['AAA Squat#a', 'AAA Squat#z', 'ZZZ Squat#c']);
  });

  it('is deterministic for identical input', () => {
    const candidates = [bench, frontSquat, treadmill];
    expect(rankSubstitutions(target, candidates)).toEqual(rankSubstitutions(target, candidates));
  });

  it('returns an empty list for empty candidates', () => {
    expect(rankSubstitutions(target, [])).toEqual([]);
  });
});
