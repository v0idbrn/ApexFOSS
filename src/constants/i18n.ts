import type { Locale } from './strings';

/**
 * Locale detection helpers. Pure, dependency-free, safe under Jest
 * (node/jsdom Intl both implement resolvedOptions()).
 */

/**
 * Maps a BCP-47 device tag to the app locale: any `es` prefix
 * (case-insensitive) → 'es', everything else → 'en'.
 */
export function localeToAppLocale(tag: string): Locale {
  try {
    if (typeof tag === 'string' && tag.toLowerCase().startsWith('es')) return 'es';
  } catch {
    // fall through to 'en'
  }
  return 'en';
}

/** Device locale from Intl; wrapped in try/catch → 'en' when Intl misbehaves. */
export function detectLocale(): Locale {
  try {
    return localeToAppLocale(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    return 'en';
  }
}
