/**
 * Pure athlete numpad input logic. No React, no DB.
 * Display state stays a locale-independent string using '.' as decimal separator
 * (never formatted locale strings). Conversion to integer units happens only at
 * the application boundary (toNumpadPayload / existing toPayload).
 */

export type NumpadField = 'weight' | 'reps' | 'duration' | 'rir';

export type NumpadKey =
  | '0'
  | '1'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | '.'
  | 'backspace'
  | 'clear';

export const NUMPAD_FIELDS: readonly NumpadField[] = ['weight', 'reps', 'duration', 'rir'] as const;

/** Only weight accepts a decimal point; reps/duration/rir are integers. */
export function allowsDecimal(field: NumpadField): boolean {
  return field === 'weight';
}

/** Max fraction digits for the field (weight: grams precision → 3 dp in kg). */
export function maxFractionDigits(field: NumpadField): number {
  return field === 'weight' ? 3 : 0;
}

function sanitize(s: string): string {
  // Keep only digits and at most one leading '.'
  const cleaned = s.replace(/[^0-9.]/g, '');
  const firstDot = cleaned.indexOf('.');
  if (firstDot === -1) return cleaned;
  const head = cleaned.slice(0, firstDot + 1);
  const tail = cleaned.slice(firstDot + 1).replace(/\./g, '');
  return head + tail;
}

/** Normalize display string: strip leading zeros but keep "0." / "0". */
export function normalizeNumpadInput(raw: string): string {
  const s = sanitize(raw);
  if (s === '' || s === '.') return s === '.' ? '' : s;
  const [intPart, fracPart] = s.split('.');
  const hasDot = s.includes('.');
  let int = intPart.replace(/^0+(?=\d)/, '');
  if (int === '') int = '0';
  if (!hasDot) return int === '0' && raw.trim() === '' ? '' : int;
  return fracPart === undefined ? `${int}.` : `${int}.${fracPart}`;
}

/** True when the string is a finite number ≥ 0 (empty allowed → prescription fallback). */
export function isValidNumpadValue(s: string): boolean {
  const t = s.trim();
  if (t === '' || t === '.') return t === '';
  if (t.endsWith('.')) {
    const head = t.slice(0, -1);
    if (head === '') return false;
    return Number.isFinite(Number(head)) && Number(head) >= 0;
  }
  const n = Number(t);
  return Number.isFinite(n) && n >= 0;
}

/**
 * Apply a keypad key to the current display value for a field.
 * Returns the new display string (never null; '' means empty).
 */
export function applyNumpadKey(current: string, key: NumpadKey, field: NumpadField): string {
  const cur = current ?? '';
  if (key === 'clear') return '';
  if (key === 'backspace') {
    if (cur === '') return '';
    return cur.slice(0, -1);
  }
  if (key === '.') {
    if (!allowsDecimal(field)) return cur;
    if (cur.includes('.')) return cur;
    return cur === '' ? '0.' : `${cur}.`;
  }
  // digit
  const digitsInFrac = cur.includes('.') ? (cur.split('.')[1] ?? '').length : 0;
  if (cur.includes('.') && digitsInFrac >= maxFractionDigits(field)) return cur;
  if (!cur.includes('.') && cur.replace(/^0+/, '').length >= 12 && cur !== '0') return cur;

  let next = cur + key;
  // Avoid "00" leading nonsense for integer fields when value is exactly "0"
  if (!cur.includes('.') && cur === '0' && key === '0') return cur;
  next = normalizeNumpadInput(next);
  return next;
}

export type NumpadModifier =
  | 'kg+1.25'
  | 'kg+2.5'
  | 'kg+5'
  | 'reps+1'
  | 'reps-1';

/** Modifiers that make sense for a field (kg only on weight, reps only on reps). */
export function compatibleModifiers(field: NumpadField): NumpadModifier[] {
  if (field === 'weight') return ['kg+1.25', 'kg+2.5', 'kg+5'];
  if (field === 'reps') return ['reps+1', 'reps-1'];
  return [];
}

export function isCompatibleModifier(field: NumpadField, mod: NumpadModifier): boolean {
  return compatibleModifiers(field).includes(mod);
}

const MODIFIER_DELTA: Record<NumpadModifier, number> = {
  'kg+1.25': 1.25,
  'kg+2.5': 2.5,
  'kg+5': 5,
  'reps+1': 1,
  'reps-1': -1,
};

/**
 * Apply a quick modifier to the active compatible field.
 * Incompatible modifiers are a no-op (returns current unchanged).
 * Empty weight starts from 0; empty reps starts from 0 for +, clamps at 0 for −.
 * Result is re-normalized (no float drift in the display string beyond 3 dp kg / int reps).
 */
export function applyNumpadModifier(current: string, field: NumpadField, mod: NumpadModifier): string {
  if (!isCompatibleModifier(field, mod)) return current;
  const base = isValidNumpadValue(current) && current.trim() !== '' ? Number(current) : 0;
  const delta = MODIFIER_DELTA[mod];
  let next = base + delta;
  if (next < 0) next = 0;
  if (field === 'weight') {
    // Quantize to grams (0.001 kg) to avoid 0.30000000000000004 style strings.
    const grams = Math.round(next * 1000);
    return normalizeNumpadInput(String(grams / 1000));
  }
  return normalizeNumpadInput(String(Math.round(next)));
}

export interface NumpadInput {
  weightKg: string;
  reps: string;
  durationS: string;
  rir: string;
}

export function emptyNumpadInput(): NumpadInput {
  return { weightKg: '', reps: '', durationS: '', rir: '' };
}

export function readNumpadField(input: NumpadInput, field: NumpadField): string {
  switch (field) {
    case 'weight':
      return input.weightKg;
    case 'reps':
      return input.reps;
    case 'duration':
      return input.durationS;
    case 'rir':
      return input.rir;
  }
}

export function writeNumpadField(input: NumpadInput, field: NumpadField, value: string): NumpadInput {
  switch (field) {
    case 'weight':
      return { ...input, weightKg: value };
    case 'reps':
      return { ...input, reps: value };
    case 'duration':
      return { ...input, durationS: value };
    case 'rir':
      return { ...input, rir: value };
  }
}

export function allNumpadValuesValid(input: NumpadInput): boolean {
  return (
    isValidNumpadValue(input.weightKg) &&
    isValidNumpadValue(input.reps) &&
    isValidNumpadValue(input.durationS) &&
    isValidNumpadValue(input.rir)
  );
}

/** Parse display kg string → integer grams (null when empty → prescription fallback). */
export function weightKgStringToGrams(s: string): number | null {
  const t = s.trim();
  if (!t || t === '.') return null;
  if (!isValidNumpadValue(t)) return null;
  return Math.round(Number(t) * 1000);
}

/** Parse display seconds string → integer milliseconds (null when empty). */
export function durationStringToMs(s: string): number | null {
  const t = s.trim();
  if (!t || t === '.') return null;
  if (!isValidNumpadValue(t)) return null;
  return Math.round(Number(t) * 1000);
}

/** Parse display integer string → non-negative integer (null when empty). */
export function intStringToNonNegative(s: string): number | null {
  const t = s.trim();
  if (!t || t === '.') return null;
  if (!isValidNumpadValue(t)) return null;
  return Math.max(0, Math.round(Number(t)));
}
