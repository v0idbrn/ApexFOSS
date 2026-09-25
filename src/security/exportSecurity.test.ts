import { sessionsToCsv, sessionsToJson, CSV_HEADER } from '../export/export';
import type { HistoryDetail } from '../data/history';

/**
 * CSV formula-injection guard + escaping regressions (spec section 13,
 * SECURITY_AUDIT mitigation). Imported routine/exercise names are untrusted
 * content once a portable package has been imported.
 */

function detail(name: string, exerciseName: string, actualWeightGrams: number | null = 50_000): HistoryDetail {
  return {
    id: 'sess_x',
    name,
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_600_000,
    durationMs: 600_000,
    status: 'completed',
    definition: {
      id: 'r1',
      name,
      blocks: [
        {
          id: 'b1',
          name: 'Main',
          kind: 'normal',
          rounds: 1,
          steps: [
            {
              id: 's1',
              role: 'work',
              exerciseId: 'e1',
              exerciseName,
              prescription: {
                targetSets: 1,
                targetRepsMin: 5,
                targetRepsMax: null,
                targetDurationMs: null,
                targetWeightGrams: null,
                targetRir: null,
                tempo: { eccentricMs: null, pauseBottomMs: null, concentricMs: null, pauseTopMs: null },
              },
            },
          ],
          transitions: [],
        },
      ],
    },
    blocks: [
      {
        blockIndex: 0,
        name: 'Main',
        kind: 'normal',
        rounds: 1,
        steps: [
          {
            stepIndex: 0,
            exerciseName,
            targetSets: 1,
            targetRepsMin: 5,
            targetRepsMax: null,
            targetWeightGrams: null,
            targetDurationMs: null,
            targetRir: null,
            logs: [
              {
                blockIndex: 0,
                stepIndex: 0,
                round: 1,
                setIndex: 1,
                weightGrams: actualWeightGrams,
                reps: 5,
                durationMs: null,
                rir: 2,
              },
            ],
          },
        ],
      },
    ],
    totalCompletedSets: 1,
  };
}

function dataLines(csv: string): string[] {
  return csv.trim().split('\r\n').slice(1);
}

describe('CSV formula-injection guard (spec section 13)', () => {
  it('neutralizes a routine name starting with =', () => {
    const csv = sessionsToCsv([detail('=SUM(A1:A9)', 'Bench Press')]);
    expect(dataLines(csv)[0]).toContain(",'=SUM(A1:A9),");
  });

  it('neutralizes an imported exercise name starting with +', () => {
    const csv = sessionsToCsv([detail('Push Day', '+1+1')]);
    expect(dataLines(csv)[0]).toContain(",'+1+1,");
  });

  it('neutralizes an imported exercise name starting with @', () => {
    const csv = sessionsToCsv([detail('Push Day', '@import')]);
    expect(dataLines(csv)[0]).toContain(",'@import,");
  });

  it('neutralizes a leading minus that is not a number', () => {
    const csv = sessionsToCsv([detail('Push Day', '-rm -rf /')]);
    expect(dataLines(csv)[0]).toContain(",'-rm -rf /,");
  });

  it('leaves legitimate negative numbers untouched', () => {
    const csv = sessionsToCsv([detail('Push Day', 'Bench Press', -5_000)]);
    expect(dataLines(csv)[0]).not.toContain("'-5");
    expect(dataLines(csv)[0]).toContain(',-5,');
  });

  it('still wraps values that contain separators', () => {
    const csv = sessionsToCsv([detail('=X,Y', 'Bench Press')]);
    expect(dataLines(csv)[0]).toContain(`"'=X,Y"`);
  });
});

describe('CSV escaping regressions (RFC 4180)', () => {
  it('escapes embedded quotes', () => {
    const csv = sessionsToCsv([detail('Push Day', 'a"b')]);
    expect(dataLines(csv)[0]).toContain('"a""b"');
  });

  it('keeps comma and newline values quoted', () => {
    const csv = sessionsToCsv([detail('Push Day', 'X,Y\nZ')]);
    expect(dataLines(csv)[0]).toContain('"X,Y\nZ"');
  });

  it('header is unchanged by the guard', () => {
    expect(sessionsToCsv([]).trim()).toBe(CSV_HEADER.join(','));
  });

  it('null cells stay empty', () => {
    const d = detail('Push Day', 'Bench Press', null);
    d.blocks[0].steps[0].logs[0].rir = null;
    const csv = sessionsToCsv([d]);
    const line = dataLines(csv)[0];
    expect(line.endsWith(',')).toBe(true);
  });
});

describe('JSON export keeps raw fidelity (guard is CSV-only)', () => {
  it('preserves hostile-looking names verbatim in JSON', () => {
    const json = JSON.parse(sessionsToJson([detail('=SUM(A1)', 'Bench Press')], '2026-01-01T00:00:00.000Z'));
    expect(json.sessions[0].name).toBe('=SUM(A1)');
    expect(json.sessions[0].definition.name).toBe('=SUM(A1)');
  });
});
