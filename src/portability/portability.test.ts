import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import { schema } from '../data/schema';
import { migrations } from '../data/migrations';
import { modelClasses } from '../data/models';
import { makeDbActions } from '../data/actions';
import { emptyPrescription, type RoutineDraft } from '../types/draft';
import {
  buildRoutinePackageFromDraft,
  parseRoutinePackage,
  serializeRoutinePackage,
  countSteps,
} from './routinePackage';
import { canonicalJson, semanticChecksum, sha256Hex, base64UrlEncode, base64UrlDecode } from './canonical';
import { PortabilityError, ROUTINE_FORMAT_VERSION, MAX_PORTABLE_PAYLOAD_BYTES } from './types';
import {
  buildImportDeepLink,
  parseImportDeepLink,
  routineFromDeepLink,
  decodeRoutineTransport,
  encodeRoutineTransport,
  fitsSingleTransport,
} from './encoding';
import { uniqueRoutineName, exerciseMatchKey } from './importRoutine';
import { fitsQr, encodeQr } from './qr';

function makeDb(): Database {
  const adapter = new LokiJSAdapter({
    dbName: `apex-port-${Math.random().toString(36).slice(2)}`,
    schema,
    migrations,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
  });
  return new Database({ adapter, modelClasses: modelClasses as any });
}

const meta = (id: string, name: string, cat = 'legs', eq = 'barbell', flags = 3) =>
  new Map([[id, { name, category: cat, equipment: eq, metricFlags: flags }]]);

function sampleDraft(): RoutineDraft {
  return {
    id: 'local_r1',
    name: 'Push Day',
    blocks: [
      {
        localId: 'b1',
        name: 'Main',
        kind: 'normal',
        rounds: 3,
        steps: [
          {
            localId: 's1',
            exerciseId: 'ex1',
            exerciseName: 'Bench Press',
            prescription: {
              ...emptyPrescription(),
              targetSets: 3,
              targetRepsMin: 5,
              targetRepsMax: 8,
              targetWeightGrams: 80000,
              tempo: { eccentricMs: 3000, pauseBottomMs: 0, concentricMs: 1000, pauseTopMs: 0 },
            },
            transition: { type: 'rest', delayMs: 90_000 },
          },
          {
            localId: 's2',
            exerciseId: 'ex2',
            exerciseName: 'OHP',
            prescription: emptyPrescription(),
            transition: { type: 'immediate', delayMs: 0 },
          },
        ],
      },
    ],
  };
}

function intervalDraft(): RoutineDraft {
  return {
    id: 'local_r2',
    name: 'Engine',
    blocks: [
      {
        localId: 'b1',
        name: 'Int',
        kind: 'interval',
        rounds: 1,
        interval: { mode: 'emom', workMs: 20_000, restMs: 0, rounds: 5, periodMs: 60_000, preparationMs: 10_000 },
        steps: [],
      },
    ],
  };
}

describe('canonical / integrity', () => {
  it('canonicalJson sorts keys deterministically', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ a: 2, b: 1 })).toBe(canonicalJson({ b: 1, a: 2 }));
  });

  it('canonicalJson rejects floats and non-finite', () => {
    expect(() => canonicalJson({ x: 1.5 })).toThrow();
    expect(() => canonicalJson({ x: NaN })).toThrow();
  });

  it('sha256 known vector empty string', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('sha256 known vector abc', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('base64url round trip', () => {
    const s = 'apexfoss://import?d=hello-world_123';
    expect(base64UrlDecode(base64UrlEncode(s))).toBe(s);
  });

  it('base64url rejects invalid alphabet', () => {
    expect(() => base64UrlDecode('abc+def')).toThrow();
  });
});

