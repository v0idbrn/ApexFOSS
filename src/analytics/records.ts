/**
 * Personal-record detection (Phase 2J §12). Deterministic and neutral:
 * raw bests only — no ratings, goals, scores, rankings or health claims.
 *
 * Estimated 1RM uses Epley (weight × (1 + reps ÷ 30)) and must always be
 * presented in the UI as an *estimate*, never as a measured value.
 * Records are keyed by exercise name (the analytics identity that survives
 * missing/deleted exercise rows). No React, no DB, no IO.
 */
import type { DatedSession, SetLoadInput } from './load';

export type PrMetric = 'weight' | 'reps' | 'duration' | 'distance' | 'estimated1rm';

export const PR_METRICS: PrMetric[] = ['weight', 'reps', 'estimated1rm', 'duration', 'distance'];

export interface PrEvent {
  exerciseName: string;
  metric: PrMetric;
  /** New record in the metric's natural unit: grams / reps / ms / mm. */
  value: number;
  /** Previous record in the same unit; null on first achievement. */
  previousValue: number | null;
  sessionId: string;
  timestampMs: number;
}

export interface ExercisePr {
  exerciseName: string;
  bestWeightGrams: number | null;
  bestWeightAtMs: number | null;
  bestReps: number | null;
  bestRepsAtMs: number | null;
  bestDurationMs: number | null;
  bestDurationAtMs: number | null;
  bestDistanceMm: number | null;
  bestDistanceAtMs: number | null;
  /** Epley estimate; label as an estimate wherever it is shown. */
  estimated1rmGrams: number | null;
  estimated1rmAtMs: number | null;
}

interface Candidate {
  exerciseName: string;
  sessionId: string;
  timestampMs: number;
  index: number;
  values: Partial<Record<PrMetric, number>>;
}

/** Epley estimated 1RM in grams; null unless both inputs are positive finite. */
export function estimate1rmGrams(weightGrams: number, reps: number): number | null {
  if (!Number.isFinite(weightGrams) || !Number.isFinite(reps)) return null;
  if (weightGrams <= 0 || reps <= 0) return null;
  return Math.round(weightGrams * (1 + reps / 30));
}

function metricValues(set: SetLoadInput, exerciseName: string, sessionId: string, timestampMs: number, index: number): Candidate {
  const values: Partial<Record<PrMetric, number>> = {};
  const weight = set.weightGrams ?? 0;
  const reps = set.reps ?? 0;
  const duration = set.durationMs ?? 0;
  const distance = set.distanceMm ?? 0;
  if (weight > 0 && reps > 0) values.weight = weight;
  if (reps > 0) values.reps = reps;
  if (duration > 0) values.duration = duration;
  if (distance > 0) values.distance = distance;
  const est = weight > 0 && reps > 0 ? estimate1rmGrams(weight, reps) : null;
  if (est !== null) values.estimated1rm = est;
  return { exerciseName, sessionId, timestampMs, index, values };
}

/** All completed sets as metric candidates, flattened across sessions. */
function candidatesOf(sessions: DatedSession[]): Candidate[] {
  const out: Candidate[] = [];
  let index = 0;
  for (const session of sessions) {
    for (const exercise of session.exercises) {
      for (const set of exercise.sets) {
        if (!set.isCompleted) continue;
        const candidate = metricValues(set, exercise.exerciseName, session.sessionId, session.timestampMs, index);
        if (Object.keys(candidate.values).length > 0) out.push(candidate);
        index += 1;
      }
    }
  }
  out.sort((a, b) => a.timestampMs - b.timestampMs || a.index - b.index);
  return out;
}

/**
 * Every record-breaking moment in chronological order (ties keep the earlier
 * achievement — only a strictly greater value emits an event).
 */
export function prEvents(sessions: DatedSession[]): PrEvent[] {
  const running = new Map<string, number>(); // `${exercise}|${metric}` → best
  const events: PrEvent[] = [];
  for (const candidate of candidatesOf(sessions)) {
    for (const [metric, value] of Object.entries(candidate.values) as [PrMetric, number][]) {
      const key = `${candidate.exerciseName}|${metric}`;
      const previous = running.get(key);
      if (previous === undefined || value > previous) {
        running.set(key, value);
        events.push({
          exerciseName: candidate.exerciseName,
          metric,
          value,
          previousValue: previous ?? null,
          sessionId: candidate.sessionId,
          timestampMs: candidate.timestampMs,
        });
      }
    }
  }
  return events;
}

/** Final bests per exercise, alphabetical by exercise name. */
export function exercisePrs(sessions: DatedSession[]): ExercisePr[] {
  const byExercise = new Map<string, ExercisePr>();
  for (const event of prEvents(sessions)) {
    let pr = byExercise.get(event.exerciseName);
    if (!pr) {
      pr = {
        exerciseName: event.exerciseName,
        bestWeightGrams: null,
        bestWeightAtMs: null,
        bestReps: null,
        bestRepsAtMs: null,
        bestDurationMs: null,
        bestDurationAtMs: null,
        bestDistanceMm: null,
        bestDistanceAtMs: null,
        estimated1rmGrams: null,
        estimated1rmAtMs: null,
      };
      byExercise.set(event.exerciseName, pr);
    }
    // The last event per metric holds the final best.
    switch (event.metric) {
      case 'weight':
        pr.bestWeightGrams = event.value;
        pr.bestWeightAtMs = event.timestampMs;
        break;
      case 'reps':
        pr.bestReps = event.value;
        pr.bestRepsAtMs = event.timestampMs;
        break;
      case 'duration':
        pr.bestDurationMs = event.value;
        pr.bestDurationAtMs = event.timestampMs;
        break;
      case 'distance':
        pr.bestDistanceMm = event.value;
        pr.bestDistanceAtMs = event.timestampMs;
        break;
      case 'estimated1rm':
        pr.estimated1rmGrams = event.value;
        pr.estimated1rmAtMs = event.timestampMs;
        break;
    }
  }
  return [...byExercise.values()].sort((a, b) => a.exerciseName.localeCompare(b.exerciseName));
}

/** Chronological record events for one exercise, optionally one metric. */
export function prHistory(sessions: DatedSession[], exerciseName: string, metric?: PrMetric): PrEvent[] {
  return prEvents(sessions).filter(
    (e) => e.exerciseName === exerciseName && (metric === undefined || e.metric === metric),
  );
}
