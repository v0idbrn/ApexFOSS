import { en } from './strings.en';
import { es } from './strings.es';
import { strings, setStringsLocale, getStrings, getActiveStringsLocale, type Locale } from './strings';
import { localeToAppLocale, detectLocale } from './i18n';
import { schemaVersion, schema } from '../data/schema';
import { migrations } from '../data/migrations';

// The locale store resolves the app database lazily; stub it so importing the
// store (and exercising its failure path) never constructs a real adapter.
jest.mock('../data', () => ({ database: {} }));

/**
 * i18n contract tests (en/es parity, detection, facade, schema v6).
 * The English dictionary is the source of truth; Spanish must mirror its
 * shape exactly and must not contain untranslated English leftovers.
 */

type Dict = Record<string, unknown>;

const isDict = (v: unknown): v is Dict =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Recursive walker: collects `path.to.leaf → value` for every string leaf. */
function collectLeaves(node: unknown, prefix = '', out: Map<string, string> = new Map()): Map<string, string> {
  if (typeof node === 'string') {
    out.set(prefix, node);
    return out;
  }
  if (isDict(node)) {
    for (const key of Object.keys(node)) {
      collectLeaves(node[key], prefix ? `${prefix}.${key}` : key, out);
    }
  }
  return out;
}

/**
 * Asserts that two dictionaries expose the SAME keys at EVERY level
 * (recursively), reporting the first divergence with its path.
 */
function expectSameShape(a: unknown, b: unknown, path: string): void {
  const aIsDict = isDict(a);
  const bIsDict = isDict(b);
  expect({ path, isDict: bIsDict }).toEqual({ path, isDict: aIsDict });
  if (!aIsDict || !bIsDict) return;
  expect({ path, keys: Object.keys(b) }).toEqual({ path, keys: Object.keys(a) });
  for (const key of Object.keys(a)) {
    expectSameShape(a[key], b[key], path ? `${path}.${key}` : key);
  }
}

/**
 * Values allowed to be byte-identical between en and es: technical tokens,
 * unit symbols and brand names that are NOT translated (spec allowlist).
 */
const IDENTICAL_ALLOWLIST = new Set([
  'ApexFOSS',
  'App',
  'Tempo',
  'TEMPO',
  'NORMAL',
  'AUTO',
  'RIR',
  'RPE',
  '1RM',
  'HIIT',
  'EMOM',
  'CSV',
  'JSON',
  'QR',
  'Reps',
  'reps',
  'kg',
  'kg·reps',
  'kg·reps/min',
  'min',
  's',
  'm',
  'Error', // same word in English and Spanish
]);

/**
 * Values exempted by PATH: code samples / format examples that must stay
 * byte-identical across locales (valid JSON in both dictionaries).
 */
const IDENTICAL_PATH_ALLOWLIST = new Set(['portability.jsonPlaceholder']);

/** Pragmatic patterns: symbol/number-only strings ("×", "—", "%d / %d", "⌫"). */
const isSymbolOnly = (v: string): boolean => !/[A-Za-z]/.test(v);

const extractExpressions = (v: string): string[] => (v.match(/\$\{[^}]*\}/g) ?? []).sort();

