import {
  analyzeProgression,
  type AnalyzeProgressionInput,
  type ProgressionEvidence,
  type ProgressionReason,
  type ProgressionState,
  type PrescriptionTarget,
  type HistoricalPrescription,
  type SessionExercisePrescription,
} from './progression';
import type { DatedSession, SetLoadInput } from './load';
import type { SubstitutionExercise } from './substitutions';

function makeSession(
  sessionId: string,
  timestampMs: number,
  exerciseName: string,
  sets: SetLoadInput[],
  exerciseId: string | null = null,
  endedAt: number | null = timestampMs + 3600000,
): DatedSession {
  return {
    sessionId,
    name: 'Test Session',
    timestampMs,
    startedAt: timestampMs - 3600000,
    endedAt,
    exercises: [{ exerciseName, exerciseId, sets }],
  };
}

function makeSet(
  weightGrams: number,
  reps: number,
  isCompleted = true,
): SetLoadInput {
  return { weightGrams, reps, durationMs: null, distanceMm: null, isCompleted };
}

function makeHistoricalPrescription(
  exerciseName: string,
  exerciseId: string | null,
  prescription: HistoricalPrescription,
  equipmentClass: string,
  isSubstitution = false,
): SessionExercisePrescription {
  return {
    exerciseName,
    exerciseId,
    prescription,
    equipmentClass,
    isSubstitution,
  };
}

const defaultPrescription: PrescriptionTarget = {
  targetRepsMin: 8,
  targetRepsMax: 12,
  targetWeightGrams: 50000,
  targetRir: 2,
  tempo: null,
};

const defaultHistoricalPrescription: HistoricalPrescription = {
  targetRepsMin: 8,
  targetRepsMax: 12,
  targetWeightGrams: 50000,
  targetRir: 2,
  tempo: null,
};

const defaultInput: AnalyzeProgressionInput = {
  exerciseName: 'Bench Press',
  exerciseId: 'ex_bench',
  sessions: [],
  currentPrescription: defaultPrescription,
  currentEquipmentClass: 'barbell',
  currentExerciseId: 'ex_bench',
  availableExercises: [],
  now: Date.now(),
};

