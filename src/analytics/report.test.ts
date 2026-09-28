import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import { schema } from '../data/schema';
import { migrations } from '../data/migrations';
import { modelClasses } from '../data/models';
import { makeDbActions } from '../data/actions';
import { serializeRoutine, cursorOf } from '../data/serialize';
import { dispatch } from '../engine';
import { generateReport, type ReportPeriod } from '../data/report';

function makeDb(): Database {
  const adapter = new LokiJSAdapter({
    dbName: `apex-rpt-${Math.random().toString(36).slice(2)}`,
    schema,
    migrations,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
  });
  return new Database({ adapter, modelClasses: modelClasses as any });
}

const T = 1_700_000_000_000;
const DAY = 86_400_000;

async function seedCompletedSession(
  db: Database,
  input: {
    exerciseName?: string;
    weightGrams?: number;
    reps?: number;
    startedAt: number;
    endedAt: number;
    skipped?: boolean;
    targetSets?: number;
  } = { startedAt: T, endedAt: T + 3_600_000 },
): Promise<string> {
  const actions = makeDbActions(db);
  const exerciseName = input.exerciseName ?? 'Report Squat';
  const exerciseId = await actions.createExercise({
    name: exerciseName,
    category: 'legs',
    equipment: 'barbell',
    metricFlags: 3,
  });
  const routineId = await actions.createRoutine('Report Strength');
  const blockId = await actions.createBlock(routineId, { name: 'Main', kind: 'normal', rounds: 1 });
  const stepId = await actions.createStep(blockId, exerciseId, exerciseName);
  await actions.upsertPrescription(stepId, {
    targetSets: input.targetSets ?? 1,
    targetRepsMin: 5,
    targetRepsMax: 5,
    targetDurationMs: null,
    targetWeightGrams: null,
    targetRir: null,
    tempo: { eccentricMs: null, pauseBottomMs: null, concentricMs: null, pauseTopMs: null },
  });
  await actions.upsertTransition(blockId, stepId, { toStepId: null }, 'immediate', 0);
  const routine = await db.get<any>('routines').find(routineId);
  const definition = await serializeRoutine(db, routine);
  const sessionId = await actions.startSession(routine, definition);
  const session = await db.get<any>('workout_sessions').find(sessionId);
  let cursor = cursorOf(session);
  const completed = await dispatch(definition, cursor, {
    type: 'COMPLETE_SET',
    now: input.startedAt,
    set: {
      weightGrams: input.weightGrams ?? 100_000,
      reps: input.reps ?? 5,
      durationMs: null,
      distanceMm: null,
      rir: null,
    },
  });
  cursor = await actions.applyEffects(session, completed.cursor, completed.effects);
  if (input.skipped) {
    const skipped = await dispatch(definition, cursor, { type: 'SKIP_SET', now: input.startedAt + 1_000 });
    cursor = await actions.applyEffects(session, skipped.cursor, skipped.effects);
  }
  await actions.completeSession(session, cursor);
  await db.write(async () => {
    const stored = await db.get<any>('workout_sessions').find(sessionId);
    await stored.update((rec: any) => {
      rec.startedAt = input.startedAt;
      rec.endedAt = input.endedAt;
    });
  });
  return sessionId;
}

describe('generateReport', () => {
  let db: Database;
  let actions: ReturnType<typeof makeDbActions>;

  beforeEach(async () => {
    db = makeDb();
    actions = makeDbActions(db);
  });

  it('returns empty report when no sessions exist', async () => {
    const report = await generateReport(db, '28d');
    expect(report.sessions.total).toBe(0);
    expect(report.volume.byExercise).toEqual([]);
    expect(report.prs.count).toBe(0);
    expect(report.adherence.planned).toBe(0);
    expect(report.body).toBeNull();
    expect(report.goals).toEqual([]);
    expect(report.e1rmTrends).toEqual([]);
  });

  it('returns empty report for 7d period when no sessions exist', async () => {
    const report = await generateReport(db, '7d');
    expect(report.sessions.total).toBe(0);
    expect(report.period).toBe('7d');
  });

  it('returns empty report for all period when no sessions exist', async () => {
    const report = await generateReport(db, 'all');
    expect(report.sessions.total).toBe(0);
    expect(report.period).toBe('all');
  });

  it('returns null body when no metrics exist', async () => {
    const report = await generateReport(db, '28d');
    expect(report.body).toBeNull();
  });

  it('returns empty goals when none exist', async () => {
    const report = await generateReport(db, '28d');
    expect(report.goals).toEqual([]);
  });

  it('returns empty trends when no sessions exist', async () => {
    const report = await generateReport(db, '28d');
    expect(report.e1rmTrends).toEqual([]);
  });

  it('includes all-time sessions in volume while respecting the selected period', async () => {
    const now = T + 100 * DAY;
    await seedCompletedSession(db, {
      weightGrams: 100_000,
      reps: 5,
      startedAt: now - 40 * DAY,
      endedAt: now - 40 * DAY + 3_600_000,
    });
    await seedCompletedSession(db, {
      weightGrams: 80_000,
      reps: 5,
      startedAt: now - 3_600_000,
      endedAt: now,
    });

    const week = await generateReport(db, '7d', now);
    expect(week.sessions.total).toBe(1);
    expect(week.volume.totalGramReps).toBe(400_000);
    expect(week.sessions.totalDurationMs).toBe(3_600_000);

    const allTime = await generateReport(db, 'all', now);
    expect(allTime.sessions.total).toBe(2);
    expect(allTime.volume.totalGramReps).toBe(900_000);
    expect(allTime.volume.byExercise).toEqual([
      { exerciseName: 'Report Squat', gramReps: 900_000, setCount: 2 },
    ]);
    expect(allTime.sessions.totalDurationMs).toBe(7_200_000);
    expect(allTime.sessions.averageSetsPerSession).toBe(1);
  });

  it('preserves completed, skipped and modified execution markers', async () => {
    const now = T + 100 * DAY;
    await seedCompletedSession(db, {
      weightGrams: 100_000,
      reps: 5,
      startedAt: now - 3_600_000,
      endedAt: now,
      skipped: true,
      targetSets: 2,
    });

    const report = await generateReport(db, '7d', now);
    expect(report.adherence.planned).toBe(2);
    expect(report.adherence.performed).toBe(1);
    expect(report.adherence.skipped).toBe(1);
    expect(report.adherence.status).toBe('partial');
  });

  it('builds named e1RM trends from session series rather than aggregates', async () => {
    const now = T + 100 * DAY;
    const weights = [100_000, 102_500, 105_000, 107_500];
    for (const [index, weightGrams] of weights.entries()) {
      const startedAt = now - (3 - index) * 7 * DAY;
      await seedCompletedSession(db, {
        weightGrams,
        reps: 5,
        startedAt,
        endedAt: startedAt,
      });
    }

    const report = await generateReport(db, '28d', now);
    expect(report.e1rmTrends).toHaveLength(1);
    expect(report.e1rmTrends[0]?.exerciseName).toBe('Report Squat');
    expect(report.e1rmTrends[0]?.evidence.status).toBe('improving');
    expect(report.e1rmTrends[0]?.evidence.sampleCount).toBe(4);
  });
});