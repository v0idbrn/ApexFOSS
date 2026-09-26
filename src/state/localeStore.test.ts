import { getActiveStringsLocale, setStringsLocale, strings } from '../constants/strings';

jest.mock('../constants/i18n', () => ({
  detectLocale: jest.fn(() => 'es' as const),
}));

jest.mock('../data', () => ({ database: {} }));

jest.mock('../data/settings', () => ({
  getSetting: jest.fn(async () => null as string | null),
  setSetting: jest.fn(async () => undefined),
}));

import { getSetting, setSetting } from '../data/settings';
import { useLocaleStore } from './localeStore';

/**
 * Regression (Phase 2L device validation): the strings facade defaults to
 * `en` while the store initialises from detectLocale(). On an es-AR device
 * the Language switcher showed "Spanish" while the UI stayed English.
 * These tests pin facade ↔ store synchronisation for import, hydrate and
 * setLocale paths.
 */

describe('locale store ↔ strings facade sync (Phase 2L)', () => {
  it('applies the detected device locale to the facade at import time', () => {
    expect(useLocaleStore.getState().locale).toBe('es');
    expect(getActiveStringsLocale()).toBe('es');
    expect(strings.train.title).toBe('Entrenar'); // proves ES dictionary serves
  });

  it('keeps the facade on the detected locale when hydrate finds no override', async () => {
    (getSetting as jest.Mock).mockResolvedValueOnce(null);
    setStringsLocale('en'); // simulate drift away from the store
    await useLocaleStore.getState().hydrate();
    expect(useLocaleStore.getState().hydrated).toBe(true);
    expect(useLocaleStore.getState().locale).toBe('es');
    expect(getActiveStringsLocale()).toBe('es');
  });

  it('applies a persisted override during hydrate', async () => {
    (getSetting as jest.Mock).mockResolvedValueOnce('en');
    await useLocaleStore.getState().hydrate();
    expect(useLocaleStore.getState().locale).toBe('en');
    expect(getActiveStringsLocale()).toBe('en');
  });

  it('setLocale applies the facade synchronously before persistence resolves', async () => {
    const pending = useLocaleStore.getState().setLocale('es');
    expect(getActiveStringsLocale()).toBe('es'); // before any await
    expect(useLocaleStore.getState().locale).toBe('es');
    await pending;
    expect(setSetting).toHaveBeenCalledWith(expect.anything(), 'locale', 'es');
  });
});
