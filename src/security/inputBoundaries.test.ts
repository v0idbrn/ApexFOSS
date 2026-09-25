import {
  parseImportDeepLink,
} from '../portability/encoding';
import { parseRoutinePackage } from '../portability/routinePackage';
import { parseBackup } from '../portability/backup';
import {
  PortabilityError,
  MAX_PORTABLE_PAYLOAD_BYTES,
  MAX_ROUTINE_JSON_BYTES,
  MAX_BACKUP_JSON_BYTES,
} from '../portability/types';
import {
  setPendingDeepLink,
  takePendingDeepLink,
  peekPendingDeepLink,
} from '../portability/pendingDeepLink';

function codeOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    if (e instanceof PortabilityError) return e.code;
    return `non-portability: ${String(e)}`;
  }
}

describe('routine package input ceiling (D-036, spec section 9)', () => {
  it('rejects pastes larger than MAX_ROUTINE_JSON_BYTES before JSON.parse', () => {
    const hostile = 'x'.repeat(MAX_ROUTINE_JSON_BYTES + 1);
    expect(codeOf(() => parseRoutinePackage(hostile))).toBe('too_large');
  });

  it('accepts inputs exactly at the byte ceiling into the parse path', () => {
    const atCap = 'x'.repeat(MAX_ROUTINE_JSON_BYTES);
    expect(codeOf(() => parseRoutinePackage(atCap))).toBe('invalid_json');
  });

  it('measures UTF-8 bytes, not characters', () => {
    // 2_500_001 x 2-byte characters = 5_000_002 bytes > 5_000_000 cap.
    const multiByte = 'é'.repeat(2_500_001);
    expect(codeOf(() => parseRoutinePackage(multiByte))).toBe('too_large');
  });

  it('small structural JSON reaches validation (wrong_format, never too_large)', () => {
    expect(codeOf(() => parseRoutinePackage('{}'))).toBe('wrong_format');
  });
});

describe('backup input ceiling (D-036, spec section 9)', () => {
  it('rejects pastes larger than MAX_BACKUP_JSON_BYTES before JSON.parse', () => {
    const hostile = 'x'.repeat(MAX_BACKUP_JSON_BYTES + 1);
    expect(codeOf(() => parseBackup(hostile))).toBe('too_large');
  });

  it('small structural JSON reaches validation (wrong_format, never too_large)', () => {
    expect(codeOf(() => parseBackup('{}'))).toBe('wrong_format');
  });
});

describe('import deep link hardening (spec sections 9/12)', () => {
  it('accepts a well-formed small link', () => {
    const r = parseImportDeepLink('apexfoss://import?d=QUJD');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.encoded).toBe('QUJD');
  });

  it('scheme and host matching is case-insensitive', () => {
    expect(parseImportDeepLink('APEXFOSS://IMPORT?d=QUJD').ok).toBe(true);
  });

  it('rejects foreign schemes', () => {
    const r = parseImportDeepLink('https://evil.test/import?d=QUJD');
    expect(r).toEqual({ ok: false, reason: 'wrong_scheme' });
  });

  it('rejects foreign hosts on the apexfoss scheme', () => {
    const r = parseImportDeepLink('apexfoss://evil?d=QUJD');
    expect(r).toEqual({ ok: false, reason: 'wrong_scheme' });
  });

  it('rejects a missing data param', () => {
    expect(parseImportDeepLink('apexfoss://import?x=1')).toEqual({
      ok: false,
      reason: 'missing_param',
    });
    expect(parseImportDeepLink('apexfoss://import')).toEqual({
      ok: false,
      reason: 'missing_param',
    });
  });

  it('rejects payload characters outside the base64url alphabet', () => {
    expect(parseImportDeepLink('apexfoss://import?d=AB%20CD')).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(parseImportDeepLink('apexfoss://import?d=AB CD')).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('rejects JSON/proto-pollution attempts smuggled in the param', () => {
    const hostile = 'apexfoss://import?d={"__proto__":{"polluted":true}}';
    expect(parseImportDeepLink(hostile)).toEqual({ ok: false, reason: 'invalid' });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('accepts payloads exactly at the transport ceiling and rejects beyond it', () => {
    const atCap = `apexfoss://import?d=${'A'.repeat(MAX_PORTABLE_PAYLOAD_BYTES + 64)}`;
    const overCap = `apexfoss://import?d=${'A'.repeat(MAX_PORTABLE_PAYLOAD_BYTES + 65)}`;
    expect(parseImportDeepLink(atCap).ok).toBe(true);
    expect(parseImportDeepLink(overCap)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects empty and non-string inputs without throwing', () => {
    expect(parseImportDeepLink('')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseImportDeepLink(undefined as unknown as string)).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(parseImportDeepLink(null as unknown as string)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });
});

describe('pending deep link is transport-only and take-once (spec section 12)', () => {
  it('returns the payload exactly once', () => {
    setPendingDeepLink('abc123');
    expect(peekPendingDeepLink()).toBe('abc123');
    expect(takePendingDeepLink()).toBe('abc123');
    expect(takePendingDeepLink()).toBeNull();
    expect(peekPendingDeepLink()).toBeNull();
  });

  it('never auto-imports: taking is required to read it', () => {
    setPendingDeepLink('deferred');
    expect(peekPendingDeepLink()).toBe('deferred'); // peek does not consume
    expect(takePendingDeepLink()).toBe('deferred');
    expect(takePendingDeepLink()).toBeNull();
  });
});

describe('backup hostile content (spec section 10)', () => {
  it('rejects proto-pollution payloads and leaves Object.prototype clean', () => {
    const hostile = '{"__proto__":{"polluted":true},"format":"x"}';
    expect(codeOf(() => parseBackup(hostile))).not.toBeNull();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('rejects non-object roots with a typed portability error', () => {
    expect(codeOf(() => parseBackup('null'))).toBe('missing_field');
    expect(codeOf(() => parseBackup('[1,2,3]'))).toBe('missing_field');
    expect(codeOf(() => parseBackup('"just a string"'))).toBe('missing_field');
  });
});
