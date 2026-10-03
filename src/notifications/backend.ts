/**
 * Notification backend selection (docs/DECISIONS.md F-Droid build).
 *
 * The normal build links expo-notifications (unchanged). The F-Droid build
 * excludes it from autolinking (-PapexFdroid=true) so no Firebase/FCM enters
 * the APK; that build uses the local `ApexNotifications` module instead.
 *
 * Detection is runtime-only: the first call probes expo-notifications. When
 * its native modules are missing (F-Droid build) or the require fails, the
 * local backend is latched for the process. Jest mocks resolve upstream.
 */

type UpstreamNotifications = any;

let backendPromise: Promise<UpstreamNotifications | null> | null = null;

async function detectBackend(): Promise<UpstreamNotifications | null> {
  // Sentinel: expo-notifications' native modules. Its JS pulls in an eager
  // top-level requireNativeModule (ExpoPushTokenManager); when the natives are
  // absent (F-Droid build) Metro's guardedLoadModule reports that import error
  // as a FATAL error instead of throwing, so the package must never be
  // require()d before the natives are confirmed to exist.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { requireNativeModule } = require('expo-modules-core');
    requireNativeModule('ExpoPushTokenManager');
  } catch {
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const N = require('expo-notifications');
    if (N && typeof N.getPermissionsAsync === 'function') {
      await N.getPermissionsAsync();
      return N;
    }
    if (N && typeof N.scheduleNotificationAsync === 'function') return N;
  } catch {
    // Package present but unusable in this environment (e.g. plain node).
  }
  return null;
}

/** Upstream expo-notifications module, or null when the local backend is active. */
export function upstreamNotifications(): Promise<UpstreamNotifications | null> {
  if (!backendPromise) backendPromise = detectBackend();
  return backendPromise;
}

/** Native local module (F-Droid build), or null when unavailable. */
export function localNotifications(): UpstreamNotifications | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { requireNativeModule } = require('expo-modules-core');
    return requireNativeModule('ApexNotifications');
  } catch {
    return null;
  }
}

/**
 * Same call shape as expo-notifications for the subset this app uses, backed
 * by the native local module. Channel ids requested through
 * setNotificationChannelAsync are created; schedules post on the default
 * channel unless a trigger carries `channelId` (parity with upstream, whose
 * calendar trigger in this app never carries one either).
 */
export function localNotificationAdapter(native: UpstreamNotifications): UpstreamNotifications {
  return {
    AndroidImportance: { NONE: 2, MIN: 3, LOW: 4, DEFAULT: 5, HIGH: 6, MAX: 7 },
    async setNotificationChannelAsync(channelId: string, options: any) {
      await native.setChannelAsync(
        channelId,
        options?.name ?? channelId,
        options?.importance ?? 5,
        options?.sound !== false,
      );
      return null;
    },
    async scheduleNotificationAsync(request: any) {
      const content = request?.content ?? {};
      const trigger = request?.trigger;
      const channelId = trigger?.channelId ?? null;
      const title = content.title ?? '';
      const body = content.body ?? '';
      // Exact alarms need a user grant on API 31+ (denied by default on 34+).
      // Without it setAlarmClock throws; the in-app countdown stays
      // authoritative, so skip quietly. UI surfaces this via canScheduleExactAlarms.
      if (typeof native.canScheduleExactAlarmsAsync === 'function') {
        const can = await native.canScheduleExactAlarmsAsync();
        if (!can) return null;
      }
      if (trigger && trigger.repeats && typeof trigger.hour === 'number' && typeof trigger.minute === 'number') {
        return native.scheduleDailyAsync(
          request.identifier ?? null,
          title,
          body,
          channelId,
          trigger.hour,
          trigger.minute,
        );
      }
      if (trigger && typeof trigger.timestamp === 'number') {
        return native.scheduleOnceAsync(
          request.identifier ?? null,
          title,
          body,
          channelId,
          trigger.timestamp,
        );
      }
      return null;
    },
    async cancelScheduledNotificationAsync(id: string) {
      await native.cancelAsync(id);
    },
    async cancelAllScheduledNotificationsAsync() {
      await native.cancelAllAsync();
    },
    async getAllScheduledNotificationsAsync() {
      const ids = await native.listScheduledAsync();
      return Array.isArray(ids) ? ids.map((identifier: string) => ({ identifier })) : [];
    },
    async canScheduleExactAlarmsAsync() {
      return native.canScheduleExactAlarmsAsync();
    },
    async openExactAlarmSettingsAsync() {
      return native.openExactAlarmSettingsAsync();
    },
  };
}

/** Test hook: forget the latched backend (node tests only). */
export function __resetNotificationBackendForTests(): void {
  backendPromise = null;
}
