import fs from 'fs';
import path from 'path';
import React from 'react';
import { Linking, Text, TextInput } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Navigator, useNav } from '../navigation';
import { MoreScreen } from './MoreScreen';
import { strings } from '../../constants/strings';
import { getStrings, setStringsLocale } from '../../constants/strings';
import { GITHUB_SPONSORS_URL, MERCADOPAGO_URL, PAYPAL_URL } from '../../constants/support';

jest.mock('../../data', () => ({ database: {} }));
jest.mock('../../notifications/reminders', () => ({
  DEFAULT_REMINDER_HOUR: 7,
  DEFAULT_REMINDER_MINUTE: 0,
  loadReminderPrefs: jest.fn(() => Promise.resolve({ enabled: false, hour: 7, minute: 0 })),
  saveReminderPrefs: jest.fn(() => Promise.resolve()),
  syncTrainingReminders: jest.fn(() => Promise.resolve()),
  reminderLabels: jest.fn(() => ({ appName: 'ApexFOSS', today: 'Today', blocks: 'blocks', steps: 'sets' })),
}));
jest.mock('../../notifications', () => ({
  requestNotificationPermission: jest.fn(() => Promise.resolve(true)),
}));

import { loadReminderPrefs, saveReminderPrefs, syncTrainingReminders } from '../../notifications/reminders';
import { requestNotificationPermission } from '../../notifications';

/**
 * More screen: support entry (spec sections 30-32). Voluntary links open
 * only on explicit tap, point at the owner-provided public identities, and
 * the app ships no payment SDK.
 */

function flatten(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(flatten).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return '';
}

function textContents(renderer: ReactTestRenderer): string[] {
  return renderer.root
    .findAllByType(Text)
    .map((t) => flatten(t.props.children))
    .filter((s) => s.length > 0);
}

function pressableByTestID(renderer: ReactTestRenderer, testID: string) {
  return renderer.root
    .findAll((node) => node.props?.testID === testID && typeof node.props?.onPress === 'function')
    .find((node) => node.props?.accessibilityRole === 'button');
}

function GoToMore() {
  const { selectTab } = useNav();
  React.useEffect(() => {
    selectTab('more');
  }, [selectTab]);
  return null;
}

async function renderMore(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <Navigator>{(route) => (route.name === 'more' ? <MoreScreen /> : <GoToMore />)}</Navigator>,
    );
  });
  await act(async () => {});
  return renderer;
}

describe('MoreScreen support section', () => {
  let openURL: jest.SpyInstance;

  beforeEach(() => {
    openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  });

  afterEach(() => {
    openURL.mockRestore();
  });

  it('renders localized support copy with no raw translation keys', async () => {
    const renderer = await renderMore();
    const texts = textContents(renderer);
    expect(texts).toContain(strings.more.supportTitle);
    expect(texts).toContain(strings.more.supportBody);
    expect(texts).toContain(strings.more.supportSponsors);
    expect(texts).toContain(strings.more.supportPayPal);
    expect(texts).toContain(strings.more.supportMercadoPago);
    expect(texts).not.toContain('more.supportTitle');
    expect(texts).not.toContain('more.supportBody');
    expect(texts).not.toContain('more.supportMercadoPago');
  });

  it('opens nothing on render; each link opens only after an explicit tap', async () => {
    const renderer = await renderMore();
    expect(openURL).not.toHaveBeenCalled();

    const sponsors = pressableByTestID(renderer, 'more-support-sponsors');
    expect(sponsors).toBeDefined();
    await act(async () => {
      sponsors!.props.onPress();
    });
    expect(openURL).toHaveBeenCalledTimes(1);
    expect(openURL).toHaveBeenCalledWith(GITHUB_SPONSORS_URL);

    const paypal = pressableByTestID(renderer, 'more-support-paypal');
    expect(paypal).toBeDefined();
    await act(async () => {
      paypal!.props.onPress();
    });
    expect(openURL).toHaveBeenCalledTimes(2);
    expect(openURL).toHaveBeenLastCalledWith(PAYPAL_URL);

    const mercadopago = pressableByTestID(renderer, 'more-support-mercadopago');
    expect(mercadopago).toBeDefined();
    await act(async () => {
      mercadopago!.props.onPress();
    });
    expect(openURL).toHaveBeenCalledTimes(3);
    expect(openURL).toHaveBeenLastCalledWith(MERCADOPAGO_URL);
  });

  it('uses exactly the owner-provided public identities', () => {
    expect(GITHUB_SPONSORS_URL).toBe('https://github.com/sponsors/v0idbrn');
    expect(PAYPAL_URL).toBe('https://paypal.me/amelie615');
    expect(MERCADOPAGO_URL).toBe('https://link.mercadopago.com.ar/openv0id');
  });

  it('ships no payment or donation SDK', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', '..', '..', 'package.json'), 'utf8'),
    ) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(deps.filter((d) => /(stripe|paypal|mercadopago|braintree|razorpay|donation)/i.test(d))).toEqual([]);
  });

  it('renders all three support links in Spanish with no raw keys', async () => {
    setStringsLocale('es');
    try {
      const renderer = await renderMore();
      const texts = textContents(renderer);
      const esStrings = getStrings('es');
      expect(texts).toContain(esStrings.more.supportSponsors);
      expect(texts).toContain(esStrings.more.supportPayPal);
      expect(texts).toContain(esStrings.more.supportMercadoPago);
      expect(texts).not.toContain('more.supportMercadoPago');
      expect(pressableByTestID(renderer, 'more-support-mercadopago')).toBeDefined();
    } finally {
      setStringsLocale('en');
    }
  });

  it('keeps the existing About & legal rows reachable', async () => {
    const renderer = await renderMore();
    expect(pressableByTestID(renderer, 'more-trust')).toBeDefined();
    expect(pressableByTestID(renderer, 'more-portability')).toBeDefined();
  });
});

