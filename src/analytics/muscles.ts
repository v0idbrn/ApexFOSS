/**
 * Pure deterministic muscle mapping and muscle-load aggregation (Phase 2F).
 *
 * - Muscle groups are a controlled 17-entry product vocabulary for training
 *   classification — NOT medical anatomy.
 * - Contributions are integer basis points summing to 10000 (product weights,
 *   not science). Per-set distribution uses largest-remainder integer math so
 *   per-muscle loads always sum exactly to the source load.
 * - Mapping resolution keys on stable exercise identity (deterministic seed id
 *   first, exact portable record key as fallback for pre-existing installs).
 *   Never fuzzy matching, never display-name-only guessing: unknown/custom
 *   exercises resolve to null → "Muscle data unavailable".
 * - Heatmap volume counts resistance load (gram-reps) only. Timed/interval work
 *   is excluded by design — duration is never converted into fake kilograms.
 * - No React, no DB, no IO.
 */
import { calculateSetLoad, type SetLoadInput } from './load';

/** Controlled training muscle vocabulary (17 groups). */
export const MUSCLE_GROUPS = [
  'chest',
  'upper_back',
  'lats',
  'front_delts',
  'side_delts',
  'rear_delts',
  'biceps',
  'triceps',
  'forearms',
  'abs',
  'obliques',
  'lower_back',
  'glutes',
  'quads',
  'hamstrings',
  'calves',
  'adductors',
] as const;

export type MuscleId = (typeof MUSCLE_GROUPS)[number];

export type ContributionEntry = readonly [MuscleId, number];
export type Contributions = readonly ContributionEntry[];

/** Every valid contribution map sums to exactly this many basis points. */
export const TOTAL_BASIS_POINTS = 10000;

/** A built-in (seeded) exercise with its product contribution weights. */
export interface MuscleMapEntry {
  /** Deterministic seed identity used as the primary lookup key. */
  seedId: string | null;
  name: string;
  category: string;
  equipment: string;
  metricFlags: number;
  contributions: Contributions;
}

/** Normalized exercise identity used for exact record-key fallback lookup. */
export interface ExerciseIdentity {
  id: string | null;
  name: string;
  category: string;
  equipment: string;
  metricFlags: number;
}

export interface MuscleCatalog {
  bySeedId: ReadonlyMap<string, Contributions>;
  byRecordKey: ReadonlyMap<string, Contributions>;
}

export type MuscleLoadMap = Record<MuscleId, number>;

/** True when contributions are non-empty, use only valid muscles once each, and sum to 10000. */
export function isValidContributions(c: Contributions): boolean {
  if (!Array.isArray(c) || c.length === 0) return false;
  const vocabulary = MUSCLE_GROUPS as readonly string[];
  const seen = new Set<string>();
  let sum = 0;
  for (const entry of c) {
    if (!Array.isArray(entry) || entry.length !== 2) return false;
    const [muscle, basisPoints] = entry;
    if (!vocabulary.includes(muscle)) return false;
    if (seen.has(muscle)) return false;
    seen.add(muscle);
    if (!Number.isInteger(basisPoints) || basisPoints <= 0) return false;
    sum += basisPoints;
  }
  return sum === TOTAL_BASIS_POINTS;
}

/**
 * Deterministic record key mirroring the app's portable exercise identity
 * (name + category + equipment + metric flags, normalized). Exact-match only —
 * this is never a display-name search.
 */
export function muscleRecordKey(
  name: string,
  category: string,
  equipment: string,
  metricFlags: number,
): string {
  const n = name.trim().toLowerCase().replace(/\s+/g, ' ');
  const c = category.trim().toLowerCase();
  const e = equipment.trim().toLowerCase();
  return `${n}|${c}|${e}|${metricFlags}`;
}

/**
 * Build lookup indexes from built-in mappings. Entries with invalid
 * contribution maps are ignored (never crash, never emit partial weights).
 */
export function buildMuscleCatalog(entries: MuscleMapEntry[]): MuscleCatalog {
  const bySeedId = new Map<string, Contributions>();
  const byRecordKey = new Map<string, Contributions>();
  for (const entry of entries) {
    if (!isValidContributions(entry.contributions)) continue;
    if (entry.seedId !== null && entry.seedId !== '') {
      bySeedId.set(entry.seedId, entry.contributions);
    }
    byRecordKey.set(
      muscleRecordKey(entry.name, entry.category, entry.equipment, entry.metricFlags),
      entry.contributions,
    );
  }
  return { bySeedId, byRecordKey };
}

