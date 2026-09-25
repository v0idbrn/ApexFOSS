/**
 * Deterministic session-to-session comparison (Phase 2J §13).
 * Descriptive deltas only — no better/worse judgments, no scores, no risk or
 * health interpretation. Deltas are always `current − baseline`; percent
 * change is null whenever the baseline is zero (never Infinity/NaN).
 * No React, no DB, no IO.
 */
import { calculateSetLoad, type DatedSession, type SetLoadInput } from './load';
import { descriptiveDelta, type DescriptiveDelta } from './athlete';
import { estimate1rmGrams } from './records';

export interface SessionSide {
  /** All logged sets, completed or not. */
  setCount: number;
  completedSetCount: number;
  resistanceGramReps: number;
  durationMs: number;
  bestWeightGrams: number | null;
  bestReps: number | null;
  estimated1rmGrams: number | null;
  /** Wall-clock session duration (endedAt − startedAt); 0 when untimed. */
  wallMs: number;
}

export interface SessionRef {
  sessionId: string;
  name: string;
  timestampMs: number;
}

export interface ExerciseComparison {
  exerciseName: string;
  present: 'both' | 'baseline' | 'current';
  baseline: SessionSide;
  current: SessionSide;
  /** current − baseline resistance volume, in gram-reps. */
  volumeDeltaGramReps: number;
  /** Percent volume change; null when baseline volume is 0. */
  volumePercentChange: number | null;
}

export interface SessionComparison {
  baselineRef: SessionRef;
  currentRef: SessionRef;
  /** Resistance volume (gram-reps), completed sets, wall duration. */
  volume: DescriptiveDelta;
  sets: DescriptiveDelta;
  duration: DescriptiveDelta;
  /** Union of both sessions' exercises, alphabetical by name. */
  exercises: ExerciseComparison[];
}

export const EMPTY_SIDE: SessionSide = Object.freeze({
  setCount: 0,
  completedSetCount: 0,
  resistanceGramReps: 0,
  durationMs: 0,
  bestWeightGrams: null,
  bestReps: null,
  estimated1rmGrams: null,
  wallMs: 0,
});

function sideOfSets(sets: SetLoadInput[]): Omit<SessionSide, 'wallMs'> {
  let setCount = 0;
  let completedSetCount = 0;
  let resistanceGramReps = 0;
  let durationMs = 0;
  let bestWeightGrams: number | null = null;
  let bestReps: number | null = null;
  let estimated1rmGrams: number | null = null;
  for (const set of sets) {
    setCount += 1;
    if (!set.isCompleted) continue;
    completedSetCount += 1;
    const load = calculateSetLoad(set);
    resistanceGramReps += load.resistanceGramReps;
    durationMs += load.durationMs;
    const weight = set.weightGrams ?? 0;
    const reps = set.reps ?? 0;
    if (weight > 0 && reps > 0) {
      if (bestWeightGrams === null || weight > bestWeightGrams) bestWeightGrams = weight;
      const est = estimate1rmGrams(weight, reps);
      if (est !== null && (estimated1rmGrams === null || est > estimated1rmGrams)) estimated1rmGrams = est;
    }
    if (reps > 0 && (bestReps === null || reps > bestReps)) bestReps = reps;
  }
  return { setCount, completedSetCount, resistanceGramReps, durationMs, bestWeightGrams, bestReps, estimated1rmGrams };
}

function sideOf(session: DatedSession): SessionSide {
  const sets: SetLoadInput[] = [];
  for (const exercise of session.exercises) sets.push(...exercise.sets);
  const wallMs = session.endedAt !== null && session.endedAt >= session.startedAt ? session.endedAt - session.startedAt : 0;
  return { ...sideOfSets(sets), wallMs };
}

function refOf(session: DatedSession): SessionRef {
  return { sessionId: session.sessionId, name: session.name, timestampMs: session.timestampMs };
}

/** Compare two sessions: `baseline` (older reference) vs `current` (newer). */
export function compareSessions(baseline: DatedSession, current: DatedSession): SessionComparison {
  const baselineSide = sideOf(baseline);
  const currentSide = sideOf(current);

  const names = new Set<string>();
  for (const s of baseline.exercises) names.add(s.exerciseName);
  for (const s of current.exercises) names.add(s.exerciseName);

  const exercises: ExerciseComparison[] = [];
  for (const exerciseName of names) {
    const baseSets = baseline.exercises.find((e) => e.exerciseName === exerciseName)?.sets ?? [];
    const curSets = current.exercises.find((e) => e.exerciseName === exerciseName)?.sets ?? [];
    const inBaseline = baseSets.length > 0;
    const inCurrent = curSets.length > 0;
    const baselineEx = sideOfSets(baseSets);
    const currentEx = sideOfSets(curSets);
    const volumeDelta = currentEx.resistanceGramReps - baselineEx.resistanceGramReps;
    // Percent change only compares like-for-like: an exercise performed in
    // just one of the two sessions reports null rather than a misleading ratio.
    const percent =
      inBaseline && inCurrent && baselineEx.resistanceGramReps > 0
        ? descriptiveDelta(currentEx.resistanceGramReps, baselineEx.resistanceGramReps).percentChange
        : null;
    exercises.push({
      exerciseName,
      present: inBaseline && inCurrent ? 'both' : inBaseline ? 'baseline' : 'current',
      baseline: { ...baselineEx, wallMs: baselineSide.wallMs },
      current: { ...currentEx, wallMs: currentSide.wallMs },
      volumeDeltaGramReps: volumeDelta,
      volumePercentChange: percent,
    });
  }
  exercises.sort((a, b) => a.exerciseName.localeCompare(b.exerciseName));

  return {
    baselineRef: refOf(baseline),
    currentRef: refOf(current),
    volume: descriptiveDelta(currentSide.resistanceGramReps, baselineSide.resistanceGramReps),
    sets: descriptiveDelta(currentSide.completedSetCount, baselineSide.completedSetCount),
    duration: descriptiveDelta(currentSide.wallMs, baselineSide.wallMs),
    exercises,
  };
}

/**
 * The most recent completed session strictly older than `timestampMs`.
 * Deterministic for ties (earliest among equal timestamps loses).
 */
export function previousSessionBefore(sessions: DatedSession[], timestampMs: number): DatedSession | null {
  let best: DatedSession | null = null;
  for (const session of sessions) {
    if (session.timestampMs >= timestampMs) continue;
    if (best === null || session.timestampMs > best.timestampMs) best = session;
  }
  return best;
}
