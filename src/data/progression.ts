import { Database, Q } from '@nozbe/watermelondb';
import { WorkoutSession, Exercise } from './models';
import { definitionOf } from './serialize';
import { loadAnalyticsSnapshot, type AnalyticsExercise, type AnalyticsSnapshot } from './analytics';
import { loadEquipmentItems } from './equipment';
import type { SessionExercisePrescription, PrescriptionTarget, ProgressionEvidence, ProgressionState } from '../analytics/progression';
import { analyzeProgression, type AnalyzeProgressionInput } from '../analytics/progression';
import { describeE1rmTrend, e1rmSeries, type TrendEvidence } from '../analytics/plateau';
import type { LoadItem } from '../analytics/inventory';
import {
  latestPrescriptionFor,
  resolveAchievableNextWeightGrams,
  sessionTimestampsOf,
} from '../analytics/progressionWiring';

/**
 * Phase 3B data bridge: stored history → progression engine.
 *
 * Architecture boundary (§5 invariant): the DB layer only *transforms* —
 * the engine never sees models, and the UI never sees rules. The analytics
 * snapshot (4 batched queries) + equipment (1 query) + definitions (1 batched
 * query) feed every exercise analysis — no per-exercise queries, no N+1.
 */

/** Definition steps (immutable snapshots) used for prescription context. */
interface DefinitionStepLike {
  exerciseName: string;
  exerciseId: string | null;
  prescription: PrescriptionTarget;
}

export interface ProgressionSnapshot {
  /** The already-transformed analytics snapshot (sessions + exercise rows). */
  analytics: AnalyticsSnapshot;
  /** session id → completion timestamp (prescription ordering only). */
  timestamps: Map<string, number>;
  /** Per-session, per-exercise prescription context from definition_json snapshots. */
  historicalPrescriptions: Map<string, SessionExercisePrescription>;
  /** Real equipment inventory, mapped for the load solver. */
  equipmentItems: LoadItem[];
}

/**
 * One batched retrieval + pure transformation → ProgressionSnapshot.
 * Corrupt/missing definition snapshots are skipped per session — never crash,
 * never invent data.
 */
export async function loadProgressionSnapshot(db: Database): Promise<ProgressionSnapshot> {
  const analytics = await loadAnalyticsSnapshot(db);
  const equipmentRows = await loadEquipmentItems(db);
  const equipmentItems: LoadItem[] = equipmentRows.map((e) => ({
    name: e.name,
    weightGrams: e.weightGrams,
    quantity: e.quantity,
    perSide: e.perSide,
  }));
  const historicalPrescriptions = await loadHistoricalPrescriptions(db);

  return {
    analytics,
    timestamps: sessionTimestampsOf(analytics),
    historicalPrescriptions,
    equipmentItems,
  };
}

/**
 * Historical prescriptions from the immutable definition_json snapshots
 * (one query over completed sessions; each definition parsed once).
 */
export async function loadHistoricalPrescriptions(
  db: Database,
): Promise<Map<string, SessionExercisePrescription>> {
  const sessionRows = await db
    .get<WorkoutSession>('workout_sessions')
    .query(Q.where('session_status', 'completed'))
    .fetch();

  const exerciseRows = await db.get<Exercise>('exercises').query().fetch();
  const equipmentById = new Map(exerciseRows.map((e) => [e.id, e.equipment]));

  const out = new Map<string, SessionExercisePrescription>();
  for (const session of sessionRows) {
    let definition: { blocks?: Array<{ steps?: DefinitionStepLike[] }> } | null = null;
    try {
      definition = definitionOf(session) as unknown as {
        blocks?: Array<{ steps?: DefinitionStepLike[] }>;
      } | null;
    } catch {
      continue;
    }
    if (!definition || !Array.isArray(definition.blocks)) continue;
    for (const block of definition.blocks) {
      if (!Array.isArray(block?.steps)) continue;
      for (const step of block.steps) {
        if (!step || typeof step.exerciseName !== 'string' || step.exerciseName === '') continue;
        const exerciseId = step.exerciseId ?? null;
        out.set(`${session.id}|${step.exerciseName}`, {
          exerciseName: step.exerciseName,
          exerciseId,
          prescription: step.prescription,
          equipmentClass: exerciseId != null ? (equipmentById.get(exerciseId) ?? '') : '',
          isSubstitution: false,
        });
      }
    }
  }
  return out;
}

/** Compose the engine input for one exercise from a loaded snapshot. */
export function progressionInputFor(
  prog: ProgressionSnapshot,
  exerciseName: string,
  exerciseId: string | null,
  currentPrescription: PrescriptionTarget,
  currentEquipmentClass: string,
  now: number,
): AnalyzeProgressionInput {
  return {
    exerciseName,
    exerciseId,
    sessions: prog.analytics.sessions,
    currentPrescription,
    currentEquipmentClass,
    currentExerciseId: exerciseId,
    historicalPrescriptions: prog.historicalPrescriptions,
    availableExercises: prog.analytics.exercises.map((e) => ({
      id: e.id,
      name: e.name,
      category: e.category,
      equipment: e.equipment,
      metricFlags: e.metricFlags,
      contributions: null,
    })),
    achievableNextWeightGrams: resolveAchievableNextWeightGrams(
      prog.equipmentItems,
      currentPrescription.targetWeightGrams,
    ),
    now,
  };
}

