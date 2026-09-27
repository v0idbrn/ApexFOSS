import {
  classifySetExecution,
  normalizeExecutionType,
  normalizeOverrideReason,
  EXECUTION_TYPES,
  OVERRIDE_REASONS,
} from './execution';

const PRESC = {
  targetWeightGrams: 60_000,
  targetRepsMin: 10,
  targetRepsMax: 10,
  targetDurationMs: null,
  targetRir: 2,
};

describe('classifySetExecution (prescription vs actual)', () => {
  it('normal when actual matches prescription exactly', () => {
    expect(
      classifySetExecution(PRESC, { weightGrams: 60_000, reps: 10, durationMs: null, rir: 2 }),
    ).toBe('normal');
  });

  it('modified on fewer reps (case 1/5)', () => {
    expect(
      classifySetExecution(PRESC, { weightGrams: 60_000, reps: 9, durationMs: null, rir: 2 }),
    ).toBe('modified');
  });

  it('modified on reduced load (case 2)', () => {
    expect(
      classifySetExecution(PRESC, { weightGrams: 55_000, reps: 10, durationMs: null, rir: 2 }),
    ).toBe('modified');
  });

  it('modified on extra reps (case 3)', () => {
    expect(
      classifySetExecution(PRESC, { weightGrams: 60_000, reps: 12, durationMs: null, rir: 2 }),
    ).toBe('modified');
  });

  it('modified on increased load (case 4)', () => {
    expect(
      classifySetExecution(PRESC, { weightGrams: 62_500, reps: 10, durationMs: null, rir: 2 }),
    ).toBe('modified');
  });

  it('normal for reps inside a range', () => {
    const range = { ...PRESC, targetRepsMin: 8, targetRepsMax: 12 };
    expect(classifySetExecution(range, { weightGrams: 60_000, reps: 10, durationMs: null, rir: 2 })).toBe(
      'normal',
    );
    expect(classifySetExecution(range, { weightGrams: 60_000, reps: 8, durationMs: null, rir: 2 })).toBe(
      'normal',
    );
    expect(classifySetExecution(range, { weightGrams: 60_000, reps: 12, durationMs: null, rir: 2 })).toBe(
      'normal',
    );
  });

  it('modified for reps outside a range', () => {
    const range = { ...PRESC, targetRepsMin: 8, targetRepsMax: 12 };
    expect(classifySetExecution(range, { weightGrams: 60_000, reps: 7, durationMs: null, rir: 2 })).toBe(
      'modified',
    );
    expect(classifySetExecution(range, { weightGrams: 60_000, reps: 13, durationMs: null, rir: 2 })).toBe(
      'modified',
    );
  });

  it('normal when prescription is absent', () => {
    expect(classifySetExecution(null, { weightGrams: 60_000, reps: 10, durationMs: null, rir: 2 })).toBe(
      'normal',
    );
    expect(
      classifySetExecution(undefined, { weightGrams: 60_000, reps: 10, durationMs: null, rir: 2 }),
    ).toBe('normal');
  });

  it('modified on changed RIR and changed duration', () => {
    expect(
      classifySetExecution(PRESC, { weightGrams: 60_000, reps: 10, durationMs: null, rir: 1 }),
    ).toBe('modified');
    expect(
      classifySetExecution(
        { ...PRESC, targetDurationMs: 60_000 },
        { weightGrams: 60_000, reps: 10, durationMs: 45_000, rir: 2 },
      ),
    ).toBe('modified');
  });

  it('normal when neither side prescribes a value (null vs null)', () => {
    const empty = {
      targetWeightGrams: null,
      targetRepsMin: null,
      targetRepsMax: null,
      targetDurationMs: null,
      targetRir: null,
    };
    expect(
      classifySetExecution(empty, { weightGrams: null, reps: null, durationMs: null, rir: null }),
    ).toBe('normal');
  });

  it('modified when actual is missing against an existing target', () => {
    expect(
      classifySetExecution(PRESC, { weightGrams: null, reps: 10, durationMs: null, rir: 2 }),
    ).toBe('modified');
  });
});

describe('closed vocabularies', () => {
  it('accepts the five execution types and rejects the rest', () => {
    for (const t of EXECUTION_TYPES) expect(normalizeExecutionType(t)).toBe(t);
    expect(EXECUTION_TYPES).toHaveLength(5);
    expect(normalizeExecutionType('deleted')).toBeNull();
    expect(normalizeExecutionType(null)).toBeNull();
    expect(normalizeExecutionType(undefined)).toBeNull();
    expect(normalizeExecutionType(42)).toBeNull();
  });

  it('accepts the nine override reasons and rejects the rest', () => {
    for (const r of OVERRIDE_REASONS) expect(normalizeOverrideReason(r)).toBe(r);
    expect(OVERRIDE_REASONS).toHaveLength(9);
    expect(normalizeOverrideReason('tired')).toBeNull();
    expect(normalizeOverrideReason('')).toBeNull();
    expect(normalizeOverrideReason(null)).toBeNull();
  });

});
