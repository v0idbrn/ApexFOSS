import fs from 'fs';
import path from 'path';

/**
 * Distribution invariants (Play/F-Droid readiness).
 * All checks are repository-relative and read committed files only —
 * android/ is generated (CNG) and must never be required for tests to pass.
 */
const root = path.join(__dirname, '..', '..');

function readJson(rel: string): any {
  return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
}

function readText(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('distribution metadata invariants', () => {
  it('app.json declares the release identity (package, version, versionCode)', () => {
    const app = readJson('app.json').expo;
    expect(app.package ?? app.android?.package).toBe('com.apexfoss.app');
    expect(app.version).toBe('1.1.0');
    expect(app.android?.versionCode).toBe(3);
  });

  it('package.json version and GPL license match the release identity', () => {
    const pkg = readJson('package.json');
    expect(pkg.version).toBe('1.1.0');
    expect(pkg.license).toBe('GPL-3.0-or-later');
  });

  it('LICENSE exists and is the GPL-3.0 text', () => {
    const text = readText('LICENSE');
    expect(text).toMatch(/GNU GENERAL PUBLIC LICENSE/);
    expect(text).toMatch(/Version 3, 29 June 2007/);
  });

  it('network hardening is a committed plugin (INTERNET removal), not a manual step', () => {
    const plugin = readText('plugins/withNetworkHardening.js');
    expect(plugin).toMatch(/INTERNET/);
    expect(plugin).toMatch(/remove/);
  });

  it('signing config stays external: no absolute paths or leaked secrets in committed files', () => {
    for (const rel of ['plugins/withApexSigning.js', 'app.json', 'package.json']) {
      // Strip https:// URLs first: only local drive paths (C:\, C:/) are leaks.
      const text = readText(rel).replace(/https?:\/\/[^\s"']+/g, '');
      expect(text).not.toMatch(/[A-Za-z]:[\\/]/);
      // Properties-file style leaks (key=value), never the key names themselves.
      expect(text).not.toMatch(/^\s*(storeFile|storePassword|keyAlias|keyPassword)\s*=/m);
      expect(text).not.toMatch(/\.jks|\.keystore/);
    }
    const signing = readText('plugins/withApexSigning.js');
    expect(signing).toMatch(/homedir/);
  });

  it('support links are exact, external, and mirrored in funding metadata', () => {
    const support = readText('src/constants/support.ts');
    const urls = [
      'https://github.com/sponsors/v0idbrn',
      'https://paypal.me/amelie615',
      'https://link.mercadopago.com.ar/openv0id',
    ];
    for (const url of urls) expect(support).toContain(url);
    const pkg = readJson('package.json');
    for (const url of urls) expect(pkg.funding).toContain(url);
    const funding = readText('.github/FUNDING.yml');
    expect(funding).toContain('v0idbrn');
    for (const url of urls.slice(1)) expect(funding).toContain(url);
  });

  it('no analytics, Firebase, billing, or Play Services direct dependency', () => {
    const pkg = readJson('package.json');
    const deps = Object.keys({ ...pkg.dependencies });
    expect(deps.filter((d) => /(analytics|firebase|billing|play-services|crashlytics|telemetry)/i.test(d))).toEqual([]);
  });

  it('no committed APK/AAB artifacts in the repository', () => {
    const hits: string[] = [];
    for (const dir of ['', 'android/app/build/outputs']) {
      const abs = path.join(root, dir);
      if (!fs.existsSync(abs)) continue;
      for (const f of fs.readdirSync(abs)) {
        if (f.endsWith('.apk') || f.endsWith('.aab')) hits.push(path.join(dir, f));
      }
    }
    expect(hits).toEqual([]);
  });

  it('fastlane store metadata exists for en-US and es-AR', () => {
    for (const locale of ['en-US', 'es-AR']) {
      for (const file of ['title.txt', 'short_description.txt', 'full_description.txt', 'changelogs/2.txt']) {
        const abs = path.join(root, 'fastlane/metadata/android', locale, file);
        expect(fs.existsSync(abs)).toBe(true);
        expect(fs.readFileSync(abs, 'utf8').trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('16KB plugin is registered and injects the exact linker flag (D-054)', () => {
    const app = readJson('app.json').expo;
    expect(app.plugins).toContain('./plugins/with16KbPageSize');
    const source = readText('plugins/with16KbPageSize.js');
    expect(source).toContain('-Wl,-z,max-page-size=16384');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const plugin = require('../../plugins/with16KbPageSize.js');
    const sample = [
      '    defaultConfig {',
      '        externalNativeBuild {',
      '            cmake {',
      '                // upstream comment',
      '            }',
      '        }',
      '    }',
    ].join('\n');
    const once = plugin.apply16KbFlag(sample);
    expect(once.changed).toBe(true);
    expect(once.contents).toContain(plugin.FLAG_LINE);
    expect(once.contents.match(/max-page-size=16384/g)).toHaveLength(1);
    const twice = plugin.apply16KbFlag(once.contents);
    expect(twice.changed).toBe(false);
    expect(twice.contents).toBe(once.contents);
    expect(() => plugin.apply16KbFlag('android { }')).toThrow();
  });

  it('signing plugin supports sign-less source builds without weakening the default (D-055)', () => {
    const source = readText('plugins/withApexSigning.js');
    expect(source).toContain("process.env.APEX_SKIP_SIGNING === '1'");
    // Default path still fails fast when the external config is missing.
    expect(source).toMatch(/throw new Error\([\s\S]*?signing config not found/);
  });
});