/**
 * Engine evidence for ONE step of a loaded session (HistoryDetail / completed
 * workout views): uses the step's immutable prescription as the current one.
 * Returns null when the step has no analyzable prescription (no rep range or
 * no target weight) — those steps simply carry no progression evidence.
 */
export function analyzeStepEvidence(
  prog: ProgressionSnapshot,
  step: { exerciseName: string; exerciseId: string | null; prescription: PrescriptionTarget },
  now: number,
): ProgressionEvidence | null {
  const p = step.prescription;
  if (!p || p.targetRepsMin == null || p.targetRepsMax == null || p.targetWeightGrams == null) return null;
  if (p.targetRepsMin <= 0 || p.targetRepsMax <= 0) return null;
  const row =
    (step.exerciseId != null
      ? prog.analytics.exercises.find((e) => e.id === step.exerciseId)
      : undefined) ?? prog.analytics.exercises.find((e) => e.name === step.exerciseName);
  const input = progressionInputFor(prog, step.exerciseName, step.exerciseId, p, row?.equipment ?? '', now);
  return analyzeProgression(input);
}

/** One overview row: the exercise plus its engine verdict. */
export interface ProgressionEntry {
  exercise: AnalyticsExercise;
  evidence: ProgressionEvidence;
}

export interface ProgressionOverview {
  progress: ProgressionEntry[];
  maintain: ProgressionEntry[];
  insufficient: ProgressionEntry[];
  /** Exercises with at least one logged performance (analyzed set). */
  analyzedCount: number;
}

/**
 * Run the engine once per exercise that has logged history, using its latest
 * recorded prescription (the honest "current" prescription outside a live
 * routine). Pure: same snapshot → same classification, always.
 */
export function summarizeProgression(prog: ProgressionSnapshot, now: number): ProgressionOverview {
  const overview: ProgressionOverview = { progress: [], maintain: [], insufficient: [], analyzedCount: 0 };
  const withHistory = new Set<string>();
  for (const session of prog.analytics.sessions) {
    for (const ex of session.exercises) {
      if (ex.exerciseId != null) withHistory.add(ex.exerciseId);
      if (ex.exerciseName) withHistory.add(`name:${ex.exerciseName}`);
    }
  }

  for (const exercise of prog.analytics.exercises) {
    const hasSets = withHistory.has(exercise.id) || withHistory.has(`name:${exercise.name}`);
    if (!hasSets) continue;

    const prescRow = latestPrescriptionFor(
      prog.historicalPrescriptions,
      prog.timestamps,
      exercise.name,
      exercise.id,
    );
    if (!prescRow) continue;

    const input = progressionInputFor(
      prog,
      exercise.name,
      exercise.id,
      prescRow.prescription,
      exercise.equipment,
      now,
    );
    const evidence = analyzeProgression(input);
    overview.analyzedCount += 1;
    const entry: ProgressionEntry = { exercise, evidence };
    const state: ProgressionState = evidence.state;
    if (state === 'progress') overview.progress.push(entry);
    else if (state === 'maintain') overview.maintain.push(entry);
    else overview.insufficient.push(entry);
  }
  return overview;
}

export { latestPrescriptionFor };

/** One exercise plus its deterministic trend/plateau evidence (Phase 3D). */
export interface TrendEntry {
  exercise: AnalyticsExercise;
  evidence: TrendEvidence;
}

export interface TrendOverview {
  /** Every exercise with at least one comparable logged session. */
  entries: TrendEntry[];
  /** Entries that cleared the sample gate — the signals safe to display. */
  signals: TrendEntry[];
  analyzedCount: number;
}

/**
 * Run the trend/plateau analysis once per exercise with logged history from
 * the same snapshot that feeds progression — pure, no extra queries.
 * Insufficient evidence stays in `entries` (status insufficient_data) and is
 * never surfaced as a signal.
 */
export function summarizeTrends(prog: ProgressionSnapshot): TrendOverview {
  const overview: TrendOverview = { entries: [], signals: [], analyzedCount: 0 };
  const withHistory = new Set<string>();
  for (const session of prog.analytics.sessions) {
    for (const ex of session.exercises) {
      if (ex.exerciseId != null) withHistory.add(ex.exerciseId);
      if (ex.exerciseName) withHistory.add(`name:${ex.exerciseName}`);
    }
  }

  for (const exercise of prog.analytics.exercises) {
    const hasSets = withHistory.has(exercise.id) || withHistory.has(`name:${exercise.name}`);
    if (!hasSets) continue;
    const series = e1rmSeries(prog.analytics.sessions, exercise.id, exercise.name);
    if (series.length === 0) continue;
    const evidence = describeE1rmTrend(series);
    overview.analyzedCount += 1;
    const entry: TrendEntry = { exercise, evidence };
    overview.entries.push(entry);
    if (evidence.status !== 'insufficient_data') overview.signals.push(entry);
  }
  return overview;
}
