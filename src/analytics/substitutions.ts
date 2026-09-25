import type { Contributions } from './muscles';

/**
 * Exercise substitution foundation (Phase 2J §…).
 * Pure, deterministic ranking over three product signals:
 * 1. movement pattern (name/category keyword heuristics — product vocabulary,
 *    not sports science),
 * 2. equipment class,
 * 3. muscle overlap using the existing basis-point contribution maps.
 * No React, no DB, no IO. Ties break by name then id (stable everywhere).
 */

export type MovementPattern =
  | 'squat'
  | 'hinge'
  | 'lunge'
  | 'press_vertical'
  | 'press_horizontal'
  | 'pull_vertical'
  | 'pull_horizontal'
  | 'core_brace'
  | 'carry'
  | 'isolation_push'
  | 'isolation_pull'
  | 'isolation_leg'
  | 'cardio'
  | 'unknown';

export type EquipmentClass =
  | 'barbell'
  | 'dumbbell'
  | 'kettlebell'
  | 'cable'
  | 'machine'
  | 'band'
  | 'bodyweight'
  | 'other';

export type SubstitutionReason = 'pattern' | 'equipment' | 'muscles' | 'category';

export interface SubstitutionExercise {
  id: string | null;
  name: string;
  category: string;
  equipment: string;
  metricFlags: number;
  contributions: Contributions | null;
}

export interface RankedSubstitution {
  exercise: SubstitutionExercise;
  score: number;
  reasons: SubstitutionReason[];
}

export interface RankOptions {
  /** Maximum results returned (default 5, clamped to ≥ 0). */
  limit?: number;
}

/** Reason → score weights (integer, documented so ranking stays reviewable). */
export const SUBSTITUTION_WEIGHTS: Record<SubstitutionReason, number> = {
  pattern: 400,
  equipment: 250,
  muscles: 300,
  category: 50,
};

const REASON_ORDER: SubstitutionReason[] = ['pattern', 'equipment', 'muscles', 'category'];

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Keyword heuristics (deterministic; first match wins in table order).
 * 'unknown' never scores — custom exercises simply do not gain pattern points.
 */
const PATTERN_TABLE: ReadonlyArray<readonly [MovementPattern, readonly string[]]> = [
  // Order matters: 'Bulgarian Split Squat' must resolve as a lunge before the
  // generic 'squat' keyword; first match wins.
  ['lunge', ['lunge', 'split squat', 'step up', 'bulgarian']],
  ['squat', ['squat', 'leg press']],
  ['hinge', ['deadlift', 'romanian', 'rdl', 'good morning', 'stiff leg', 'hip hinge', 'hip thrust', 'glute bridge']],
  ['cardio', ['run', 'sprint', 'bike', 'cycling', 'row erg', 'rowing', 'ski erg', 'jump rope', 'burpee']],
  ['press_vertical', ['overhead press', 'military press', 'shoulder press', 'pike press', 'handstand push', 'landmine press']],
  ['press_horizontal', ['bench press', 'chest press', 'push up', 'push-up', 'dip', 'floor press', 'chest press machine']],
  ['pull_vertical', ['pull up', 'pull-up', 'chin up', 'chin-up', 'pulldown', 'lat pulldown']],
  ['pull_horizontal', ['row', 'face pull', 'reverse fly', 'pull over', 'pullover']],
  ['core_brace', ['plank', 'dead bug', 'ab wheel', 'hollow', 'crunch', 'sit up', 'sit-up', 'russian twist', 'side plank']],
  ['carry', ['farmer', 'carry']],
  ['isolation_pull', ['curl']],
  ['isolation_push', ['triceps', 'pushdown', 'skull crusher', 'lateral raise', 'rear delt raise']],
  ['isolation_leg', ['leg extension', 'leg curl', 'calf raise', 'hip abduction', 'hip adduction']],
];