describe('i18n dictionary parity (en vs es)', () => {
  it('has identical keys at every level (recursive deep comparison)', () => {
    expectSameShape(en, es, '');
    // Sanity: the walker actually visited a deep leaf.
    expect(collectLeaves(en).size).toBeGreaterThan(300);
  });

  it('has no empty or whitespace-only values in either dictionary', () => {
    const offenders: string[] = [];
    for (const [dictName, dict] of [['en', en], ['es', es]] as const) {
      for (const [path, value] of collectLeaves(dict)) {
        if (value.trim().length === 0) offenders.push(`${dictName}:${path}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('leaves no untranslated English in es (identical values need allowlist)', () => {
    const enLeaves = collectLeaves(en);
    const esLeaves = collectLeaves(es);
    const offenders: string[] = [];
    for (const [path, enValue] of enLeaves) {
      const esValue = esLeaves.get(path);
      if (esValue !== enValue) continue; // translated — good
      if (IDENTICAL_ALLOWLIST.has(enValue) || isSymbolOnly(enValue)) continue;
      if (IDENTICAL_PATH_ALLOWLIST.has(path)) continue;
      offenders.push(`${path}: "${enValue}"`);
    }
    expect(offenders).toEqual([]);
  });

  it('keeps interpolation expressions identical between en and es', () => {
    const enLeaves = collectLeaves(en);
    const esLeaves = collectLeaves(es);
    for (const [path, enValue] of enLeaves) {
      const expected = extractExpressions(enValue);
      if (expected.length === 0) continue;
      expect({ path, expr: extractExpressions(esLeaves.get(path) ?? '') }).toEqual({ path, expr: expected });
    }
  });
});

describe('locale detection', () => {
  it('maps device tags to the app locale', () => {
    expect(localeToAppLocale('es-AR')).toBe('es');
    expect(localeToAppLocale('es')).toBe('es');
    expect(localeToAppLocale('ES-ar')).toBe('es');
    expect(localeToAppLocale('en-GB')).toBe('en');
    expect(localeToAppLocale('en')).toBe('en');
    expect(localeToAppLocale('fr-FR')).toBe('en');
    expect(localeToAppLocale('et-EE')).toBe('en');
    expect(localeToAppLocale('')).toBe('en');
  });

  it('detectLocale reflects the resolved device locale', () => {
    const original = Intl.DateTimeFormat;
    const mock = function () {
      return { resolvedOptions: () => ({ locale: 'es-AR' }) };
    };
    try {
      Object.defineProperty(Intl, 'DateTimeFormat', { configurable: true, writable: true, value: mock });
      expect(detectLocale()).toBe('es');
      (mock as any).resolvedOptions = undefined;
      Object.defineProperty(Intl, 'DateTimeFormat', {
        configurable: true,
        writable: true,
        value: function () {
          return { resolvedOptions: () => ({ locale: 'en-US' }) };
        },
      });
      expect(detectLocale()).toBe('en');
    } finally {
      Object.defineProperty(Intl, 'DateTimeFormat', { configurable: true, writable: true, value: original });
    }
  });

  it('detectLocale falls back to en when Intl throws', () => {
    const original = Intl.DateTimeFormat;
    try {
      Object.defineProperty(Intl, 'DateTimeFormat', {
        configurable: true,
        writable: true,
        value: function () {
          throw new Error('Intl unavailable');
        },
      });
      expect(detectLocale()).toBe('en');
    } finally {
      Object.defineProperty(Intl, 'DateTimeFormat', { configurable: true, writable: true, value: original });
    }
  });
});

describe('strings facade', () => {
  const originalLocale: Locale = getActiveStringsLocale();

  afterEach(() => {
    setStringsLocale(originalLocale);
  });

  it('serves Spanish after setStringsLocale("es") and English after switching back', () => {
    setStringsLocale('es');
    expect(strings.common.save).toBe(es.common.save);
    expect(strings.common.save).toBe('Guardar');
    expect(strings.tabs.routines).toBe('Rutinas');

    setStringsLocale('en');
    expect(strings.common.save).toBe(en.common.save);
    expect(strings.common.save).toBe('Save');
    expect(strings.tabs.routines).toBe('Routines');
  });

  it('returns undefined for unknown keys without crashing', () => {
    // Top-level, group-level and missing-group reads must all be safe.
    expect((strings as any).definitelyNotAKey).toBeUndefined();
    expect((strings.common as any).definitelyNotAKey).toBeUndefined();
    expect((strings as any).missingGroup?.leaf).toBeUndefined();
  });

  it('getStrings returns the matching dictionary', () => {
    expect(getStrings('en').common.save).toBe('Save');
    expect(getStrings('es').common.save).toBe('Guardar');
    expect(getStrings('xx' as Locale).common.save).toBe('Save'); // unknown → en
  });
});

describe('schema v9 (Phase 4B mesocycles)', () => {
  it('schemaVersion is 9 with programs, mesocycles and routine linkage', () => {
    expect(schemaVersion).toBe(9);
    expect(schema.version).toBe(9);
    const settings = schema.tables['app_settings'];
    expect(settings).toBeDefined();
    expect(settings.columnArray.map((c) => c.name)).toEqual(['key', 'value', 'created_at', 'updated_at']);
    const programs = schema.tables['programs'];
    expect(programs).toBeDefined();
    expect(programs.columnArray.map((c) => c.name)).toEqual(['name', 'created_at', 'updated_at']);
    const mesocycles = schema.tables['mesocycles'];
    expect(mesocycles).toBeDefined();
    expect(mesocycles.columnArray.map((c) => c.name)).toEqual(['name', 'program_id', 'sort_order', 'created_at', 'updated_at']);
    const routines = schema.tables['routines'];
    const routineCols = routines.columnArray.map((c) => c.name);
    expect(routineCols).toContain('program_id');
    expect(routineCols).toContain('program_order');
    expect(routineCols).toContain('mesocycle_id');
    const programIdCol = routines.columnArray.find((c) => c.name === 'program_id');
    expect(programIdCol?.isIndexed).toBe(true);
    expect(programIdCol?.isOptional).toBe(true);
    const mesoCol = routines.columnArray.find((c) => c.name === 'mesocycle_id');
    expect(mesoCol?.isIndexed).toBe(true);
    expect(mesoCol?.isOptional).toBe(true);
    expect(migrations.validated).toBe(true);
    expect(migrations.maxVersion).toBe(9);
    expect(migrations.sortedMigrations.map((m) => m.toVersion)).toContain(9);
  });
});

describe('locale store', () => {
  afterEach(() => {
    setStringsLocale(detectLocale());
  });

  it('starts from the device locale, hydrates safely and applies setLocale immediately', async () => {
    const { useLocaleStore, getLocale } = require('../state/localeStore') as typeof import('../state/localeStore');

    // Synchronous initial locale (first paint already correct — no flash).
    expect(useLocaleStore.getState().locale).toBe(detectLocale());
    expect(useLocaleStore.getState().hydrated).toBe(false);

    // Persistence target is a stub database → failure path: never throws,
    // stays on the device locale, still marks itself hydrated.
    await useLocaleStore.getState().hydrate();
    expect(useLocaleStore.getState().hydrated).toBe(true);
    expect(useLocaleStore.getState().locale).toBe(detectLocale());

    // setLocale applies the strings facade synchronously, before persistence.
    await useLocaleStore.getState().setLocale('es');
    expect(getLocale()).toBe('es');
    expect(strings.common.save).toBe('Guardar');

    await useLocaleStore.getState().setLocale('en');
    expect(getLocale()).toBe('en');
    expect(strings.common.save).toBe('Save');
  });
});
