/**
 * Local timer notifications (alert only).
 * NEVER the source of truth — cursor.timer.expiresAt is canonical.
 * Routes to expo-notifications (normal build) or the local ApexNotifications
 * module (F-Droid build) — see backend.ts for detection.
 */

import { upstreamNotifications, localNotifications, localNotificationAdapter } from './backend';

let permissionRequested = false;

async function notificationApi(): Promise<any | null> {
  const upstream = await upstreamNotifications();
  if (upstream) return upstream;
  const local = localNotifications();
  return local ? localNotificationAdapter(local) : null;
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (permissionRequested) return true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Platform } = require('react-native');
    if (Platform.OS !== 'android' && Platform.OS !== 'ios') return false;
    const upstream = await upstreamNotifications();
    const Notifications = upstream ?? localNotifications();
    if (!Notifications) return false;
    if (upstream && typeof Notifications.setNotificationHandler === 'function') {
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

/**
 * Whether exact alarms can currently be scheduled. True for upstream builds
 * (expo-notifications manages its own exactness) and when the local module is
 * absent/unavailable — never block what cannot be assessed. False only when
 * the local module reports the user has not granted SCHEDULE_EXACT_ALARM.
 */
export async function canScheduleExactAlarms(): Promise<boolean> {
  try {
    const Notifications = await notificationApi();
    if (!Notifications || typeof Notifications.canScheduleExactAlarmsAsync !== 'function') return true;
    return (await Notifications.canScheduleExactAlarmsAsync()) === true;
  } catch {
    return true;
  }
}

/** Opens the system Alarms & reminders screen (local module only). No-op elsewhere. */
export async function openExactAlarmSettings(): Promise<void> {
  try {
    const Notifications = await notificationApi();
    if (Notifications && typeof Notifications.openExactAlarmSettingsAsync === 'function') {
      await Notifications.openExactAlarmSettingsAsync();
    }
  } catch {
    // ignore — settings navigation is best-effort
  }
}

export async function scheduleTimerNotification(expiresAt: number, title: string): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Platform } = require('react-native');
    if (Platform.OS !== 'android' && Platform.OS !== 'ios') return null;
    // Ask only when we actually need to schedule a rest alert (not on app start).
    await requestNotificationPermission();
    const Notifications = await notificationApi();
    if (!Notifications) return null;
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
    const Notifications = await notificationApi();
    if (!Notifications) return;
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
    const Notifications = await notificationApi();
    if (!Notifications) return [];
    const all = await Notifications.getAllScheduledNotificationsAsync();
    return Array.isArray(all) ? all.map((n: { identifier: string }) => n.identifier) : [];
  } catch {
    return [];
  }
}