describe('analyzeProgression', () => {
  const now = 1_700_000_000_000;

function makeSessionWithPresc(
  sessionId: string,
  timestampMs: number,
  exerciseName: string,
  sets: SetLoadInput[],
  exerciseId: string | null = null,
  presc: HistoricalPrescription = defaultHistoricalPrescription,
  equipmentClass = 'barbell',
  isSubstitution = false,
): DatedSession {
  return makeSession(sessionId, timestampMs, exerciseName, sets, exerciseId);
}

function makeHistPrescMap(
  entries: Array<{ sessionId: string; exerciseName: string; presc: SessionExercisePrescription }>,
): Map<string, SessionExercisePrescription> {
  const map = new Map<string, SessionExercisePrescription>();
  for (const e of entries) map.set(`${e.sessionId}|${e.exerciseName}`, e.presc);
  return map;
}

  describe('Comparable performance identification', () => {
    it('returns insufficient_data when no performances exist', () => {
      const input = { ...defaultInput, sessions: [], now };
      const result = analyzeProgression(input);

      expect(result.state).toBe('insufficient_data');
      expect(result.reason).toBe('NO_COMPARABLE_PERFORMANCE');
      expect(result.comparableCount).toBe(0);
    });

    it('returns insufficient_data with only one performance', () => {
      const sessions = [
        makeSessionWithPresc('s1', now - 86400000, 'Bench Press', [makeSet(50000, 10)], 'ex_bench'),
      ];
      const historicalPrescriptions = makeHistPrescMap([
        { sessionId: 's1', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
      ]);
      const input = { ...defaultInput, sessions, historicalPrescriptions, now };
      const result = analyzeProgression(input);

      expect(result.state).toBe('insufficient_data');
      expect(result.reason).toBe('INSUFFICIENT_HISTORY');
      expect(result.comparableCount).toBe(1);
    });

    it('identifies same exercise by seed id', () => {
      const sessions = [
        makeSessionWithPresc('s1', now - 86400000, 'Bench Press', [makeSet(50000, 10)], 'ex_bench'),
        makeSessionWithPresc('s2', now, 'Bench Press', [makeSet(50000, 12)], 'ex_bench'),
      ];
      const historicalPrescriptions = makeHistPrescMap([
        { sessionId: 's1', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
        { sessionId: 's2', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
      ]);
      const input = { ...defaultInput, sessions, historicalPrescriptions, now };
      const result = analyzeProgression(input);

      expect(result.comparableCount).toBe(2);
      expect(result.baseline).toBeDefined();
      expect(result.current).toBeDefined();
      expect(result.comparability?.identityMatch).toBe('seed_id');
    });

    it('matches by seed id even when display names differ', () => {
      const sessions = [
        makeSessionWithPresc('s1', now - 86400000, 'Bench Press', [makeSet(50000, 10)], 'ex_bench'),
        makeSessionWithPresc('s2', now, 'Barbell Bench Press', [makeSet(50000, 12)], 'ex_bench'),
      ];
      const historicalPrescriptions = makeHistPrescMap([
        { sessionId: 's1', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
        { sessionId: 's2', exerciseName: 'Barbell Bench Press', presc: makeHistoricalPrescription('Barbell Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
      ]);
      const input = { ...defaultInput, sessions, historicalPrescriptions, now };
      const result = analyzeProgression(input);

      expect(result.state).not.toBe('insufficient_data');
      expect(result.comparability?.identityMatch).toBe('seed_id');
    });

    it('does NOT match different seed ids despite identical display names', () => {
      const sessions = [
        makeSessionWithPresc('s1', now - 86400000, 'Bench Press', [makeSet(50000, 10)], 'ex_bench_v1'),
        makeSessionWithPresc('s2', now, 'Bench Press', [makeSet(50000, 12)], 'ex_bench_v2'),
      ];
      const historicalPrescriptions = makeHistPrescMap([
        { sessionId: 's1', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench_v1', defaultHistoricalPrescription, 'barbell') },
        { sessionId: 's2', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench_v2', defaultHistoricalPrescription, 'barbell') },
      ]);
      const input = { ...defaultInput, sessions, historicalPrescriptions, now };
      const result = analyzeProgression(input);

      // Same name must never override two distinct valid IDs.
      expect(result.state).toBe('insufficient_data');
      expect(result.comparability?.identityMatch).toBe('none');
    });

    it('falls back to exact name when IDs are missing on both sides', () => {
      const sessions = [
        makeSessionWithPresc('s1', now - 86400000, 'Bench Press', [makeSet(50000, 10)], null),
        makeSessionWithPresc('s2', now, 'Bench Press', [makeSet(50000, 12)], null),
      ];
      const historicalPrescriptions = makeHistPrescMap([
        { sessionId: 's1', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', null, defaultHistoricalPrescription, 'barbell') },
        { sessionId: 's2', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', null, defaultHistoricalPrescription, 'barbell') },
      ]);
      const input = { ...defaultInput, sessions, historicalPrescriptions, now };
      const result = analyzeProgression(input);

      expect(result.state).not.toBe('insufficient_data');
      expect(result.comparability?.identityMatch).toBe('name_only');
    });

    it('treats different exercise name as non-comparable', () => {
      const sessions = [
        makeSessionWithPresc('s1', now - 86400000, 'Squat', [makeSet(50000, 10)], 'ex_squat'),
        makeSessionWithPresc('s2', now, 'Bench Press', [makeSet(50000, 12)], 'ex_bench'),
      ];
      const historicalPrescriptions = makeHistPrescMap([
        { sessionId: 's1', exerciseName: 'Squat', presc: makeHistoricalPrescription('Squat', 'ex_squat', defaultHistoricalPrescription, 'barbell') },
        { sessionId: 's2', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
      ]);
      const input = { ...defaultInput, sessions, historicalPrescriptions, now };
      const result = analyzeProgression(input);

      expect(result.state).toBe('insufficient_data');
      expect(result.reason).toBe('INSUFFICIENT_HISTORY');
    });

    it('flags substitution used in current performance', () => {
      const subExercises: SubstitutionExercise[] = [
        { id: 'ex_db_press', name: 'Dumbbell Bench Press', category: 'push', equipment: 'dumbbell', metricFlags: 0, contributions: null },
      ];
      const sessions = [
        makeSessionWithPresc('s1', now - 86400000, 'Bench Press', [makeSet(50000, 10)], 'ex_bench'),
        makeSessionWithPresc('s2', now, 'Dumbbell Bench Press', [makeSet(25000, 12)], 'ex_db_press'),
      ];
      const historicalPrescriptions = makeHistPrescMap([
        { sessionId: 's1', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
        { sessionId: 's2', exerciseName: 'Dumbbell Bench Press', presc: makeHistoricalPrescription('Dumbbell Bench Press', 'ex_db_press', defaultHistoricalPrescription, 'dumbbell', true) },
      ]);
      const input = { ...defaultInput, sessions, historicalPrescriptions, availableExercises: [
        { id: 'ex_db_press', name: 'Dumbbell Bench Press', category: 'push', equipment: 'dumbbell', metricFlags: 0, contributions: null },
      ], now };
      const result = analyzeProgression(input);

      expect(result.state).toBe('insufficient_data');
      expect(result.reason).toBe('SUBSTITUTION_USED');
    });

    it('flags previous substitution as non-comparable', () => {
      const sessions = [
        makeSessionWithPresc('s1', now - 86400000, 'Dumbbell Bench Press', [makeSet(25000, 10)], 'ex_db_press'),
        makeSessionWithPresc('s2', now, 'Bench Press', [makeSet(50000, 12)], 'ex_bench'),
      ];
      const historicalPrescriptions = makeHistPrescMap([
        { sessionId: 's1', exerciseName: 'Dumbbell Bench Press', presc: makeHistoricalPrescription('Dumbbell Bench Press', 'ex_db_press', defaultHistoricalPrescription, 'dumbbell', true) },
        { sessionId: 's2', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
      ]);
      const subExercises: SubstitutionExercise[] = [
        { id: 'ex_db_press', name: 'Dumbbell Bench Press', category: 'push', equipment: 'dumbbell', metricFlags: 0, contributions: null },
      ];
      const input = { ...defaultInput, sessions, historicalPrescriptions, availableExercises: subExercises, now };
      const result = analyzeProgression(input);

      expect(result.state).toBe('insufficient_data');
      expect(result.reason).toBe('PREVIOUS_SUBSTITUTION');
    });

    it('flags equipment class mismatch', () => {
      const sessions = [
        makeSessionWithPresc('s1', now - 86400000, 'Bench Press', [makeSet(50000, 10)], 'ex_bench'),
        makeSessionWithPresc('s2', now, 'Bench Press', [makeSet(50000, 12)], 'ex_bench'),
      ];
      const historicalPrescriptions = makeHistPrescMap([
        { sessionId: 's1', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
        { sessionId: 's2', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'dumbbell') }, // equipment changed
      ]);
      const input = { ...defaultInput, sessions, historicalPrescriptions, currentEquipmentClass: 'barbell', now };
      const result = analyzeProgression(input);

      expect(result.state).toBe('insufficient_data');
      expect(result.reason).toBe('EQUIPMENT_MISMATCH');
    });
  });

  describe('Double progression logic', () => {
    function makeProgressTest(
      repsHistory: number,
      repsCurrent: number,
      weightCurrent = 50000,
    ) {
      return {
        sessions: [
          makeSessionWithPresc('s1', now - 86400000, 'Bench Press', [makeSet(50000, repsHistory)], 'ex_bench'),
          makeSessionWithPresc('s2', now, 'Bench Press', [makeSet(weightCurrent, repsCurrent)], 'ex_bench'),
        ],
        historicalPrescriptions: makeHistPrescMap([
          { sessionId: 's1', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
          { sessionId: 's2', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
        ]),
      };
    }

    it('progress when reps reach upper bound at target weight', () => {
      const { sessions, historicalPrescriptions } = makeProgressTest(10, 12);
      const input = { ...defaultInput, sessions, historicalPrescriptions, now };
      const result = analyzeProgression(input);

      expect(result.state).toBe('progress');
      expect(result.reason).toBe('REPS_RANGE_COMPLETED');
      expect(result.atTargetWeight).toBe(true);
      // No data-derived increment source in this input: the opportunity stands,
      // but the engine must NOT invent a default step (no +2500g fallback).
      expect(result.suggestedWeightGrams).toBeUndefined();
      expect(result.weightIncrementSource).toBe('none');
    });

    it('maintain when reps inside range', () => {
      const sessions = [
        makeSessionWithPresc('s1', now - 86400000, 'Bench Press', [makeSet(50000, 10)], 'ex_bench'),
        makeSessionWithPresc('s2', now, 'Bench Press', [makeSet(50000, 10)], 'ex_bench'),
      ];
      const historicalPrescriptions = makeHistPrescMap([
        { sessionId: 's1', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
        { sessionId: 's2', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
      ]);
      const input = { ...defaultInput, sessions, historicalPrescriptions, now };
      const result = analyzeProgression(input);

      expect(result.state).toBe('maintain');
      expect(result.reason).toBe('REPS_IN_RANGE');
    });

    it('maintain when reps below minimum', () => {
      const sessions = [
        makeSessionWithPresc('s1', now - 86400000, 'Bench Press', [makeSet(50000, 10)], 'ex_bench'),
        makeSessionWithPresc('s2', now, 'Bench Press', [makeSet(50000, 6)], 'ex_bench'),
      ];
      const historicalPrescriptions = makeHistPrescMap([
        { sessionId: 's1', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
        { sessionId: 's2', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
      ]);
      const input = { ...defaultInput, sessions, historicalPrescriptions, now };
      const result = analyzeProgression(input);

      expect(result.state).toBe('maintain');
      expect(result.reason).toBe('REPS_BELOW_MIN');
    });

    it('progress when reps exceed upper bound at target weight', () => {
      const sessions = [
        makeSessionWithPresc('s1', now - 86400000, 'Bench Press', [makeSet(50000, 10)], 'ex_bench'),
        makeSessionWithPresc('s2', now, 'Bench Press', [makeSet(50000, 14)], 'ex_bench'),
      ];
      const historicalPrescriptions = makeHistPrescMap([
        { sessionId: 's1', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
        { sessionId: 's2', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
      ]);
      const input = { ...defaultInput, sessions, historicalPrescriptions, now };
      const result = analyzeProgression(input);

      expect(result.state).toBe('progress');
      expect(result.reason).toBe('REPS_EXCEEDED_RANGE');
      // No increment source provided → opportunity without invented suggestion.
      expect(result.suggestedWeightGrams).toBeUndefined();
    });

    it('maintain when reps at upper bound but not at target weight', () => {
      const sessions = [
        makeSessionWithPresc('s1', now - 86400000, 'Bench Press', [makeSet(50000, 10)], 'ex_bench'),
        makeSessionWithPresc('s2', now, 'Bench Press', [makeSet(45000, 12)], 'ex_bench'), // different weight
      ];
      const historicalPrescriptions = makeHistPrescMap([
        { sessionId: 's1', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
        { sessionId: 's2', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', { ...defaultHistoricalPrescription, targetWeightGrams: 45000 }, 'barbell') },
      ]);
      const input = { ...defaultInput, sessions, historicalPrescriptions, now };
      const result = analyzeProgression(input);

      expect(result.state).toBe('maintain');
      expect(result.reason).toBe('REPS_RANGE_COMPLETED');
      expect(result.atTargetWeight).toBe(false);
    });

    it('maintain when reps exceed upper bound but not at target weight', () => {
      const sessions = [
        makeSessionWithPresc('s1', now - 86400000, 'Bench Press', [makeSet(50000, 10)], 'ex_bench'),
        makeSessionWithPresc('s2', now, 'Bench Press', [makeSet(45000, 14)], 'ex_bench'),
      ];
      const historicalPrescriptions = makeHistPrescMap([
        { sessionId: 's1', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
        { sessionId: 's2', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', { ...defaultHistoricalPrescription, targetWeightGrams: 45000 }, 'barbell') },
      ]);
      const input = { ...defaultInput, sessions, historicalPrescriptions, now };
      const result = analyzeProgression(input);

      expect(result.state).toBe('maintain');
      expect(result.reason).toBe('REPS_EXCEEDED_RANGE');
      expect(result.atTargetWeight).toBe(false);
    });

    it('extra sets count as performances: a fourth set at the bound progresses (Phase 3C)', () => {
      // Prescription is 3 sets, but the athlete logged a 4th (extra) set at 12 reps.
      // The engine sees actual performances, not prescribed counts.
      const sessions = [
        makeSessionWithPresc('s1', now - 86400000, 'Bench Press', [makeSet(50000, 10)], 'ex_bench'),
        makeSessionWithPresc(
          's2',
          now,
          'Bench Press',
          [makeSet(50000, 10), makeSet(50000, 10), makeSet(50000, 10), makeSet(50000, 12)],
          'ex_bench',
        ),
      ];
      const historicalPrescriptions = makeHistPrescMap([
        { sessionId: 's1', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
        { sessionId: 's2', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
      ]);
      const input = { ...defaultInput, sessions, historicalPrescriptions, now };
      const result = analyzeProgression(input);

      expect(result.state).toBe('progress');
      expect(result.reason).toBe('REPS_RANGE_COMPLETED');
      expect(result.current?.reps).toBe(12);
    });

    it('returns insufficient_data when no rep range defined', () => {
      const sessions = [
        makeSessionWithPresc('s1', now - 86400000, 'Bench Press', [makeSet(50000, 10)], 'ex_bench'),
        makeSessionWithPresc('s2', now, 'Bench Press', [makeSet(50000, 12)], 'ex_bench'),
      ];
      const historicalPrescriptions = makeHistPrescMap([
        { sessionId: 's1', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
        { sessionId: 's2', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
      ]);
      const input = {
        ...defaultInput,
        sessions,
        historicalPrescriptions,
        currentPrescription: { ...defaultPrescription, targetRepsMin: null, targetRepsMax: null },
        now,
      };
      const result = analyzeProgression(input);

      expect(result.state).toBe('insufficient_data');
      expect(result.reason).toBe('NO_REPS_RANGE');
    });

    it('returns insufficient_data when invalid rep range (min > max)', () => {
      const sessions = [
        makeSessionWithPresc('s1', now - 86400000, 'Bench Press', [makeSet(50000, 10)], 'ex_bench'),
        makeSessionWithPresc('s2', now, 'Bench Press', [makeSet(50000, 12)], 'ex_bench'),
      ];
      const historicalPrescriptions = makeHistPrescMap([
        { sessionId: 's1', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
        { sessionId: 's2', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
      ]);
      const input = {
        ...defaultInput,
        sessions,
        historicalPrescriptions,
        currentPrescription: { ...defaultPrescription, targetRepsMin: 12, targetRepsMax: 8 },
        now,
      };
      const result = analyzeProgression(input);

      expect(result.state).toBe('insufficient_data');
      expect(result.reason).toBe('NO_REPS_RANGE');
    });

    it('returns insufficient_data when no target weight', () => {
      const sessions = [
        makeSessionWithPresc('s1', now - 86400000, 'Bench Press', [makeSet(50000, 10)], 'ex_bench'),
        makeSessionWithPresc('s2', now, 'Bench Press', [makeSet(50000, 12)], 'ex_bench'),
      ];
      const historicalPrescriptions = makeHistPrescMap([
        { sessionId: 's1', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
        { sessionId: 's2', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
      ]);
      const input = {
        ...defaultInput,
        sessions,
        historicalPrescriptions,
        currentPrescription: { ...defaultPrescription, targetWeightGrams: null },
        now,
      };
      const result = analyzeProgression(input);

      expect(result.state).toBe('insufficient_data');
      expect(result.reason).toBe('NO_CURRENT_WEIGHT');
    });

    it('maintain when reps below minimum even with sufficient history', () => {
      const sessions = [
        makeSessionWithPresc('s1', now - 2 * 86400000, 'Bench Press', [makeSet(50000, 10)], 'ex_bench'),
        makeSessionWithPresc('s2', now - 86400000, 'Bench Press', [makeSet(50000, 10)], 'ex_bench'),
        makeSessionWithPresc('s3', now, 'Bench Press', [makeSet(50000, 6)], 'ex_bench'),
      ];
      const historicalPrescriptions = makeHistPrescMap([
        { sessionId: 's1', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
        { sessionId: 's2', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
        { sessionId: 's3', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
      ]);
      const input = { ...defaultInput, sessions, historicalPrescriptions, now };
      const result = analyzeProgression(input);

      expect(result.state).toBe('maintain');
      expect(result.reason).toBe('REPS_BELOW_MIN');
    });

    it('progress with multiple historical performances', () => {
      const sessions = [
        makeSessionWithPresc('s1', now - 3 * 86400000, 'Bench Press', [makeSet(50000, 8)], 'ex_bench'),
        makeSessionWithPresc('s2', now - 2 * 86400000, 'Bench Press', [makeSet(50000, 9)], 'ex_bench'),
        makeSessionWithPresc('s3', now - 86400000, 'Bench Press', [makeSet(50000, 11)], 'ex_bench'),
        makeSessionWithPresc('s4', now, 'Bench Press', [makeSet(50000, 12)], 'ex_bench'),
      ];
      const historicalPrescriptions = makeHistPrescMap([
        { sessionId: 's1', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
        { sessionId: 's2', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
        { sessionId: 's3', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
        { sessionId: 's4', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
      ]);
      const input = { ...defaultInput, sessions, historicalPrescriptions, now };
      const result = analyzeProgression(input);

      expect(result.state).toBe('progress');
      expect(result.reason).toBe('REPS_RANGE_COMPLETED');
      expect(result.comparableCount).toBe(4);
    });

    it('uses most recent comparable as baseline', () => {
      const sessions = [
        makeSessionWithPresc('s1', now - 3 * 86400000, 'Bench Press', [makeSet(50000, 8)], 'ex_bench'),
        makeSessionWithPresc('s2', now - 2 * 86400000, 'Bench Press', [makeSet(50000, 10)], 'ex_bench'),
        makeSessionWithPresc('s3', now - 86400000, 'Bench Press', [makeSet(50000, 11)], 'ex_bench'),
        makeSessionWithPresc('s4', now, 'Bench Press', [makeSet(50000, 12)], 'ex_bench'),
      ];
      const historicalPrescriptions = makeHistPrescMap([
        { sessionId: 's1', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
        { sessionId: 's2', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
        { sessionId: 's3', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
        { sessionId: 's4', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
      ]);
      const input = { ...defaultInput, sessions, historicalPrescriptions, now };
      const result = analyzeProgression(input);

      expect(result.baseline?.sessionId).toBe('s3'); // most recent comparable
    });
  });

  describe('Explainability', () => {
    it('every outcome has a stable reason code', () => {
      const sessions = [
        makeSessionWithPresc('s1', now - 86400000, 'Bench Press', [makeSet(50000, 10)], 'ex_bench'),
        makeSessionWithPresc('s2', now, 'Bench Press', [makeSet(50000, 12)], 'ex_bench'),
      ];
      const historicalPrescriptions = makeHistPrescMap([
        { sessionId: 's1', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
        { sessionId: 's2', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
      ]);
      const input = { ...defaultInput, sessions, historicalPrescriptions, now };
      const result = analyzeProgression(input);

      const validReasons: ProgressionReason[] = [
        'REPS_RANGE_COMPLETED',
        'REPS_EXCEEDED_RANGE',
        'REPS_BELOW_MIN',
        'REPS_IN_RANGE',
        'INSUFFICIENT_HISTORY',
        'NO_COMPARABLE_PERFORMANCE',
        'PRESCRIPTION_MISMATCH',
        'NO_REPS_RANGE',
        'NO_CURRENT_WEIGHT',
        'NO_RIR_DATA',
        'SUBSTITUTION_USED',
        'PREVIOUS_SUBSTITUTION',
        'EQUIPMENT_MISMATCH',
        'TEMPO_MISMATCH',
      ];
      expect(validReasons).toContain(result.reason);
    });

    it('includes structured evidence for debugging', () => {
      const sessions = [
        makeSessionWithPresc('s1', now - 86400000, 'Bench Press', [makeSet(50000, 10)], 'ex_bench'),
        makeSessionWithPresc('s2', now, 'Bench Press', [makeSet(50000, 12)], 'ex_bench'),
      ];
      const historicalPrescriptions = makeHistPrescMap([
        { sessionId: 's1', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
        { sessionId: 's2', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
      ]);
      const input = { ...defaultInput, sessions, historicalPrescriptions, now };
      const result = analyzeProgression(input);

      expect(result.explanation).toBeDefined();
      expect(result.explanation.length).toBeGreaterThan(0);
      expect(result.baseline).toBeDefined();
      expect(result.current).toBeDefined();
      expect(result.currentPrescription).toEqual(defaultPrescription);
    });

    it('includes reps vs range evidence', () => {
      const sessions = [
        makeSessionWithPresc('s1', now - 86400000, 'Bench Press', [makeSet(50000, 10)], 'ex_bench'),
        makeSessionWithPresc('s2', now, 'Bench Press', [makeSet(50000, 12)], 'ex_bench'),
      ];
      const historicalPrescriptions = makeHistPrescMap([
        { sessionId: 's1', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
        { sessionId: 's2', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
      ]);
      const input = { ...defaultInput, sessions, historicalPrescriptions, now };
      const result = analyzeProgression(input);

      expect(result.repsVsRange).toEqual({
        achieved: 12,
        min: 8,
        max: 12,
      });
    });

    it('includes atTargetWeight flag', () => {
      const sessions = [
        makeSessionWithPresc('s1', now - 86400000, 'Bench Press', [makeSet(50000, 10)], 'ex_bench'),
        makeSessionWithPresc('s2', now, 'Bench Press', [makeSet(50000, 12)], 'ex_bench'),
      ];
      const historicalPrescriptions = makeHistPrescMap([
        { sessionId: 's1', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
        { sessionId: 's2', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
      ]);
      const input = { ...defaultInput, sessions, historicalPrescriptions, now };
      const result = analyzeProgression(input);

      expect(result.atTargetWeight).toBe(true);
    });

    it('includes suggested weight only from equipment inventory source', () => {
      const sessions = [
        makeSessionWithPresc('s1', now - 86400000, 'Bench Press', [makeSet(50000, 10)], 'ex_bench'),
        makeSessionWithPresc('s2', now, 'Bench Press', [makeSet(50000, 12)], 'ex_bench'),
      ];
      const historicalPrescriptions = makeHistPrescMap([
        { sessionId: 's1', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
        { sessionId: 's2', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
      ]);
      // Caller-derived next achievable load (real data, e.g. plate inventory).
      const input = { ...defaultInput, sessions, historicalPrescriptions, achievableNextWeightGrams: 52500, now };
      const result = analyzeProgression(input);

      expect(result.suggestedWeightGrams).toBe(52500);
      expect(result.weightIncrementSource).toBe('equipment_inventory');
    });

    it('reports increment source none when no achievable load is provided', () => {
      const sessions = [
        makeSessionWithPresc('s1', now - 86400000, 'Bench Press', [makeSet(50000, 10)], 'ex_bench'),
        makeSessionWithPresc('s2', now, 'Bench Press', [makeSet(50000, 12)], 'ex_bench'),
      ];
      const historicalPrescriptions = makeHistPrescMap([
        { sessionId: 's1', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
        { sessionId: 's2', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
      ]);
      const input = { ...defaultInput, sessions, historicalPrescriptions, now };
      const result = analyzeProgression(input);

      expect(result.state).toBe('progress');
      expect(result.suggestedWeightGrams).toBeUndefined();
      expect(result.weightIncrementSource).toBe('none');
    });

    it('includes baseline and current performances', () => {
      const sessions = [
        makeSessionWithPresc('s1', now - 86400000, 'Bench Press', [makeSet(50000, 10)], 'ex_bench'),
        makeSessionWithPresc('s2', now, 'Bench Press', [makeSet(50000, 12)], 'ex_bench'),
      ];
      const historicalPrescriptions = makeHistPrescMap([
        { sessionId: 's1', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
        { sessionId: 's2', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
      ]);
      const input = { ...defaultInput, sessions, historicalPrescriptions, now };
      const result = analyzeProgression(input);

      expect(result.baseline).toBeDefined();
      expect(result.current).toBeDefined();
      expect(result.baseline?.sessionId).toBe('s1');
      expect(result.current?.sessionId).toBe('s2');
    });

    it('includes comparability evidence', () => {
      const sessions = [
        makeSessionWithPresc('s1', now - 86400000, 'Bench Press', [makeSet(50000, 10)], 'ex_bench'),
        makeSessionWithPresc('s2', now, 'Bench Press', [makeSet(50000, 12)], 'ex_bench'),
      ];
      const historicalPrescriptions = makeHistPrescMap([
        { sessionId: 's1', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
        { sessionId: 's2', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
      ]);
      const input = { ...defaultInput, sessions, historicalPrescriptions, now };
      const result = analyzeProgression(input);

      expect(result.comparability).toBeDefined();
      expect(result.comparability?.comparable).toBe(true);
      expect(result.comparability?.identityMatch).toBe('seed_id');
      expect(result.comparability?.prescriptionMatch).toBe(true);
      expect(result.comparability?.equipmentMatch).toBe(true);
    });

    it('includes weight increment source', () => {
      const sessions = [
        makeSessionWithPresc('s1', now - 86400000, 'Bench Press', [makeSet(50000, 10)], 'ex_bench'),
        makeSessionWithPresc('s2', now, 'Bench Press', [makeSet(50000, 12)], 'ex_bench'),
      ];
      const historicalPrescriptions = makeHistPrescMap([
        { sessionId: 's1', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
        { sessionId: 's2', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
      ]);
      const input = { ...defaultInput, sessions, historicalPrescriptions, now };
      const result = analyzeProgression(input);

      expect(result.weightIncrementSource).toBe('none');
    });
  });

  describe('Edge cases', () => {
    it('returns insufficient_data for zero performances', () => {
      const input = { ...defaultInput, sessions: [], now };
      const result = analyzeProgression(input);

      expect(result.state).toBe('insufficient_data');
      expect(result.reason).toBe('NO_COMPARABLE_PERFORMANCE');
    });

    it('returns insufficient_data when only substitution performances exist', () => {
      const subExercises: SubstitutionExercise[] = [
        { id: 'ex_db_press', name: 'Dumbbell Bench Press', category: 'push', equipment: 'dumbbell', metricFlags: 0, contributions: null },
      ];
      const sessions = [
        makeSessionWithPresc('s1', now - 86400000, 'Dumbbell Bench Press', [makeSet(25000, 10)], 'ex_db_press'),
      ];
      const historicalPrescriptions = makeHistPrescMap([
        { sessionId: 's1', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Dumbbell Bench Press', 'ex_db_press', defaultHistoricalPrescription, 'dumbbell', true) },
      ]);
      const input = { ...defaultInput, sessions, historicalPrescriptions, availableExercises: subExercises, now };
      const result = analyzeProgression(input);

      expect(result.state).toBe('insufficient_data');
      expect(result.reason).toBe('NO_COMPARABLE_PERFORMANCE');
    });

    it('returns maintain for reps_in_range with multiple history', () => {
      const sessions = [
        makeSessionWithPresc('s1', now - 2 * 86400000, 'Bench Press', [makeSet(50000, 9)], 'ex_bench'),
        makeSessionWithPresc('s2', now - 86400000, 'Bench Press', [makeSet(50000, 10)], 'ex_bench'),
        makeSessionWithPresc('s3', now, 'Bench Press', [makeSet(50000, 10)], 'ex_bench'),
      ];
      const historicalPrescriptions = makeHistPrescMap([
        { sessionId: 's1', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
        { sessionId: 's2', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
        { sessionId: 's3', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
      ]);
      const input = { ...defaultInput, sessions, historicalPrescriptions, now };
      const result = analyzeProgression(input);

      expect(result.state).toBe('maintain');
      expect(result.reason).toBe('REPS_IN_RANGE');
    });

    it('returns progress when reps exceeded range at target weight', () => {
      const sessions = [
        makeSessionWithPresc('s1', now - 86400000, 'Bench Press', [makeSet(50000, 10)], 'ex_bench'),
        makeSessionWithPresc('s2', now, 'Bench Press', [makeSet(50000, 15)], 'ex_bench'),
      ];
      const historicalPrescriptions = makeHistPrescMap([
        { sessionId: 's1', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
        { sessionId: 's2', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
      ]);
      const input = { ...defaultInput, sessions, historicalPrescriptions, now };
      const result = analyzeProgression(input);

      expect(result.state).toBe('progress');
      expect(result.reason).toBe('REPS_EXCEEDED_RANGE');
      // No increment source provided → opportunity without invented suggestion.
      expect(result.suggestedWeightGrams).toBeUndefined();
    });

    it('returns maintain for reps_below_min', () => {
      const sessions = [
        makeSessionWithPresc('s1', now - 86400000, 'Bench Press', [makeSet(50000, 10)], 'ex_bench'),
        makeSessionWithPresc('s2', now, 'Bench Press', [makeSet(50000, 5)], 'ex_bench'),
      ];
      const historicalPrescriptions = makeHistPrescMap([
        { sessionId: 's1', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
        { sessionId: 's2', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
      ]);
      const input = { ...defaultInput, sessions, historicalPrescriptions, now };
      const result = analyzeProgression(input);

      expect(result.state).toBe('maintain');
      expect(result.reason).toBe('REPS_BELOW_MIN');
    });

    it('returns insufficient_data when current prescription has no rep range', () => {
      const sessions = [
        makeSessionWithPresc('s1', now - 86400000, 'Bench Press', [makeSet(50000, 10)], 'ex_bench'),
        makeSessionWithPresc('s2', now, 'Bench Press', [makeSet(50000, 12)], 'ex_bench'),
      ];
      const historicalPrescriptions = makeHistPrescMap([
        { sessionId: 's1', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
        { sessionId: 's2', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
      ]);
      const input = {
        ...defaultInput,
        sessions,
        historicalPrescriptions,
        currentPrescription: { ...defaultPrescription, targetRepsMin: null, targetRepsMax: null },
        now,
      };
      const result = analyzeProgression(input);

      expect(result.state).toBe('insufficient_data');
      expect(result.reason).toBe('NO_REPS_RANGE');
    });

    it('returns insufficient_data when current prescription has no target weight', () => {
      const sessions = [
        makeSessionWithPresc('s1', now - 86400000, 'Bench Press', [makeSet(50000, 10)], 'ex_bench'),
        makeSessionWithPresc('s2', now, 'Bench Press', [makeSet(50000, 12)], 'ex_bench'),
      ];
      const historicalPrescriptions = makeHistPrescMap([
        { sessionId: 's1', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
        { sessionId: 's2', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
      ]);
      const input = {
        ...defaultInput,
        sessions,
        historicalPrescriptions,
        currentPrescription: { ...defaultPrescription, targetWeightGrams: null },
        now,
      };
      const result = analyzeProgression(input);

      expect(result.state).toBe('insufficient_data');
      expect(result.reason).toBe('NO_CURRENT_WEIGHT');
    });

    it('returns insufficient_data for invalid rep range (min > max)', () => {
      const sessions = [
        makeSessionWithPresc('s1', now - 86400000, 'Bench Press', [makeSet(50000, 10)], 'ex_bench'),
        makeSessionWithPresc('s2', now, 'Bench Press', [makeSet(50000, 12)], 'ex_bench'),
      ];
      const historicalPrescriptions = makeHistPrescMap([
        { sessionId: 's1', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
        { sessionId: 's2', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
      ]);
      const input = {
        ...defaultInput,
        sessions,
        historicalPrescriptions,
        currentPrescription: { ...defaultPrescription, targetRepsMin: 15, targetRepsMax: 10 },
        now,
      };
      const result = analyzeProgression(input);

      expect(result.state).toBe('insufficient_data');
      expect(result.reason).toBe('NO_REPS_RANGE');
    });

    it('returns insufficient_data for min = max = 0', () => {
      const sessions = [
        makeSessionWithPresc('s1', now - 86400000, 'Bench Press', [makeSet(50000, 10)], 'ex_bench'),
        makeSessionWithPresc('s2', now, 'Bench Press', [makeSet(50000, 12)], 'ex_bench'),
      ];
      const historicalPrescriptions = makeHistPrescMap([
        { sessionId: 's1', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
        { sessionId: 's2', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
      ]);
      const input = {
        ...defaultInput,
        sessions,
        historicalPrescriptions,
        currentPrescription: { ...defaultPrescription, targetRepsMin: 0, targetRepsMax: 0 },
        now,
      };
      const result = analyzeProgression(input);

      expect(result.state).toBe('insufficient_data');
      expect(result.reason).toBe('NO_REPS_RANGE');
    });

    it('returns insufficient_data when equipment class changes', () => {
      const sessions = [
        makeSessionWithPresc('s1', now - 86400000, 'Bench Press', [makeSet(50000, 10)], 'ex_bench'),
        makeSessionWithPresc('s2', now, 'Bench Press', [makeSet(50000, 12)], 'ex_bench'),
      ];
      const historicalPrescriptions = makeHistPrescMap([
        { sessionId: 's1', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
        { sessionId: 's2', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'dumbbell') },
      ]);
      const input = { ...defaultInput, sessions, historicalPrescriptions, currentEquipmentClass: 'barbell', now };
      const result = analyzeProgression(input);

      expect(result.state).toBe('insufficient_data');
      expect(result.reason).toBe('EQUIPMENT_MISMATCH');
    });
  });

  describe('Reason code completeness', () => {
    it('covers all progression states', () => {
      // progress
      const sessions1 = [
        makeSessionWithPresc('s1', now - 86400000, 'Bench Press', [makeSet(50000, 10)]),
        makeSessionWithPresc('s2', now, 'Bench Press', [makeSet(50000, 12)]),
      ];
      const hist1 = makeHistPrescMap([
        { sessionId: 's1', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
        { sessionId: 's2', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
      ]);
      expect(analyzeProgression({ ...defaultInput, sessions: sessions1, historicalPrescriptions: hist1, now }).state).toBe('progress');

      // maintain
      const sessions2 = [
        makeSessionWithPresc('s1', now - 86400000, 'Bench Press', [makeSet(50000, 10)]),
        makeSessionWithPresc('s2', now, 'Bench Press', [makeSet(50000, 10)]),
      ];
      const hist2 = makeHistPrescMap([
        { sessionId: 's1', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
        { sessionId: 's2', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
      ]);
      expect(analyzeProgression({ ...defaultInput, sessions: sessions2, historicalPrescriptions: hist2, now }).state).toBe('maintain');

      // insufficient_data
      expect(analyzeProgression({ ...defaultInput, sessions: [], now }).state).toBe('insufficient_data');
    });
  });

  describe('actual RIR (1.1.0)', () => {
    function rirSessions(currentRir: number | null | undefined, baselineRir: number | null | undefined) {
      const withRir = (r: number | null | undefined) =>
        r === undefined ? makeSet(50000, 10) : { ...makeSet(50000, 10), actualRir: r };
      const sessions = [
        makeSessionWithPresc('s1', now - 86400000, 'Bench Press', [withRir(baselineRir)]),
        makeSessionWithPresc('s2', now, 'Bench Press', [withRir(currentRir)]),
      ];
      const historicalPrescriptions = makeHistPrescMap([
        { sessionId: 's1', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
        { sessionId: 's2', exerciseName: 'Bench Press', presc: makeHistoricalPrescription('Bench Press', 'ex_bench', defaultHistoricalPrescription, 'barbell') },
      ]);
      return analyzeProgression({ ...defaultInput, sessions, historicalPrescriptions, now });
    }

    it('carries logged actual RIR into current and baseline performances', () => {
      const result = rirSessions(1, 3);
      expect(result.current?.actualRir).toBe(1);
      expect(result.baseline?.actualRir).toBe(3);
    });

    it('keeps missing actual RIR as null, never 0', () => {
      const result = rirSessions(undefined, undefined);
      expect(result.current?.actualRir).toBeNull();
      expect(result.baseline?.actualRir).toBeNull();
    });

    it('preserves an actual RIR of 0 distinctly from missing', () => {
      const result = rirSessions(0, null);
      expect(result.current?.actualRir).toBe(0);
      expect(result.baseline?.actualRir).toBeNull();
    });

    it('does not change the verdict based on RIR presence alone', () => {
      expect(rirSessions(1, 3).state).toBe(rirSessions(undefined, undefined).state);
    });
  });
});