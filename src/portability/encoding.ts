import type { ApexRoutinePackage } from './types';
import { MAX_PORTABLE_PAYLOAD_BYTES, PortabilityError } from './types';
import { base64UrlDecode, base64UrlEncode, utf8ByteLength } from './canonical';
import { parseRoutinePackage, serializeRoutinePackage } from './routinePackage';

/**
 * Transport encoding for deep links and QR payloads.
 * Payload = base64url(UTF-8 canonical routine package JSON).
 * Deep link form: apexfoss://import?d=<payload>
 * Never executes data — only transports an untrusted import body.
 */

export const DEEP_LINK_SCHEME = 'apexfoss';
export const DEEP_LINK_HOST = 'import';
export const DEEP_LINK_PARAM = 'd';

export type TransportKind = 'routine' | 'backup';

export interface TransportEnvelope {
  kind: TransportKind;
  /** base64url body */
  data: string;
}

/** Encode routine package to compact transport string (base64url). */
export function encodeRoutineTransport(pkg: ApexRoutinePackage): string {
  const json = serializeRoutinePackage(pkg);
  return base64UrlEncode(json);
}

export function decodeRoutineTransport(encoded: string): ApexRoutinePackage {
  let json: string;
  try {
    json = base64UrlDecode(encoded);
  } catch {
    throw new PortabilityError('invalid_json', 'transport');
  }
  return parseRoutinePackage(json);
}

export function transportByteLength(encoded: string): number {
  return utf8ByteLength(encoded);
}

export function fitsSingleTransport(encoded: string, max = MAX_PORTABLE_PAYLOAD_BYTES): boolean {
  return transportByteLength(encoded) <= max;
}

/** Build apexfoss://import?d=… URL. Returns null when over size limit (caller shows QR/deep-link unavailable). */
export function buildImportDeepLink(pkg: ApexRoutinePackage, max = MAX_PORTABLE_PAYLOAD_BYTES): string | null {
  const data = encodeRoutineTransport(pkg);
  if (!fitsSingleTransport(data, max)) return null;
  return `${DEEP_LINK_SCHEME}://${DEEP_LINK_HOST}?${DEEP_LINK_PARAM}=${data}`;
}

export type DeepLinkParseResult =
  | { ok: false; reason: 'wrong_scheme' | 'wrong_host' | 'missing_param' | 'invalid' }
  | { ok: true; encoded: string };

/**
 * Parse apexfoss://import?d=… — data transport only.
 * Rejects any other scheme/host. Does not validate package (caller does).
 */
export function parseImportDeepLink(url: string): DeepLinkParseResult {
  if (typeof url !== 'string' || url.length === 0) return { ok: false, reason: 'invalid' };
  // Accept apexfoss://import?d=… (and apexfoss://import with no query → missing_param)
  if (/^apexfoss:\/\/import$/i.test(url)) return { ok: false, reason: 'missing_param' };
  const m = /^apexfoss:\/\/import\?(.*)$/i.exec(url);
  if (!m) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return { ok: false, reason: 'wrong_scheme' };
    return { ok: false, reason: 'invalid' };
  }
  const query = m[1];
  const parts = query.split('&');
  let data: string | null = null;
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq);
    const value = part.slice(eq + 1);
    if (key === DEEP_LINK_PARAM) data = value;
  }
  if (!data) return { ok: false, reason: 'missing_param' };
  if (!/^[A-Za-z0-9_-]+$/.test(data)) return { ok: false, reason: 'invalid' };
  if (utf8ByteLength(data) > MAX_PORTABLE_PAYLOAD_BYTES + 64) return { ok: false, reason: 'invalid' };
  return { ok: true, encoded: data };
}

/** Recover a routine package from a deep link. Validation errors propagate as PortabilityError. */
export function routineFromDeepLink(url: string): ApexRoutinePackage {
  const parsed = parseImportDeepLink(url);
  if (!parsed.ok) throw new PortabilityError('invalid_json', parsed.reason);
  return decodeRoutineTransport(parsed.encoded);
}
