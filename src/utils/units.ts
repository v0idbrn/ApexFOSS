/** Pure unit helpers. Storage units: grams, milliseconds, millimeters (§12). No floats persisted. */

export const kgToGrams = (kg: number): number => Math.round(kg * 1000);
export const gramsToKg = (g: number | null): number | null => (g === null ? null : g / 1000);

export const secondsToMs = (s: number): number => Math.round(s * 1000);
export const msToSeconds = (ms: number | null): number | null => (ms === null ? null : Math.round(ms / 1000));

export const mToMm = (m: number): number => Math.round(m * 1000);
export const mmToM = (mm: number | null): number | null => (mm === null ? null : mm / 1000);

/** Format kg for display: strips trailing zeros (100000 → "100", 102500 → "102.5"). */
export const formatKg = (grams: number | null): string => {
  if (grams === null) return '—';
  const kg = grams / 1000;
  return String(Number(kg.toFixed(3)));
};

/** Format an integer for display with en-US grouping (deterministic across devices). */
export const formatCount = (n: number): string => Math.round(n).toLocaleString('en-US');

/** Format milliseconds as m:ss countdown. */
export const formatCountdown = (msRemaining: number): string => {
  const total = Math.max(0, Math.ceil(msRemaining / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

/** Tempo 4 numbers (ms) → display "3-1-0-1" (seconds, blank for 0). */
export const formatTempo = (t: {
  eccentricMs: number | null;
  pauseBottomMs: number | null;
  concentricMs: number | null;
  pauseTopMs: number | null;
}): string => {
  const sec = (ms: number | null) => (ms === null || ms === 0 ? '0' : String(Math.round(ms / 1000)));
  return `${sec(t.eccentricMs)}-${sec(t.pauseBottomMs)}-${sec(t.concentricMs)}-${sec(t.pauseTopMs)}`;
};
