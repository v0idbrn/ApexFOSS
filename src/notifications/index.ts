/**
 * Local timer notifications (alert only).
 * NEVER the source of truth — cursor.timer.expiresAt is canonical.
 * Dynamic require so node tests never break when expo-notifications is unavailable.
 */

let permissionRequested = false;

export async function requestNotificationPermission(): Promise<boolean> {
  if (permissionRequested) return true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Notifications = require('expo-notifications');
    const { Platform } = require('react-native');
    if (Platform.OS !== 'android' && Platform.OS !== 'ios') return false;
    if (typeof Notifications.setNotificationHandler === 'function') {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldPlaySound: false,
          shouldSetBadge: false,
        }),
      });
    }
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) {
      permissionRequested = true;
      return true;
    }
    const asked = await Notifications.requestPermissionsAsync();
    permissionRequested = asked.granted === true;
    return permissionRequested;
  } catch {
    return false;
  }
}

/** Test hook: reset in-module permission latch (node tests only). */
export function __resetNotificationPermissionLatchForTests(): void {
  permissionRequested = false;
}

export async function scheduleTimerNotification(expiresAt: number, title: string): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Notifications = require('expo-notifications');
    const { Platform } = require('react-native');
    if (Platform.OS !== 'android' && Platform.OS !== 'ios') return null;
    // Ask only when we actually need to schedule a rest alert (not on app start).
    await requestNotificationPermission();
    // Date trigger: Android may deliver inexact under OS alarm policies;
    // in-app countdown always uses cursor.expiresAt and remains authoritative.
    const id = await Notifications.scheduleNotificationAsync({
      content: { title, body: 'Rest is over — next set.', sound: false },
      trigger: { type: 'date', timestamp: expiresAt } as any,
    });
    return id ?? null;
  } catch {
    return null;
  }
}

export async function cancelTimerNotification(id: string | null): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Notifications = require('expo-notifications');
    if (id) {
      await Notifications.cancelScheduledNotificationAsync(id);
      return;
    }
    // No known id (process death cleared the in-memory map). This app only ever
    // schedules one rest timer — clear any leftovers so recovery cannot double-fire.
    if (typeof Notifications.cancelAllScheduledNotificationsAsync === 'function') {
      await Notifications.cancelAllScheduledNotificationsAsync();
    }
  } catch {
    // ignore — engine state is authoritative
  }
}

export async function listScheduledNotificationIds(): Promise<string[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Notifications = require('expo-notifications');
    const all = await Notifications.getAllScheduledNotificationsAsync();
    return Array.isArray(all) ? all.map((n: { identifier: string }) => n.identifier) : [];
  } catch {
    return [];
  }
}
