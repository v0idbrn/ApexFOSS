import React from 'react';
import { Alert, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Navigator } from '../navigation';
import { HomeScreen } from './HomeScreen';
import { TrustScreen } from './TrustScreen';
import { strings } from '../../constants/strings';

jest.mock('../../data', () => ({ database: {} }));
jest.mock('../../workout/runner', () => ({
  loadActiveWorkout: jest.fn().mockResolvedValue(null),
}));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  scheduleNotificationAsync: jest.fn().mockResolvedValue('notif-1'),
  cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
  cancelAllScheduledNotificationsAsync: jest.fn().mockResolvedValue(undefined),
  getAllScheduledNotificationsAsync: jest.fn().mockResolvedValue([]),
}));

function flatten(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(flatten).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return '';
}

async function renderTrust(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <Navigator>{(route) => (route.name === 'home' ? <TrustScreen /> : null)}</Navigator>,
    );
  });
  await act(async () => {});
  return renderer;
}

describe('Trust, Safety & Legal center (spec section 19)', () => {
  it('renders every required legal and safety section', async () => {
    const renderer = await renderTrust();
    for (const testID of [
      'trust-data-card',
      'trust-counts',
      'trust-privacy',
      'trust-terms',
      'trust-health',
      'trust-security',
      'trust-limitations',
      'trust-licenses',
      'trust-about',
    ]) {
      expect(renderer.root.findAllByProps({ testID }).length).toBeGreaterThanOrEqual(1);
    }
  });

  it('shows zeroed counts when the database cannot be read', async () => {
    const renderer = await renderTrust();
    const exerciseCount = renderer.root.findByProps({
      testID: `count-${strings.trust.countExercises}`,
    });
    expect(flatten(exerciseCount.props.children)).toBe('0');
    const sessionCount = renderer.root.findByProps({
      testID: `count-${strings.trust.countSessions}`,
    });
    expect(flatten(sessionCount.props.children)).toBe('0');
  });

  it('offers an explicit destructive delete-all action with a confirmation', async () => {
    const renderer = await renderTrust();
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const button = renderer.root
      .findAll((node) => node.props?.accessibilityRole === 'button')
      .find((p) => p.findAllByType(Text).some((t) => flatten(t.props.children) === strings.trust.deleteAll));
    expect(button).toBeDefined();

    await act(async () => {
      button!.props.onPress();
    });
    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [, message, buttons] = alertSpy.mock.calls[0] as unknown as [
      string,
      string,
      { text: string; onPress?: () => void }[],
    ];
    expect(message).toBe(strings.trust.deleteAllConfirm);
    expect(buttons.map((b) => b.text)).toEqual([strings.common.cancel, strings.common.delete]);
    alertSpy.mockRestore();
  });

  it('shows a typed failure if the wipe cannot complete', async () => {
    const renderer = await renderTrust();
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((title, message, buttons) => {
      const destructive = (buttons ?? []).find((b) => b.style === 'destructive');
      destructive?.onPress?.();
    });
    await act(async () => {
      const button = renderer.root
        .findAll((node) => node.props?.accessibilityRole === 'button')
        .find((p) => p.findAllByType(Text).some((t) => flatten(t.props.children) === strings.trust.deleteAll));
      button!.props.onPress();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(renderer.root.findAllByProps({ testID: 'trust-error' }).length).toBeGreaterThanOrEqual(1);
    alertSpy.mockRestore();
  });

  it('is reachable from the home screen', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <Navigator>
          {(route) =>
            route.name === 'home' ? (
              <HomeScreen />
            ) : route.name === 'trust' ? (
              <Text testID="trust-route" />
            ) : null
          }
        </Navigator>,
      );
    });
    await act(async () => {});
    const entry = renderer.root
      .findAll((node) => node.props?.accessibilityRole === 'button')
      .find((p) => p.findAllByType(Text).some((t) => flatten(t.props.children) === strings.trust.title));
    expect(entry).toBeDefined();
    expect(entry!.props.testID).toBe('home-trust');
    await act(async () => {
      entry!.props.onPress();
    });
    expect(renderer.root.findAllByProps({ testID: 'trust-route' }).length).toBeGreaterThanOrEqual(1);
  });
});

describe('TrustScreen accessibility (Phase 2L STAGE H)', () => {
  function deleteAllButton(renderer: ReactTestRenderer) {
    return renderer.root
      .findAll(
        (node) => typeof node.type === 'string' && node.props?.accessibilityRole === 'button',
      )
      .find((p) => p.findAllByType(Text).some((t) => flatten(t.props.children) === strings.trust.deleteAll));
  }

  function pressDeleteAll(renderer: ReactTestRenderer) {
    const button = renderer.root
      .findAll((node) => node.props?.accessibilityRole === 'button')
      .find(
        (p) =>
          typeof p.props?.onPress === 'function' &&
          p.findAllByType(Text).some((t) => flatten(t.props.children) === strings.trust.deleteAll),
      );
    button!.props.onPress();
  }

  it('announces every trust section as a heading', async () => {
    const renderer = await renderTrust();
    const headers = renderer.root
      .findAll((node) => node.props?.accessibilityRole === 'header')
      .map((node) => flatten(node.props.children));
    for (const expected of [
      strings.trust.dataStorage,
      strings.trust.title,
      strings.trust.privacy,
      strings.trust.terms,
      strings.trust.health,
      strings.trust.security,
      strings.trust.limitations,
      strings.trust.licenses,
      strings.trust.about,
    ]) {
      expect(headers).toContain(expected);
    }
  });

  it('gives the destructive wipe action a role, label, state and large target', async () => {
    const renderer = await renderTrust();
    const button = deleteAllButton(renderer);
    expect(button).toBeDefined();
    expect(button!.props.accessibilityLabel).toBe(strings.trust.deleteAll);
    expect(button!.props.accessibilityState).toBeDefined();
    expect(typeof button!.props.className).toBe('string');
    expect(/\bh-(12|14|16|20|24|32)\b/.test(button!.props.className)).toBe(true);
  });

  it('publishes every local-data count as a label-value pair', async () => {
    const renderer = await renderTrust();
    for (const label of [
      strings.trust.countExercises,
      strings.trust.countSessions,
      strings.programs.title,
      strings.programs.mesocycles,
      strings.goals.title,
      strings.inventory.title,
      strings.body.title,
    ]) {
      const value = renderer.root.findByProps({ testID: `count-${label}` });
      expect(flatten(value.props.children)).toBe('0');
      expect(value.parent?.props.accessible).toBe(true);
      expect(value.parent?.props.accessibilityLabel).toBe(`${label}: 0`);
    }
  });

  it('announces a failed wipe as an alert', async () => {
    const renderer = await renderTrust();
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((title, message, buttons) => {
      const destructive = (buttons ?? []).find((b) => b.style === 'destructive');
      destructive?.onPress?.();
    });
    await act(async () => {
      pressDeleteAll(renderer);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const error = renderer.root.findByProps({ testID: 'trust-error' });
    expect(error.props.accessibilityRole).toBe('alert');
    expect(flatten(error.props.children)).toBe(strings.trust.deleteAllFailed);
    alertSpy.mockRestore();
  });
});
