import fs from 'fs';
import path from 'path';
import { en } from './strings.en';
import { es } from './strings.es';

/**
 * Source-scan guard for hardcoded English UI text (i18n workstream).
 * Screens must read user-visible labels from the `strings` facade; this
 * scans every non-test .tsx under src/ui for literal English leftovers
 * in accessibility/placeholder attributes plus the known offenders that
 * were converted to dictionary keys.
 */

const UI_ROOT = path.join(__dirname, '..', 'ui');

function collectSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectSources(full));
    } else if (entry.name.endsWith('.tsx') && !entry.name.includes('.test.')) {
      out.push(full);
    }
  }
  return out;
}

const SOURCES = collectSources(UI_ROOT);

const read = (name: string): string => fs.readFileSync(path.join(UI_ROOT, name), 'utf8');

/** attr="..." with a plain string literal (no braces → not a `strings.*` expression). */
const LITERAL_ATTR = /\b(accessibilityLabel|placeholder)="([^"]*)"/g;

/** Conservative: flag only literals that contain a space AND a lowercase English-ish word. */
const LOWERWORD = /[a-z]{3,}/;
const UNITISH = new Set(['kg', 'reps', 'min']);

function englishishWords(value: string): string[] {
  if (!/\s/.test(value)) return []; // unit symbols / single tokens are fine
  if (value.includes('${')) return []; // dynamic template — skip
  return (value.match(/[a-z]{3,}/g) ?? []).filter((w) => !UNITISH.has(w));
}

describe('no hardcoded English UI strings', () => {
  it('scans a non-trivial set of UI sources', () => {
    expect(SOURCES.length).toBeGreaterThan(15);
  });

  it('PortabilityScreen placeholders come from strings.portability keys', () => {
    const src = read(path.join('screens', 'PortabilityScreen.tsx'));
    expect(src).not.toContain('apexfoss://import?d=... or portable JSON');
    expect(src).not.toContain('{"format":"apexfoss-backup"…}');
    expect(src).toContain('strings.portability.importPlaceholder');
    expect(src).toContain('strings.portability.jsonPlaceholder');
    // The JSON example must be valid JSON (previous literal was malformed).
    expect(() => JSON.parse(en.portability.jsonPlaceholder)).not.toThrow();
    expect(JSON.parse(en.portability.jsonPlaceholder)).toEqual({ format: 'apexfoss-backup' });
    expect(JSON.parse(es.portability.jsonPlaceholder)).toEqual({ format: 'apexfoss-backup' });
  });

  it('QrGrid accessibility label comes from strings.common.qrCode', () => {
    const src = read('QrGrid.tsx');
    expect(src).not.toContain('accessibilityLabel="QR code"');
    expect(src).toContain('strings.common.qrCode');
    expect(en.common.qrCode).toBe('QR code');
    expect(es.common.qrCode).toBe('Código QR');
  });

  it('flags no literal English accessibilityLabel/placeholder values with spaces', () => {
    const offenders: string[] = [];
    for (const file of SOURCES) {
      const src = fs.readFileSync(file, 'utf8');
      for (const match of src.matchAll(LITERAL_ATTR)) {
        const words = englishishWords(match[2]);
        if (words.length > 0) offenders.push(`${path.basename(file)}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every placeholder/label key added for this workstream exists in both locales', () => {
    for (const key of ['importPlaceholder', 'jsonPlaceholder'] as const) {
      expect(typeof en.portability[key]).toBe('string');
      expect(typeof es.portability[key]).toBe('string');
      expect(es.portability[key].length).toBeGreaterThan(0);
    }
    expect(typeof en.common.qrCode).toBe('string');
    expect(typeof es.common.qrCode).toBe('string');
  });
});
