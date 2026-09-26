import { en, type Strings } from './strings.en';
import { es } from './strings.es';

export type { Strings };
export type Locale = 'en' | 'es';

/**
 * Locale-aware facade. Call sites keep importing `{ strings }` and reading
 * `strings.group.key` — no call-site changes required.
 *
 * The Proxy resolves each property access against the ACTIVE dictionary at
 * read time, so switching locale (setStringsLocale) takes effect immediately
 * for every subsequent read, including nested group objects.
 *
 * Fallback: an unknown top-level key falls back to the English dictionary;
 * a key missing everywhere returns undefined (no crash).
 */
const dicts: Record<Locale, Strings> = { en, es };
let active: Strings = en;

export function setStringsLocale(locale: Locale): void {
  active = dicts[locale] ?? en;
}

export function getStrings(locale: Locale): Strings {
  return dicts[locale] ?? en;
}

/** Locale currently backing the `strings` proxy (for diagnostics/tests). */
export function getActiveStringsLocale(): Locale {
  return active === es ? 'es' : 'en';
}

export const strings: Strings = new Proxy({} as Strings, {
  get: (_t, prop) =>
    (active as Record<PropertyKey, unknown>)[prop] ?? (en as Record<PropertyKey, unknown>)[prop],
});