describe('MoreScreen training reminders', () => {
  const mockLoadPrefs = loadReminderPrefs as jest.Mock;
  const mockSavePrefs = saveReminderPrefs as jest.Mock;
  const mockSync = syncTrainingReminders as jest.Mock;
  const mockPerm = requestNotificationPermission as jest.Mock;

  function switchByTestID(renderer: ReactTestRenderer, testID: string) {
    return renderer.root
      .findAll((node) => node.props?.testID === testID && typeof node.props?.onValueChange === 'function')
      .find((node) => node.props?.accessibilityRole === 'switch');
  }

  beforeEach(() => {
    mockLoadPrefs.mockReset().mockResolvedValue({ enabled: false, hour: 7, minute: 0 });
    mockSavePrefs.mockReset().mockResolvedValue(undefined);
    mockSync.mockReset().mockResolvedValue(undefined);
    mockPerm.mockReset().mockResolvedValue(true);
  });

  it('renders the reminder row with localized copy and switch semantics', async () => {
    const renderer = await renderMore();
    const texts = textContents(renderer);
    expect(texts).toContain(strings.reminders.enableLabel);
    expect(texts).toContain(strings.reminders.hint);
    const toggle = switchByTestID(renderer, 'more-reminders-toggle');
    expect(toggle).toBeDefined();
    expect(toggle!.props.accessibilityLabel).toBe(strings.reminders.enableLabel);
    expect(toggle!.props.accessibilityState).toEqual({ checked: false });
    expect(mockPerm).not.toHaveBeenCalled();
  });

  it('enabling requests permission contextually, persists and syncs, reveals time fields', async () => {
    const renderer = await renderMore();
    const toggle = switchByTestID(renderer, 'more-reminders-toggle');
    await act(async () => {
      toggle!.props.onValueChange(true);
    });
    await act(async () => {});
    expect(mockPerm).toHaveBeenCalledTimes(1);
    expect(mockSavePrefs).toHaveBeenCalledWith(expect.anything(), { enabled: true, hour: 7, minute: 0 });
    expect(mockSync).toHaveBeenCalledTimes(1);
    expect(textContents(renderer)).toContain(strings.reminders.hourLabel);
    expect(textContents(renderer)).toContain(strings.reminders.minuteLabel);
  });

  it('denied permission blocks enable, persists nothing, shows localized explanation', async () => {
    mockPerm.mockResolvedValue(false);
    const renderer = await renderMore();
    const toggle = switchByTestID(renderer, 'more-reminders-toggle');
    await act(async () => {
      toggle!.props.onValueChange(true);
    });
    await act(async () => {});
    expect(textContents(renderer)).toContain(strings.reminders.permissionDenied);
    expect(mockSavePrefs).not.toHaveBeenCalled();
    expect(mockSync).not.toHaveBeenCalled();
  });

  it('disabling persists and syncs without touching permissions', async () => {
    mockLoadPrefs.mockResolvedValue({ enabled: true, hour: 7, minute: 0 });
    const renderer = await renderMore();
    const toggle = switchByTestID(renderer, 'more-reminders-toggle');
    await act(async () => {
      toggle!.props.onValueChange(false);
    });
    await act(async () => {});
    expect(mockPerm).not.toHaveBeenCalled();
    expect(mockSavePrefs).toHaveBeenCalledWith(expect.anything(), { enabled: false, hour: 7, minute: 0 });
    expect(mockSync).toHaveBeenCalledTimes(1);
  });

  it('editing the time persists the new time and resyncs', async () => {
    mockLoadPrefs.mockResolvedValue({ enabled: true, hour: 7, minute: 0 });
    const renderer = await renderMore();
    const inputs = renderer.root.findAllByType(TextInput);
    expect(inputs.length).toBeGreaterThanOrEqual(2);
    await act(async () => {
      inputs[0].props.onChangeText('18');
    });
    await act(async () => {});
    expect(mockSavePrefs).toHaveBeenCalledWith(expect.anything(), { enabled: true, hour: 18, minute: 0 });
    expect(mockSync).toHaveBeenCalled();
  });

  it('does not persist out-of-range intermediate keystrokes (e.g. "72" while replacing "7")', async () => {
    mockLoadPrefs.mockResolvedValue({ enabled: true, hour: 7, minute: 0 });
    const renderer = await renderMore();
    const inputs = renderer.root.findAllByType(TextInput);
    await act(async () => {
      inputs[0].props.onChangeText('72');
    });
    await act(async () => {});
    expect(mockSavePrefs).not.toHaveBeenCalled();
    expect(mockSync).not.toHaveBeenCalled();
  });

  it('renders reminder copy in Spanish with no raw keys', async () => {
    mockLoadPrefs.mockResolvedValue({ enabled: true, hour: 7, minute: 0 });
    setStringsLocale('es');
    try {
      const renderer = await renderMore();
      const texts = textContents(renderer);
      const esStrings = getStrings('es');
      expect(texts).toContain(esStrings.reminders.enableLabel);
      expect(texts).toContain(esStrings.reminders.hint);
      expect(texts).toContain(esStrings.reminders.hourLabel);
      expect(texts).not.toContain('reminders.enableLabel');
      expect(switchByTestID(renderer, 'more-reminders-toggle')).toBeDefined();
    } finally {
      setStringsLocale('en');
    }
  });
});
