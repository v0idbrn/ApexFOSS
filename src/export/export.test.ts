import { sessionsToCsv, sessionsToJson, CSV_HEADER } from './export';
import type { HistoryDetail } from '../data/history';

function makeDetail(overrides?: Partial<HistoryDetail>): HistoryDetail {
  const base: HistoryDetail = {
    id: 'sess_1',
    name: 'Push Day',
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_600_000,
    durationMs: 600_000,
    status: 'completed',
    definition: {
      id: 'r1',
      name: 'Push Day',
      blocks: [
        {
          id: 'b1',
          name: 'Main',
          kind: 'normal',
          rounds: 2,
          steps: [
            {
              id: 's1',
              role: 'work',
              exerciseId: 'e1',
              exerciseName: 'Bench Press',
              prescription: {
                targetSets: 3,
                targetRepsMin: 5,
                targetRepsMax: 5,
                targetDurationMs: null,
                targetWeightGrams: 100_000,
                targetRir: 2,
                tempo: {
                  eccentricMs: 3000,
                  pauseBottomMs: 0,
                  concentricMs: 1000,
                  pauseTopMs: 0,
                },
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
        rounds: 2,
        steps: [
          {
            stepIndex: 0,
            exerciseName: 'Bench Press',
            targetSets: 3,
            targetRepsMin: 5,
            targetRepsMax: 5,
            targetWeightGrams: 100_000,
            targetDurationMs: null,
            targetRir: 2,
            logs: [
              {
                blockIndex: 0,
                stepIndex: 0,
                round: 1,
                setIndex: 1,
                weightGrams: 102_500,
                reps: 5,
                durationMs: null,
                rir: 2,
              },
              {
                blockIndex: 0,
                stepIndex: 0,
                round: 1,
                setIndex: 2,
                weightGrams: 102_500,
                reps: 4,
                durationMs: null,
                rir: 1,
              },
              {
                blockIndex: 0,
                stepIndex: 0,
                round: 2,
                setIndex: 1,
                weightGrams: null,
                reps: null,
                durationMs: null,
                rir: null,
              },
            ],
          },
        ],
      },
    ],
    totalCompletedSets: 3,
  };
  return { ...base, ...overrides };
}

describe('CSV export', () => {
  it('empty history → header only, no fake rows', () => {
    const csv = sessionsToCsv([]);
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(CSV_HEADER.join(','));
  });

  it('exports real set rows with kg and seconds display units', () => {
    const csv = sessionsToCsv([makeDetail()]);
    const lines = csv.trim().split('\r\n');
    // header + 3 logged sets
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain('sess_1');
    expect(lines[1]).toContain('Push Day');
    expect(lines[1]).toContain('Bench Press');
    expect(lines[1]).toContain('102.5'); // actual kg from 102500 g
    expect(lines[1]).toContain('3-0-1-0'); // tempo
    // null optional actual fields → empty cells, not fabricated 0
    const last = lines[3];
    const cells = last.split(',');
    // actual_weight_kg, actual_reps, actual_duration_s, actual_rir at end
    expect(cells[cells.length - 1]).toBe(''); // actual_rir null
    expect(last.endsWith(',')).toBe(true);
  });

  it('handles commas, quotes, and newlines in names via RFC4180 escaping', () => {
    const d = makeDetail({
      name: 'Day "A", hard\nloop',
      blocks: [
        {
          blockIndex: 0,
          name: 'Block, with comma',
          kind: 'normal',
          rounds: 1,
          steps: [
            {
              stepIndex: 0,
              exerciseName: 'Incline "DB" Press, steep',
              targetSets: 1,
              targetRepsMin: null,
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
                  weightGrams: null,
                  reps: 8,
                  durationMs: null,
                  rir: null,
                },
              ],
            },
          ],
        },
      ],
      totalCompletedSets: 1,
    });
    const csv = sessionsToCsv([d]);
    expect(csv).toContain('"Day ""A"", hard\nloop"');
    expect(csv).toContain('"Block, with comma"');
    expect(csv).toContain('"Incline ""DB"" Press, steep"');
    // structural integrity: quoted fields with commas do not break row count
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(2);
  });

  it('multiple sessions all appear', () => {
    const a = makeDetail({ id: 's1', name: 'Alpha' });
    const b = makeDetail({ id: 's2', name: 'Beta' });
    const csv = sessionsToCsv([a, b]);
    expect(csv).toContain('s1');
    expect(csv).toContain('s2');
    expect(csv).toContain('Alpha');
    expect(csv).toContain('Beta');
  });

  it('does not invent values for null optional fields', () => {
    const d = makeDetail();
    d.blocks[0].steps[0].logs[0] = {
      blockIndex: 0,
      stepIndex: 0,
      round: 1,
      setIndex: 1,
      weightGrams: null,
      reps: null,
      durationMs: null,
      rir: null,
    };
    const csv = sessionsToCsv([d]);
    const dataLine = csv.trim().split('\r\n')[1];
    // last four columns empty
    expect(dataLine.endsWith(',,,')).toBe(true);
    expect(dataLine).not.toMatch(/,,0,/);
  });

  it('multiline CSV stays parseable (CRLF record separators)', () => {
    const d = makeDetail({
      name: 'Line1\nLine2',
    });
    const csv = sessionsToCsv([d]);
    // escaped newline is inside quotes — records still end with \r\n outside quotes
    expect(csv).toContain('"Line1\nLine2"');
    expect(csv.endsWith('\r\n')).toBe(true);
  });
});

describe('JSON export', () => {
  it('empty history → valid structure with empty sessions', () => {
    const json = JSON.parse(sessionsToJson([], '2026-09-25T00:00:00.000Z'));
    expect(json.format).toBe('apexfoss-export');
    expect(json.formatVersion).toBe(1);
    expect(json.sessions).toEqual([]);
    expect(json.exportedAt).toBe('2026-09-25T00:00:00.000Z');
  });

  it('preserves structured data, raw integer units, and definition snapshot', () => {
    const json = JSON.parse(sessionsToJson([makeDetail()], '2026-09-25T00:00:00.000Z'));
    expect(json.sessions).toHaveLength(1);
    const s = json.sessions[0];
    expect(s.id).toBe('sess_1');
    expect(s.blocks[0].steps[0].logs[0].weightGrams).toBe(102_500); // raw grams
    expect(s.definition.blocks[0].steps[0].exerciseName).toBe('Bench Press');
    expect(s.durationMs).toBe(600_000);
  });

  it('handles special characters without corruption', () => {
    const d = makeDetail({ name: 'Ünïcode, "quoted"\nrow' });
    const text = sessionsToJson([d], '2026-09-25T00:00:00.000Z');
    const parsed = JSON.parse(text);
    expect(parsed.sessions[0].name).toBe('Ünïcode, "quoted"\nrow');
  });

  it('multiple sessions preserved in order', () => {
    const json = JSON.parse(
      sessionsToJson([makeDetail({ id: 'a' }), makeDetail({ id: 'b' })], '2026-09-25T00:00:00.000Z'),
    );
    expect(json.sessions.map((s: { id: string }) => s.id)).toEqual(['a', 'b']);
  });
});