/**
 * Deterministic mapping resolution:
 * 1. stable seed id (survives renames on installs seeded with deterministic ids),
 * 2. exact portable record key (covers pre-existing installs and backup/restore
 *    rows whose generated ids differ),
 * 3. otherwise null → unmapped.
 */
export function resolveContributions(
  catalog: MuscleCatalog,
  identity: ExerciseIdentity,
): Contributions | null {
  if (identity.id !== null && identity.id !== '') {
    const byId = catalog.bySeedId.get(identity.id);
    if (byId) return byId;
  }
  const key = muscleRecordKey(
    identity.name,
    identity.category,
    identity.equipment,
    identity.metricFlags,
  );
  return catalog.byRecordKey.get(key) ?? null;
}

export function emptyMuscleLoadMap(): MuscleLoadMap {
  const map = {} as MuscleLoadMap;
  for (const muscle of MUSCLE_GROUPS) {
    map[muscle] = 0;
  }
  return map;
}

/**
 * Integer allocation with largest-remainder so parts sum exactly to `total`.
 * `weights` must be positive integers; if they sum to 0 the result is all zeros.
 */
function allocateExact(total: number, weights: number[]): number[] {
  const count = weights.length;
  const parts = new Array<number>(count).fill(0);
  if (count === 0 || !Number.isFinite(total) || total <= 0) return parts;
  let weightSum = 0;
  for (const w of weights) weightSum += w;
  if (weightSum <= 0) return parts;

  const remainders: Array<{ index: number; remainder: number; weight: number }> = [];
  let assigned = 0;
  for (let i = 0; i < count; i += 1) {
    const scaled = Math.round(total) * weights[i];
    const floor = Math.floor(scaled / weightSum);
    parts[i] = floor;
    assigned += floor;
    remainders.push({ index: i, remainder: scaled - floor * weightSum, weight: weights[i] });
  }
  let leftover = Math.round(total) - assigned;
  remainders.sort(
    (a, b) => b.remainder - a.remainder || b.weight - a.weight || a.index - b.index,
  );
  for (const entry of remainders) {
    if (leftover <= 0) break;
    parts[entry.index] += 1;
    leftover -= 1;
  }
  return parts;
}

/**
 * Split an integer gram-reps load across the exercise's muscles.
 * Result parts always sum exactly to `total` when contributions are valid
 * (or to the actual contribution sum otherwise) — conservation holds.
 */
export function distributeBasisPoints(
  totalGramReps: number,
  contributions: Contributions,
): MuscleLoadMap {
  const map = emptyMuscleLoadMap();
  if (!Number.isFinite(totalGramReps) || totalGramReps <= 0) return map;
  const positive = contributions.filter(([, bp]) => bp > 0);
  if (positive.length === 0) return map;
  const parts = allocateExact(Math.round(totalGramReps), positive.map(([, bp]) => bp));
  positive.forEach(([muscle], index) => {
    map[muscle] += parts[index];
  });
  return map;
}

export interface MuscleStepInput {
  exerciseName: string;
  /** Resolved built-in mapping, or null when unmapped. */
  contributions: Contributions | null;
  sets: SetLoadInput[];
}

export interface MuscleSessionInput {
  sessionId: string;
  name: string;
  /** Local completion timestamp used for range filtering. */
  timestampMs: number;
  startedAt: number;
  endedAt: number | null;
  exercises: MuscleStepInput[];
}

export interface MuscleExerciseLoad {
  exerciseName: string;
  resistanceGramReps: number;
  resistanceSetCount: number;
}

export interface MuscleRegionLoad {
  muscle: MuscleId;
  resistanceGramReps: number;
  /** Resistance sets attributed to this muscle (a set counts for every muscle the exercise engages). */
  resistanceSetCount: number;
  /** Share of mapped load in basis points; regions with load sum to exactly 10000. */
  shareBp: number;
  /** Contributing exercises sorted by load desc. */
  exercises: MuscleExerciseLoad[];
}

export interface MuscleHeatmap {
  sessionCount: number;
  /** All resistance load inside the window (mapped + unmapped). */
  totalResistanceGramReps: number;
  mappedResistanceGramReps: number;
  unmappedResistanceGramReps: number;
  mappedSetCount: number;
  unmappedSetCount: number;
  /** Exercises with at least one completed resistance set inside the window. */
  totalExerciseCount: number;
  mappedExerciseCount: number;
  /** Regions with load > 0, sorted load desc (vocabulary order breaks ties). */
  regions: MuscleRegionLoad[];
  unmappedExercises: MuscleExerciseLoad[];
}

interface MutableExercise {
  exerciseName: string;
  resistanceGramReps: number;
  resistanceSetCount: number;
}

