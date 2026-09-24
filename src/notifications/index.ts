/**
 * Timer notifications. Dynamic require so node tests / early Day 1 builds never break;
 * real expo-notifications integration lands Day 4 (T4.1).
 */

export interface TimerNotificationHandle {
  id: string | null;
}

export async function scheduleTimerNotification(expiresAt: number, title: string): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Notifications = require('expo-notifications');
    const { Platform } = require('react-native');
    if (Platform.OS !== 'android' && Platform.OS !== 'ios') return null;
    const id = await Notifications.scheduleNotificationAsync({
      content: { title, body: 'Rest is over — next set.', sound: true },
      trigger: { type: 'date', timestamp: expiresAt } as any,
    });
    return id ?? null;
  } catch {
    return null; // expo-notifications unavailable (tests) — in-app timer still exact.
  }
}

export async function cancelTimerNotification(id: string | null): Promise<void> {
  if (!id) return;
  try {
    const Notifications = require('expo-notifications');
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    // ignore
  }
}
