import { create } from 'zustand';
import type { Database } from '@nozbe/watermelondb';
import { detectLocale } from '../constants/i18n';
import { setStringsLocale, type Locale } from '../constants/strings';
import { getSetting, setSetting } from '../data/settings';

/**
 * Locale store (zustand 5).
 *
 * - Initial locale comes from detectLocale() SYNCHRONOUSLY, so the very
 *   first paint already uses the device language (no flash).
 * - setLocale() applies the strings facade immediately, then persists an
 *   explicit user override (WatermelonDB `app_settings` row key `locale`).
 * - hydrate() applies a persisted override if present; absence means
 *   "follow the device locale". Persistence failures never throw — the
 *   store stays on the current locale and marks itself hydrated.
 *
 * hydrate() is NOT called automatically — App.tsx (owned by another
 * workstream) decides when to run it. Tests therefore never trigger
 * persistence just by importing this module.
 *
 * Re-render contract: components that must re-render on locale change call
 * `useLocale()` (a zustand selector hook). Non-reactive reads use
 * `getLocale()` or the `strings` facade directly.
 */

interface LocaleStoreState {
  locale: Locale;
  hydrated: boolean;
  /** Applies the locale to the strings facade, then persists the override. */
  setLocale(l: Locale): Promise<void>;
  /** Reads the persisted override (if any) and applies it. Always resolves. */
  hydrate(): Promise<void>;
}

const LOCALE_SETTING_KEY = 'locale';

/**
 * The strings facade defaults to `en` at module load, so the detected device
 * locale must be applied SYNCHRONOUSLY here — otherwise the store reports
 * e.g. `es` while the facade still serves English (found on device in Phase
 * 2L: switcher showed "Spanish" while the UI stayed English).
 */
const initialLocale = detectLocale();
setStringsLocale(initialLocale);

/**
 * The app database is resolved through a lazy CommonJS require (same pattern
 * as src/ui/keepAwake.ts): importing this store must not construct the SQLite
 * adapter at module scope, and `require` works under Jest where a native
 * dynamic `import()` callback does not. Any failure yields null — the caller
 * treats it as "no persistence available".
 */
function requireDatabase(): Database | null {
  try {
    const mod = require('../data') as { database?: Database };
    return mod?.database ?? null;
  } catch {
    return null;
  }
}

export const useLocaleStore = create<LocaleStoreState>((set) => ({
  locale: initialLocale,
  hydrated: false,

  async setLocale(l: Locale) {
    setStringsLocale(l); // apply first — UI updates even if persistence fails
    set({ locale: l });
    try {
      const db = requireDatabase();
      if (db) await setSetting(db, LOCALE_SETTING_KEY, l);
    } catch {
      // Persistence failure: keep the applied locale (never crash).
    }
  },

  async hydrate() {
    let stored: string | null = null;
    try {
      const db = requireDatabase();
      if (db) stored = await getSetting(db, LOCALE_SETTING_KEY);
    } catch {
      stored = null; // persistence failure → device locale
    }
    const override = stored === 'en' || stored === 'es' ? stored : null;
    if (override) {
      setStringsLocale(override);
      set({ locale: override, hydrated: true });
      return;
    }
    // No override: keep the facade on the detected locale (idempotent, but
    // guards against any earlier state drifting out of sync).
    setStringsLocale(initialLocale);
    set({ hydrated: true });
  },
}));

/** React hook: current locale (subscribes the component to locale changes). */
export function useLocale(): Locale {
  return useLocaleStore((s) => s.locale);
}

/** Non-hook read for imperative code (event handlers, formatters…). */
export function getLocale(): Locale {
  return useLocaleStore.getState().locale;
}