describe('portable routine package', () => {
  it('builds package with format + version', () => {
    const metaMap = new Map([
      ['ex1', { name: 'Bench Press', category: 'push', equipment: 'barbell', metricFlags: 3 }],
      ['ex2', { name: 'OHP', category: 'push', equipment: 'barbell', metricFlags: 3 }],
    ]);
    const pkg = buildRoutinePackageFromDraft(sampleDraft(), metaMap, 1000);
    expect(pkg.format).toBe('apexfoss-routine');
    expect(pkg.formatVersion).toBe(ROUTINE_FORMAT_VERSION);
    expect(pkg.exercises).toHaveLength(2);
    expect(pkg.exercises[0].key).toBe('e1');
    expect(pkg.routine.blocks[0].steps[0].exerciseKey).toBe('e1');
    expect(pkg.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('preserves prescriptions, tempo, transitions, interval', () => {
    const metaMap = new Map([
      ['ex1', { name: 'Bench Press', category: 'push', equipment: 'barbell', metricFlags: 3 }],
      ['ex2', { name: 'OHP', category: 'push', equipment: 'barbell', metricFlags: 3 }],
    ]);
    const pkg = buildRoutinePackageFromDraft(sampleDraft(), metaMap, 1);
    const step = pkg.routine.blocks[0].steps[0];
    expect(step.prescription.targetWeightGrams).toBe(80000);
    expect(step.prescription.tempo.eccentricMs).toBe(3000);
    expect(step.transition).toEqual({ type: 'rest', delayMs: 90_000 });

    // interval via empty steps is rejected by validate — use a valid interval block with a step
    const withStep: RoutineDraft = {
      id: 'x',
      name: 'Int',
      blocks: [
        {
          localId: 'b',
          name: 'Int',
          kind: 'interval',
          rounds: 1,
          interval: { mode: 'hiit', workMs: 30_000, restMs: 15_000, rounds: 8, periodMs: null, preparationMs: 0 },
          steps: [
            {
              localId: 's',
              exerciseId: null,
              exerciseName: '',
              prescription: emptyPrescription(),
              transition: { type: 'immediate', delayMs: 0 },
            },
          ],
        },
      ],
    };
    const pkg2 = buildRoutinePackageFromDraft(withStep, new Map(), 1);
    expect(pkg2.routine.blocks[0].interval?.mode).toBe('hiit');
    expect(pkg2.routine.blocks[0].rounds).toBe(1);
  });

  it('deterministic serialization ignores exportedAt for checksum', () => {
    const metaMap = new Map([
      ['ex1', { name: 'Bench Press', category: 'push', equipment: 'barbell', metricFlags: 3 }],
      ['ex2', { name: 'OHP', category: 'push', equipment: 'barbell', metricFlags: 3 }],
    ]);
    const a = buildRoutinePackageFromDraft(sampleDraft(), metaMap, 111);
    const b = buildRoutinePackageFromDraft(sampleDraft(), metaMap, 999);
    expect(a.checksum).toBe(b.checksum);
    expect(canonicalJson({ routine: a.routine, exercises: a.exercises })).toBe(
      canonicalJson({ routine: b.routine, exercises: b.exercises }),
    );
  });

  it('parse rejects wrong format', () => {
    const metaMap = new Map([
      ['ex1', { name: 'Bench Press', category: 'push', equipment: 'barbell', metricFlags: 3 }],
      ['ex2', { name: 'OHP', category: 'push', equipment: 'barbell', metricFlags: 3 }],
    ]);
    const pkg = buildRoutinePackageFromDraft(sampleDraft(), metaMap, 1);
    const raw = JSON.parse(JSON.stringify(pkg));
    raw.format = 'other';
    try {
      parseRoutinePackage(JSON.stringify(raw));
      throw new Error('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(PortabilityError);
      expect((e as PortabilityError).code).toBe('wrong_format');
    }
  });

  it('parse rejects unsupported version', () => {
    const metaMap = new Map([
      ['ex1', { name: 'Bench Press', category: 'push', equipment: 'barbell', metricFlags: 3 }],
      ['ex2', { name: 'OHP', category: 'push', equipment: 'barbell', metricFlags: 3 }],
    ]);
    const pkg = buildRoutinePackageFromDraft(sampleDraft(), metaMap, 1);
    const raw = JSON.parse(JSON.stringify(pkg));
    raw.formatVersion = 99;
    expect(() => parseRoutinePackage(JSON.stringify(raw))).toThrow(
      expect.objectContaining({ code: 'unsupported_version' }),
    );
  });

  it('parse rejects malformed JSON', () => {
    expect(() => parseRoutinePackage('{not json')).toThrow(
      expect.objectContaining({ code: 'invalid_json' }),
    );
  });

  it('parse rejects missing fields', () => {
    expect(() => parseRoutinePackage(JSON.stringify({ format: 'apexfoss-routine' }))).toThrow(
      PortabilityError,
    );
  });

  it('parse rejects checksum tamper', () => {
    const metaMap = new Map([
      ['ex1', { name: 'Bench Press', category: 'push', equipment: 'barbell', metricFlags: 3 }],
      ['ex2', { name: 'OHP', category: 'push', equipment: 'barbell', metricFlags: 3 }],
    ]);
    const pkg = buildRoutinePackageFromDraft(sampleDraft(), metaMap, 1);
    const raw = JSON.parse(JSON.stringify(pkg));
    raw.routine.name = 'Hacked';
    expect(() => parseRoutinePackage(JSON.stringify(raw))).toThrow(
      expect.objectContaining({ code: 'checksum_mismatch' }),
    );
  });

  it('rejects dangling exercise reference', () => {
    const metaMap = new Map([
      ['ex1', { name: 'Bench Press', category: 'push', equipment: 'barbell', metricFlags: 3 }],
      ['ex2', { name: 'OHP', category: 'push', equipment: 'barbell', metricFlags: 3 }],
    ]);
    const pkg = buildRoutinePackageFromDraft(sampleDraft(), metaMap, 1);
    const raw = JSON.parse(JSON.stringify(pkg));
    raw.routine.blocks[0].steps[0].exerciseKey = 'e99';
    // recompute checksum so we hit dangling, not checksum
    raw.checksum = semanticChecksum({ routine: raw.routine, exercises: raw.exercises });
    expect(() => parseRoutinePackage(JSON.stringify(raw))).toThrow(
      expect.objectContaining({ code: 'dangling_exercise' }),
    );
  });

  it('rejects duplicate exercise identity keys', () => {
    const metaMap = new Map([
      ['ex1', { name: 'Bench Press', category: 'push', equipment: 'barbell', metricFlags: 3 }],
      ['ex2', { name: 'OHP', category: 'push', equipment: 'barbell', metricFlags: 3 }],
    ]);
    const pkg = buildRoutinePackageFromDraft(sampleDraft(), metaMap, 1);
    const raw = JSON.parse(JSON.stringify(pkg));
    raw.exercises[1].key = raw.exercises[0].key;
    raw.checksum = semanticChecksum({ routine: raw.routine, exercises: raw.exercises });
    expect(() => parseRoutinePackage(JSON.stringify(raw))).toThrow(
      expect.objectContaining({ code: 'duplicate_identity' }),
    );
  });

  it('rejects invalid rounds / transition / interval', () => {
    const metaMap = new Map([
      ['ex1', { name: 'Bench Press', category: 'push', equipment: 'barbell', metricFlags: 3 }],
      ['ex2', { name: 'OHP', category: 'push', equipment: 'barbell', metricFlags: 3 }],
    ]);
    const base = buildRoutinePackageFromDraft(sampleDraft(), metaMap, 1);

    const badRounds = JSON.parse(JSON.stringify(base));
    badRounds.routine.blocks[0].rounds = 0;
    badRounds.checksum = semanticChecksum({ routine: badRounds.routine, exercises: badRounds.exercises });
    expect(() => parseRoutinePackage(JSON.stringify(badRounds))).toThrow(
      expect.objectContaining({ code: 'invalid_integer' }),
    );

    const badTrans = JSON.parse(JSON.stringify(base));
    badTrans.routine.blocks[0].steps[0].transition.type = 'warp';
    badTrans.checksum = semanticChecksum({ routine: badTrans.routine, exercises: badTrans.exercises });
    expect(() => parseRoutinePackage(JSON.stringify(badTrans))).toThrow(
      expect.objectContaining({ code: 'invalid_transition' }),
    );
  });

  it('serialize → parse round trip preserves semantics', () => {
    const metaMap = new Map([
      ['ex1', { name: 'Bench Press', category: 'push', equipment: 'barbell', metricFlags: 3 }],
      ['ex2', { name: 'OHP', category: 'push', equipment: 'barbell', metricFlags: 3 }],
    ]);
    const pkg = buildRoutinePackageFromDraft(sampleDraft(), metaMap, 42);
    const again = parseRoutinePackage(serializeRoutinePackage(pkg));
    expect(again.routine).toEqual(pkg.routine);
    expect(again.exercises).toEqual(pkg.exercises);
    expect(again.checksum).toBe(pkg.checksum);
  });

  it('countSteps counts all steps', () => {
    const metaMap = new Map([
      ['ex1', { name: 'Bench Press', category: 'push', equipment: 'barbell', metricFlags: 3 }],
      ['ex2', { name: 'OHP', category: 'push', equipment: 'barbell', metricFlags: 3 }],
    ]);
    const pkg = buildRoutinePackageFromDraft(sampleDraft(), metaMap, 1);
    expect(countSteps(pkg.routine)).toBe(2);
  });

  it('semanticChecksum is stable under key reorder', () => {
    expect(semanticChecksum({ a: 1, b: [1, 2] })).toBe(semanticChecksum({ b: [1, 2], a: 1 }));
  });
});

describe('deep link / transport', () => {
  const metaMap = new Map([
    ['ex1', { name: 'Bench Press', category: 'push', equipment: 'barbell', metricFlags: 3 }],
    ['ex2', { name: 'OHP', category: 'push', equipment: 'barbell', metricFlags: 3 }],
  ]);
  const pkg = () => buildRoutinePackageFromDraft(sampleDraft(), metaMap, 1);

  it('encode/decode transport round trip', () => {
    const enc = encodeRoutineTransport(pkg());
    expect(fitsSingleTransport(enc)).toBe(true);
    const back = decodeRoutineTransport(enc);
    expect(back.routine.name).toBe('Push Day');
  });

  it('builds valid deep link', () => {
    const url = buildImportDeepLink(pkg());
    expect(url).toMatch(/^apexfoss:\/\/import\?d=[A-Za-z0-9_-]+$/);
  });

  it('rejects wrong scheme', () => {
    expect(parseImportDeepLink('https://evil.com/import?d=abc')).toEqual({
      ok: false,
      reason: 'wrong_scheme',
    });
  });

  it('rejects wrong host', () => {
    expect(parseImportDeepLink('apexfoss://export?d=abc').ok).toBe(false);
  });

  it('rejects missing param', () => {
    const r = parseImportDeepLink('apexfoss://import');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('missing_param');
  });

  it('rejects invalid payload characters', () => {
    expect(parseImportDeepLink('apexfoss://import?d=abc!def').ok).toBe(false);
  });

  it('routineFromDeepLink recovers package', () => {
    const url = buildImportDeepLink(pkg())!;
    const back = routineFromDeepLink(url);
    expect(back.checksum).toBe(pkg().checksum);
  });

  it('deep link corruption fails validation', () => {
    const url = buildImportDeepLink(pkg())!;
    const m = /(d=)([A-Za-z0-9_-]+)/.exec(url)!;
    const corrupted = url.replace(m[0], `${m[1]}${m[2].slice(0, -2)}XY`);
    expect(() => routineFromDeepLink(corrupted)).toThrow();
  });

  it('rejects oversized transport', () => {
    expect(fitsSingleTransport('x'.repeat(MAX_PORTABLE_PAYLOAD_BYTES + 1))).toBe(false);
    expect(buildImportDeepLink(pkg(), 10)).toBeNull();
  });
});

describe('naming / match helpers', () => {
  it('uniqueRoutineName deterministic collisions', () => {
    const s = new Set<string>();
    const n1 = uniqueRoutineName('Push', s);
    s.add(n1);
    const n2 = uniqueRoutineName('Push', s);
    s.add(n2);
    const n3 = uniqueRoutineName('Push', s);
    expect(n1).toBe('Push');
    expect(n2).toBe('Push (imported)');
    expect(n3).toBe('Push (imported 2)');
  });

  it('exerciseMatchKey normalizes name', () => {
    expect(exerciseMatchKey('  Bench   Press ', 'Push', 'Barbell', 3)).toBe(
      exerciseMatchKey('bench press', 'push', 'barbell', 3),
    );
  });
});

describe('qr encoder', () => {
  it('fits small text within v1-10 EC-M capacity', () => {
    expect(fitsQr('apexfoss-test')).toBe(true);
    expect(fitsQr('x'.repeat(200))).toBe(true);
    expect(fitsQr('x'.repeat(214))).toBe(false);
  });

  it('realistic package transport may exceed QR capacity (share/deep-link fallback)', () => {
    const text = encodeRoutineTransport(
      buildRoutinePackageFromDraft(sampleDraft(), new Map([
        ['ex1', { name: 'Bench Press', category: 'push', equipment: 'barbell', metricFlags: 3 }],
        ['ex2', { name: 'OHP', category: 'push', equipment: 'barbell', metricFlags: 3 }],
      ]), 1),
    );
    expect(fitsSingleTransport(text)).toBe(true);
    // QR v10 EC-M max is 213 data bytes; realistic packages exceed this.
    // UI must fall back to Share/deep-link when fitsQr is false.
    if (fitsQr(text)) {
      const m = encodeQr(text);
      expect(m.size).toBeGreaterThanOrEqual(21);
      expect(m.modules).toHaveLength(m.size);
      expect(m.modules[0]).toHaveLength(m.size);
      expect(m.modules[0][0]).toBe(true);
      expect(m.modules[0][6]).toBe(true);
      expect(m.modules[6][0]).toBe(true);
      expect(m.modules[0][7]).toBe(false);
    } else {
      expect(() => encodeQr(text)).toThrow();
    }
  });

  it('rejects oversized text', () => {
    expect(fitsQr('a'.repeat(500))).toBe(false);
    expect(() => encodeQr('a'.repeat(500))).toThrow();
  });

  it('finder pattern corners are dark', () => {
    const m = encodeQr('apexfoss-test');
    expect(m.modules[0][0]).toBe(true);
    expect(m.modules[0][6]).toBe(true);
    expect(m.modules[6][0]).toBe(true);
    expect(m.modules[0][7]).toBe(false);
  });

  it('deterministic for same input (size and corner cells)', () => {
    const a = encodeQr('apexfoss-test');
    const b = encodeQr('apexfoss-test');
    expect(a.size).toBe(b.size);
    expect(a.modules[0][0]).toBe(b.modules[0][0]);
    expect(a.modules[10][10]).toBe(b.modules[10][10]);
  });
});

describe('import atomicity helpers (unit)', () => {
  it('build package from draft validates empty blocks rejection path', () => {
    const bad: RoutineDraft = { id: 'x', name: 'Empty', blocks: [] };
    expect(() => buildRoutinePackageFromDraft(bad, new Map(), 1)).toThrow(PortabilityError);
  });

  it('draft without id is rejected by buildRoutinePackage path via package builder on empty name', () => {
    const bad: RoutineDraft = { id: null, name: '', blocks: [] };
    expect(() => buildRoutinePackageFromDraft(bad, new Map(), 1)).toThrow();
  });
});

void makeDbActions;
void makeDb;
void intervalDraft;