function addExerciseLoad(target: Map<string, MutableExercise>, exerciseName: string, load: number, sets: number): void {
  const key = exerciseName.trim() === '' ? '—' : exerciseName;
  const existing = target.get(key);
  if (existing) {
    existing.resistanceGramReps += load;
    existing.resistanceSetCount += sets;
    return;
  }
  target.set(key, { exerciseName: key, resistanceGramReps: load, resistanceSetCount: sets });
}

function toSortedExerciseLoads(map: Map<string, MutableExercise>): MuscleExerciseLoad[] {
  return Array.from(map.values()).sort(
    (a, b) =>
      b.resistanceGramReps - a.resistanceGramReps ||
      a.exerciseName.localeCompare(b.exerciseName),
  );
}

/**
 * Aggregate muscle load for sessions whose completion timestamp falls inside
 * [range.startMs, range.endMs). Timed-only and empty steps are excluded from
 * every count; unmapped resistance is preserved separately (never guessed).
 */
export function calculateMuscleHeatmap(
  sessions: MuscleSessionInput[],
  range: { startMs: number; endMs: number },
): MuscleHeatmap {
  const regionLoad = emptyMuscleLoadMap();
  const regionSetCount = emptyMuscleLoadMap();
  const regionExercises = new Map<MuscleId, Map<string, MutableExercise>>();
  const unmappedExercises = new Map<string, MutableExercise>();

  let sessionCount = 0;
  let totalResistance = 0;
  let mappedResistance = 0;
  let unmappedResistance = 0;
  let mappedSetCount = 0;
  let unmappedSetCount = 0;
  let totalExerciseCount = 0;
  let mappedExerciseCount = 0;

  for (const session of sessions) {
    if (session.timestampMs < range.startMs || session.timestampMs >= range.endMs) continue;
    sessionCount += 1;
    for (const step of session.exercises) {
      let resistance = 0;
      let resistanceSets = 0;
      for (const set of step.sets) {
        const load = calculateSetLoad(set);
        if (load.hasResistance) {
          resistance += load.resistanceGramReps;
          resistanceSets += 1;
        }
      }
      // Timed/interval work and empty/incomplete steps contribute no volume.
      if (resistance <= 0 || resistanceSets === 0) continue;

      totalResistance += resistance;
      totalExerciseCount += 1;

      if (step.contributions === null) {
        unmappedResistance += resistance;
        unmappedSetCount += resistanceSets;
        addExerciseLoad(unmappedExercises, step.exerciseName, resistance, resistanceSets);
        continue;
      }

      mappedResistance += resistance;
      mappedSetCount += resistanceSets;
      mappedExerciseCount += 1;

      const parts = distributeBasisPoints(resistance, step.contributions);
      for (const [muscle, basisPoints] of step.contributions) {
        if (basisPoints <= 0) continue;
        const part = parts[muscle];
        if (part <= 0) continue;
        regionLoad[muscle] += part;
        regionSetCount[muscle] += resistanceSets;
        let exercises = regionExercises.get(muscle);
        if (!exercises) {
          exercises = new Map<string, MutableExercise>();
          regionExercises.set(muscle, exercises);
        }
        addExerciseLoad(exercises, step.exerciseName, part, resistanceSets);
      }
    }
  }

  const regions: MuscleRegionLoad[] = [];
  for (const muscle of MUSCLE_GROUPS) {
    const load = regionLoad[muscle];
    if (load <= 0) continue;
    regions.push({
      muscle,
      resistanceGramReps: load,
      resistanceSetCount: regionSetCount[muscle],
      shareBp: 0,
      exercises: toSortedExerciseLoads(regionExercises.get(muscle) ?? new Map()),
    });
  }
  regions.sort(
    (a, b) =>
      b.resistanceGramReps - a.resistanceGramReps ||
      MUSCLE_GROUPS.indexOf(a.muscle) - MUSCLE_GROUPS.indexOf(b.muscle),
  );
  const shares = allocateExact(
    TOTAL_BASIS_POINTS,
    regions.map((region) => region.resistanceGramReps),
  );
  regions.forEach((region, index) => {
    region.shareBp = shares[index];
  });

  return {
    sessionCount,
    totalResistanceGramReps: totalResistance,
    mappedResistanceGramReps: mappedResistance,
    unmappedResistanceGramReps: unmappedResistance,
    mappedSetCount,
    unmappedSetCount,
    totalExerciseCount,
    mappedExerciseCount,
    regions,
    unmappedExercises: toSortedExerciseLoads(unmappedExercises),
  };
}
