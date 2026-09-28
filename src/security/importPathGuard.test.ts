import fs from 'fs';
import path from 'path';

/**
 * Import-path executable-code guard (v1.0 closure, spec section 9/45).
 * Portable payloads are hostile input: the routine/backup import path must
 * never evaluate code, open network connections, or spawn processes, no
 * matter what a file/deep link contains.
 */

const PORTABILITY_DIR = path.join(__dirname, '..', 'portability');
const SOURCES = [
  ...fs
    .readdirSync(PORTABILITY_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => path.join(PORTABILITY_DIR, f)),
  path.join(__dirname, '..', '..', 'App.tsx'),
];

/** Construct → why it is forbidden on the import path. */
const FORBIDDEN: Array<[RegExp, string]> = [
  [/\beval\s*\(/, 'eval'],
  [/new\s+Function\s*\(/, 'new Function'],
  [/[^.\w]fetch\s*\(/, 'network fetch'],
  [/XMLHttpRequest/, 'XHR'],
  [/child_process/, 'child process'],
  [/\bexecSync\s*\(/, 'execSync'],
  [/\bspawnSync?\s*\(/, 'spawn'],
  [/require\s*\(\s*['"]fs['"]\s*\)/, 'fs module'],
  [/(?<!typeof )\bimport\s*\(/, 'dynamic import'],
];
function scan(file: string): string[] {
  const src = fs.readFileSync(file, 'utf8');
  const hits: string[] = [];
  for (const [pattern, label] of FORBIDDEN) {
    if (pattern.test(src)) hits.push(`${path.basename(file)}: ${label}`);
  }
  return hits;
}

describe('import path has no executable/network primitives', () => {
  it('scans the full portability module set plus the app URL intake', () => {
    expect(SOURCES.length).toBeGreaterThan(10);
  });

  it('finds none', () => {
    const offenders = SOURCES.flatMap(scan);
    expect(offenders).toEqual([]);
  });

  it('deep-link/file intake stashes payloads instead of importing them', () => {
    const app = fs.readFileSync(path.join(__dirname, '..', '..', 'App.tsx'), 'utf8');
    expect(app).toContain('setPendingDeepLink');
    expect(app).toContain('never auto-import');
    // No direct import/restore call from the URL listener.
    expect(app).not.toMatch(/onUrl[\s\S]{0,400}importRoutinePackage/);
    expect(app).not.toMatch(/onUrl[\s\S]{0,400}restoreBackup/);
  });
});