export function movementPatternOf(name: string, category: string): MovementPattern {
  const n = norm(name);
  const c = norm(category);
  if (c === 'cardio') return 'cardio';
  for (const [pattern, keywords] of PATTERN_TABLE) {
    for (const keyword of keywords) {
      if (n.includes(keyword)) return pattern;
    }
  }
  return 'unknown';
}

export function equipmentClassOf(equipment: string): EquipmentClass {
  const e = norm(equipment);
  if (!e) return 'bodyweight';
  if (e.includes('barbell') || e.includes('olympic')) return 'barbell';
  if (e.includes('dumbbell') || e === 'db') return 'dumbbell';
  if (e.includes('kettlebell') || e === 'kb') return 'kettlebell';
  if (e.includes('cable') || e.includes('pulley')) return 'cable';
  if (e.includes('machine') || e.includes('smith')) return 'machine';
  if (e.includes('band') || e.includes('resistance tube')) return 'band';
  if (e.includes('bodyweight') || e.includes('body weight') || e === 'bw' || e === 'none') return 'bodyweight';
  return 'other';
}

function sameIdentity(a: SubstitutionExercise, b: SubstitutionExercise): boolean {
  if (a.id != null && a.id !== '' && b.id != null && b.id !== '' && a.id === b.id) return true;
  return norm(a.name) === norm(b.name) && norm(a.category) === norm(b.category) && norm(a.equipment) === norm(b.equipment);
}

/**
 * Rank candidates as substitutions for `target`.
 * score = Σ matched reason weights; muscles uses shared basis points
 * (Σ min(target, candidate)) scaled to 0..300. Results with score 0 are
 * dropped, sorted by score desc, then name asc, then id asc.
 */
export function rankSubstitutions(
  target: SubstitutionExercise,
  candidates: readonly SubstitutionExercise[],
  options: RankOptions = {},
): RankedSubstitution[] {
  const limit = Math.max(0, Math.floor(options.limit ?? 5));
  if (limit === 0) return [];

  const targetPattern = movementPatternOf(target.name, target.category);
  const targetClass = equipmentClassOf(target.equipment);
  const targetCategory = norm(target.category);

  const results: RankedSubstitution[] = [];
  for (const candidate of candidates) {
    if (sameIdentity(target, candidate)) continue;

    let score = 0;
    const reasons: SubstitutionReason[] = [];

    const candidatePattern = movementPatternOf(candidate.name, candidate.category);
    if (targetPattern !== 'unknown' && candidatePattern === targetPattern) {
      score += SUBSTITUTION_WEIGHTS.pattern;
      reasons.push('pattern');
    }

    const candidateClass = equipmentClassOf(candidate.equipment);
    if (targetClass !== 'other' && candidateClass === targetClass) {
      score += SUBSTITUTION_WEIGHTS.equipment;
      reasons.push('equipment');
    }

    if (target.contributions && candidate.contributions) {
      const targetMap = new Map(target.contributions);
      let shared = 0;
      for (const [muscle, bp] of candidate.contributions) {
        const mine = targetMap.get(muscle);
        if (mine != null) shared += Math.min(mine, bp);
      }
      if (shared > 0) {
        score += Math.round((shared / 10_000) * SUBSTITUTION_WEIGHTS.muscles);
        reasons.push('muscles');
      }
    }

    const candidateCategory = norm(candidate.category);
    if (targetCategory && candidateCategory === targetCategory) {
      score += SUBSTITUTION_WEIGHTS.category;
      reasons.push('category');
    }

    if (score > 0) {
      results.push({ exercise: candidate, score, reasons });
    }
  }

  results.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    const an = norm(a.exercise.name);
    const bn = norm(b.exercise.name);
    if (an !== bn) return an < bn ? -1 : 1;
    const ai = a.exercise.id ?? '';
    const bi = b.exercise.id ?? '';
    return ai < bi ? -1 : ai > bi ? 1 : 0;
  });

  return results.slice(0, limit);
}
