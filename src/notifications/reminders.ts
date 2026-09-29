import type { Database } from '@nozbe/watermelondb';
import { strings } from '../constants/strings';
import { loadNextUp } from '../data/scheduling';
import { makeDbActions } from '../data/actions';
import { getSetting, setSetting } from '../data/settings';

/**
 * Local training reminders (D-056).
 *
 * Source of truth is the program rotation (`loadNextUp` — WHAT is next, never
 * a calendar date). One managed daily notification at the user's habitual
 * time names the next-up routine; nothing is scheduled when no program
 * suggests a routine. Fully offline: expo-notifications local scheduling
 * only, no tokens, no backend.
 *
 * Managed identity is the deterministic identifier below — resync cancels and
 * recreates ONLY it, never timer/recovery notifications (no cancelAll here).
 */

export const TRAINING_REMINDER_ID = 'apex-training-reminder';
const TRAINING_REMINDER_CHANNEL = 'training-reminders';

const KEY_ENABLED = 'reminders.enabled';
const KEY_HOUR = 'reminders.hour';
const KEY_MINUTE = 'reminders.minute';

export const DEFAULT_REMINDER_HOUR = 7;
export const DEFAULT_REMINDER_MINUTE = 0;

export interface ReminderPrefs {
  enabled: boolean;
  hour: number;
  minute: number;
}

export interface NextUpCommit {
  routineId: string;
  routineName: string;
  programId: string;
  blockCount: number;
  stepCount: number;
}

/** Localized labels the plan needs (kept as params so the plan stays pure). */
export interface ReminderLabels {
  appName: string;
  today: string;
  blocks: string;
  steps: string;
}

export interface ReminderPlan {
  identifier: string;
  channelId: string;
  title: string;
  body: string;
  hour: number;
  minute: number;
  data: { kind: 'training-reminder'; routineId: string; programId: string };
}

function clampInt(v: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  const n = Math.floor(v);
  if (n < min || n > max) return fallback;
  return n;
}

export async function loadReminderPrefs(db: Database): Promise<ReminderPrefs> {
  const [enabledRaw, hourRaw, minuteRaw] = await Promise.all([
    getSetting(db, KEY_ENABLED),
    getSetting(db, KEY_HOUR),
    getSetting(db, KEY_MINUTE),
  ]);
  return {
    enabled: enabledRaw === '1',
    hour: clampInt(hourRaw == null ? NaN : Number(hourRaw), 0, 23, DEFAULT_REMINDER_HOUR),
    minute: clampInt(minuteRaw == null ? NaN : Number(minuteRaw), 0, 59, DEFAULT_REMINDER_MINUTE),
  };
}

export async function saveReminderPrefs(db: Database, prefs: ReminderPrefs): Promise<void> {
  const hour = clampInt(prefs.hour, 0, 23, DEFAULT_REMINDER_HOUR);
  const minute = clampInt(prefs.minute, 0, 59, DEFAULT_REMINDER_MINUTE);
  await setSetting(db, KEY_ENABLED, prefs.enabled ? '1' : '0');
  await setSetting(db, KEY_HOUR, String(hour));
  await setSetting(db, KEY_MINUTE, String(minute));
}

/**
 * Pure: preferences + next-up commitment -> reminder plan, or null when there
 * is nothing to notify about (disabled, or no program suggests a routine).
 */
export function buildReminderPlan(
  prefs: ReminderPrefs,
  nextUp: NextUpCommit | null,
  labels: ReminderLabels,
): ReminderPlan | null {
  if (!prefs.enabled || !nextUp) return null;
  const hour = clampInt(prefs.hour, 0, 23, DEFAULT_REMINDER_HOUR);
  const minute = clampInt(prefs.minute, 0, 59, DEFAULT_REMINDER_MINUTE);
  return {
    identifier: TRAINING_REMINDER_ID,
    channelId: TRAINING_REMINDER_CHANNEL,
    title: labels.appName,
    body: `${labels.today}: ${nextUp.routineName} · ${nextUp.blockCount} ${labels.blocks} · ${nextUp.stepCount} ${labels.steps}`,
    hour,
    minute,
    data: { kind: 'training-reminder', routineId: nextUp.routineId, programId: nextUp.programId },
  };
}

/** Next-up routine plus its structure counts (for the notification body). */
export async function loadNextUpCommit(db: Database): Promise<NextUpCommit | null> {
  const next = await loadNextUp(db);
  if (!next) return null;
  const rows = await makeDbActions(db).listRoutinesWithCounts();
  const row = rows.find((r) => r.id === next.routineId);
  return {
    routineId: next.routineId,
    routineName: next.routineName,
    programId: next.programId,
    blockCount: row?.blockCount ?? 0,
    stepCount: row?.stepCount ?? 0,
  };
}

function requireNotifications(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Notifications = require('expo-notifications');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Platform } = require('react-native');
    if (Platform.OS !== 'android' && Platform.OS !== 'ios') return null;
    if (typeof Notifications.scheduleNotificationAsync !== 'function') return null;
    return Notifications;
  } catch {
    return null;
  }
}

async function ensureReminderChannel(Notifications: any, name: string): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Platform } = require('react-native');
    if (Platform.OS !== 'android') return;
    if (typeof Notifications.setNotificationChannelAsync !== 'function') return;
    await Notifications.setNotificationChannelAsync(TRAINING_REMINDER_CHANNEL, {
      name,
      importance: Notifications.AndroidImportance?.DEFAULT ?? 3,
      sound: false,
    });
  } catch {
    // Channel creation is best-effort; the notification still fires on default.
  }
}

/** Cancel ONLY the managed training reminder (never timer notifications). */
export async function cancelTrainingReminders(): Promise<void> {
  const Notifications = requireNotifications();
  if (!Notifications) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(TRAINING_REMINDER_ID);
  } catch {
    // ignore — nothing pending or module unavailable
  }
}

/** Localized labels for the plan, resolved against the active dictionary. */
export function reminderLabels(): ReminderLabels {
  return {
    appName: strings.common.appName,
    today: strings.reminders.today,
    blocks: strings.routines.blocks.toLowerCase(),
    // Set counts use the history unit ('Sets'/'Series'), not routine steps ('Steps'/'Pasos').
    steps: strings.history.sets.toLowerCase(),
  };
}

/**
 * Single resync operation: cancel the managed reminder, recompute from
 * preferences + program rotation, and schedule when there is something to
 * notify about. Timer/recovery notifications are never touched.
 */
export async function syncTrainingReminders(db: Database, labels: ReminderLabels): Promise<void> {
  const Notifications = requireNotifications();
  if (!Notifications) return;
  try {
    const prefs = await loadReminderPrefs(db);
    await cancelTrainingReminders();
    if (!prefs.enabled) return;
    const nextUp = await loadNextUpCommit(db);
    const plan = buildReminderPlan(prefs, nextUp, labels);
    if (!plan) return;
    await ensureReminderChannel(Notifications, labels.appName);
    await Notifications.scheduleNotificationAsync({
      identifier: plan.identifier,
      content: {
        title: plan.title,
        body: plan.body,
        sound: false,
        data: plan.data,
      },
      trigger: { hour: plan.hour, minute: plan.minute, repeats: true },
    });
  } catch {
    // Reminders are advisory; never break the caller.
  }
}
