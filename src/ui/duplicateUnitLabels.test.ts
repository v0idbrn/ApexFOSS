import fs from 'fs';
import path from 'path';

/**
 * Phase 2K regression guard (V3/V3b): canonical labels already carry their units
 * ("Weight (kg)", "Duration (s)"), so composing them with another unit parenthetical
 * produced on-device duplicates like "Weight (kg) (kg)". This scans UI sources for
 * that composition class so it cannot silently return.
 */

const UI_ROOT = path.join(__dirname);

function collectSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectSources(full));
    } else if (
      (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
      !entry.name.includes('.test.')
    ) {
      out.push(full);
    }
  }
  return out;
}

const UNIT_APPEND = /\$\{strings\.[A-Za-z0-9_.]+\}\s*\(\$\{strings\.(workout|units)\./;
const LITERAL_DUPES = [/\(kg\)\s*\(kg\)/, /\(s\)\s*\(s\)/, /\(reps\)\s*\(reps\)/, /\(min\)\s*\(min\)/];

describe('duplicate unit label composition (Phase 2K)', () => {
  const files = collectSources(UI_ROOT);

  it('scans a non-trivial set of UI sources', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('never appends a second unit parenthetical to a canonical label', () => {
    const offenders = files.filter((f) => UNIT_APPEND.test(fs.readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('never renders literal doubled unit suffixes', () => {
    const offenders = files.filter((f) => {
      const src = fs.readFileSync(f, 'utf8');
      return LITERAL_DUPES.some((re) => re.test(src));
    });
    expect(offenders).toEqual([]);
  });
});
