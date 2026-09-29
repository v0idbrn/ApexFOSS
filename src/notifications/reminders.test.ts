import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import { schema } from '../data/schema';
import { migrations } from '../data/migrations';
import { modelClasses } from '../data/models';
import { makeDbActions } from '../data/actions';
import { startWorkoutSession, loadWorkoutRuntime } from '../workout/runner';
import { getStrings, setStringsLocale } from '../constants/strings';
import {
  DEFAULT_REMINDER_HOUR,
  DEFAULT_REMINDER_MINUTE,
  TRAINING_REMINDER_ID,
  buildReminderPlan,
  cancelTrainingReminders,
  loadNextUpCommit,
  loadReminderPrefs,
  reminderLabels,
  saveReminderPrefs,
  syncTrainingReminders,
  type NextUpCommit,
  type ReminderLabels,
} from './reminders';

/**
 * Local training reminders (1.1.0): pure plan, deterministic identity,
 * resync that never touches timer notifications, permission-safe sync.
 */

const mockSchedule = jest.fn(async (...args: any[]) => 'scheduled-1');
const mockCancel = jest.fn(async (...args: any[]) => {});
const mockCancelAll = jest.fn(async (...args: any[]) => {});
const mockGetAll = jest.fn(async (...args: any[]) => [] as Array<{ identifier: string }>);
const mockSetChannel = jest.fn(async (...args: any[]) => {});
const mockRequestPerms = jest.fn(async (...args: any[]) => ({ granted: mockPermGranted }));
let mockPermGranted = true;

jest.mock('expo-notifications', () => ({
  scheduleNotificationAsync: (...args: unknown[]) => mockSchedule(...args),
  cancelScheduledNotificationAsync: (...args: unknown[]) => mockCancel(...args),
  cancelAllScheduledNotificationsAsync: (...args: unknown[]) => mockCancelAll(...args),
  getAllScheduledNotificationsAsync: (...args: unknown[]) => mockGetAll(...args),
  getPermissionsAsync: async () => ({ granted: mockPermGranted }),
  requestPermissionsAsync: (...args: unknown[]) => mockRequestPerms(...args),
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: (...args: unknown[]) => mockSetChannel(...args),
  AndroidImportance: { DEFAULT: 3 },
}));

function makeDb(): Database {
  const adapter = new LokiJSAdapter({
    dbName: `apex-reminders-${Math.random().toString(36).slice(2)}`,
    schema,
    migrations,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
  });
  return new Database({ adapter, modelClasses: modelClasses as any });
}

const LABELS: ReminderLabels = {
  appName: 'ApexFOSS',
  today: 'Today',
  blocks: 'blocks',
  steps: 'sets',
};

const COMMIT: NextUpCommit = {
  routineId: 'r1',
  routineName: 'Push',
  programId: 'p1',
  blockCount: 4,
  stepCount: 5,
};

async function programWithRoutine(db: Database, programName: string, routineName: string) {
  const actions = makeDbActions(db);
  const programId = await actions.createProgram(programName);
  const routineId = await actions.createRoutine(routineName);
  await actions.assignRoutineToProgram(routineId, programId);
  return { programId, routineId };
}

beforeEach(() => {
  mockSchedule.mockClear();
  mockCancel.mockClear();
  mockCancelAll.mockClear();
  mockGetAll.mockClear();
  mockSetChannel.mockClear();
  mockRequestPerms.mockClear();
  mockGetAll.mockResolvedValue([]);
  mockPermGranted = true;
  setStringsLocale('en');
});

describe('buildReminderPlan (pure)', () => {
  it('returns null when disabled', () => {
    expect(buildReminderPlan({ enabled: false, hour: 7, minute: 30 }, COMMIT, LABELS)).toBeNull();
  });

  it('returns null when no program suggests a routine (never a false reminder)', () => {
    expect(buildReminderPlan({ enabled: true, hour: 7, minute: 30 }, null, LABELS)).toBeNull();
  });

  it('builds a deterministic plan with routine content and identity', () => {
    const plan = buildReminderPlan({ enabled: true, hour: 7, minute: 30 }, COMMIT, LABELS);
    expect(plan).not.toBeNull();
    expect(plan!.identifier).toBe(TRAINING_REMINDER_ID);
    expect(plan!.identifier).toBe('apex-training-reminder');
    expect(plan!.title).toBe('ApexFOSS');
    expect(plan!.body).toBe('Today: Push · 4 blocks · 5 sets');
    expect(plan!.hour).toBe(7);
    expect(plan!.minute).toBe(30);
    expect(plan!.data).toEqual({ kind: 'training-reminder', routineId: 'r1', programId: 'p1' });
  });

  it('clamps out-of-range times to defaults instead of scheduling garbage', () => {
    const plan = buildReminderPlan({ enabled: true, hour: 99, minute: -5 }, COMMIT, LABELS);
    expect(plan!.hour).toBe(DEFAULT_REMINDER_HOUR);
    expect(plan!.minute).toBe(DEFAULT_REMINDER_MINUTE);
  });
});

describe('reminder preferences (app_settings)', () => {
  it('defaults to disabled at 07:00 on a fresh database', async () => {
    const prefs = await loadReminderPrefs(makeDb());
    expect(prefs).toEqual({ enabled: false, hour: 7, minute: 0 });
  });

  it('round-trips save/load and clamps invalid stored values', async () => {
    const db = makeDb();
    await saveReminderPrefs(db, { enabled: true, hour: 18, minute: 45 });
    expect(await loadReminderPrefs(db)).toEqual({ enabled: true, hour: 18, minute: 45 });
    await saveReminderPrefs(db, { enabled: true, hour: 99, minute: 99 });
    expect(await loadReminderPrefs(db)).toEqual({ enabled: true, hour: 7, minute: 0 });
  });
});

describe('syncTrainingReminders', () => {
  it('disabled prefs cancel the managed reminder and schedule nothing', async () => {
    const db = makeDb();
    await saveReminderPrefs(db, { enabled: false, hour: 7, minute: 0 });
    await syncTrainingReminders(db, LABELS);
    expect(mockCancel).toHaveBeenCalledWith(TRAINING_REMINDER_ID);
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('enabled prefs with no program cancel and schedule nothing (no false reminder)', async () => {
    const db = makeDb();
    await saveReminderPrefs(db, { enabled: true, hour: 7, minute: 0 });
    await syncTrainingReminders(db, LABELS);
    expect(mockCancel).toHaveBeenCalledWith(TRAINING_REMINDER_ID);
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('schedules a daily repeating reminder with identifier, content and data', async () => {
    const db = makeDb();
    await programWithRoutine(db, 'Strength', 'Push');
    await saveReminderPrefs(db, { enabled: true, hour: 7, minute: 30 });
    await syncTrainingReminders(db, LABELS);
    expect(mockCancel).toHaveBeenCalledWith(TRAINING_REMINDER_ID);
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    const call = mockSchedule.mock.calls[0][0];
    expect(call.identifier).toBe(TRAINING_REMINDER_ID);
    expect(call.content.title).toBe('ApexFOSS');
    expect(call.content.body).toBe('Today: Push · 0 blocks · 0 sets');
    expect(call.content.data).toEqual({ kind: 'training-reminder', routineId: expect.any(String), programId: expect.any(String) });
    expect(call.trigger).toEqual({ hour: 7, minute: 30, repeats: true });
  });

  it('never calls cancelAllScheduledNotificationsAsync', async () => {
    const db = makeDb();
    await programWithRoutine(db, 'Strength', 'Push');
    await saveReminderPrefs(db, { enabled: true, hour: 7, minute: 30 });
    await syncTrainingReminders(db, LABELS);
    await syncTrainingReminders(db, LABELS);
    expect(mockCancelAll).not.toHaveBeenCalled();
  });

  it('leaves timer/recovery notifications untouched', async () => {
    mockGetAll.mockResolvedValue([{ identifier: 'timer-abc' }, { identifier: TRAINING_REMINDER_ID }]);
    const db = makeDb();
    await programWithRoutine(db, 'Strength', 'Push');
    await saveReminderPrefs(db, { enabled: true, hour: 7, minute: 30 });
    await syncTrainingReminders(db, LABELS);
    expect(mockCancel).toHaveBeenCalledTimes(1);
    expect(mockCancel).toHaveBeenCalledWith(TRAINING_REMINDER_ID);
    expect(mockCancel).not.toHaveBeenCalledWith('timer-abc');
  });

  it('creates the dedicated Android channel on Android and never requests permission on sync', async () => {
    const { Platform } = require('react-native');
    const originalOS = Platform.OS;
    Platform.OS = 'android';
    try {
      const db = makeDb();
      await programWithRoutine(db, 'Strength', 'Push');
      await saveReminderPrefs(db, { enabled: true, hour: 7, minute: 30 });
      await syncTrainingReminders(db, LABELS);
      expect(mockSetChannel).toHaveBeenCalledWith('training-reminders', expect.objectContaining({ sound: false }));
      expect(mockRequestPerms).not.toHaveBeenCalled();
    } finally {
      Platform.OS = originalOS;
    }
  });

  it('resync replaces the managed reminder (cancel then schedule, same id)', async () => {
    const db = makeDb();
    await programWithRoutine(db, 'Strength', 'Push');
    await saveReminderPrefs(db, { enabled: true, hour: 7, minute: 30 });
    await syncTrainingReminders(db, LABELS);
    await saveReminderPrefs(db, { enabled: true, hour: 8, minute: 0 });
    await syncTrainingReminders(db, LABELS);
    expect(mockCancel).toHaveBeenCalledTimes(2);
    expect(mockSchedule).toHaveBeenCalledTimes(2);
    expect(mockSchedule.mock.calls[1][0].trigger).toEqual({ hour: 8, minute: 0, repeats: true });
  });

  it('cancelTrainingReminders only cancels the managed id', async () => {
    await cancelTrainingReminders();
    expect(mockCancel).toHaveBeenCalledTimes(1);
    expect(mockCancel).toHaveBeenCalledWith(TRAINING_REMINDER_ID);
    expect(mockCancelAll).not.toHaveBeenCalled();
  });
});

describe('scheduling integration (program rotation)', () => {
  it('workout start cancels the current instance and preserves future repeats', async () => {
    const db = makeDb();
    const { routineId } = await programWithRoutine(db, 'Strength', 'Push');
    await saveReminderPrefs(db, { enabled: true, hour: 7, minute: 30 });
    await syncTrainingReminders(db, LABELS);
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    await startWorkoutSession(db, routineId);
    await syncTrainingReminders(db, LABELS);
    expect(mockCancel).toHaveBeenCalledTimes(2);
    expect(mockCancel).toHaveBeenLastCalledWith(TRAINING_REMINDER_ID);
    expect(mockSchedule).toHaveBeenCalledTimes(2);
    expect(mockSchedule.mock.calls[1][0].trigger.repeats).toBe(true);
  });

  it('completing a session advances next-up content on resync', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    const programId = await actions.createProgram('Strength');
    const pushId = await actions.createRoutine('Push');
    const pullId = await actions.createRoutine('Pull');
    await actions.assignRoutineToProgram(pushId, programId);
    await actions.assignRoutineToProgram(pullId, programId);
    await saveReminderPrefs(db, { enabled: true, hour: 7, minute: 30 });
    await syncTrainingReminders(db, LABELS);
    expect(mockSchedule.mock.calls[0][0].content.body).toContain('Push');
    const sessionId = await startWorkoutSession(db, pushId);
    const rt = await loadWorkoutRuntime(db, sessionId);
    const session = await db.get<any>('workout_sessions').find(rt!.sessionId);
    await actions.completeSession(session, { ...rt!.cursor, status: 'completed' });
    await syncTrainingReminders(db, LABELS);
    const lastBody = mockSchedule.mock.calls[mockSchedule.mock.calls.length - 1][0].content.body;
    expect(lastBody).toContain('Pull');
  });

  it('adding an untrained routine resyncs to it (never-trained first)', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    const programId = await actions.createProgram('Strength');
    const pushId = await actions.createRoutine('Push');
    await actions.assignRoutineToProgram(pushId, programId);
    await saveReminderPrefs(db, { enabled: true, hour: 7, minute: 30 });
    await syncTrainingReminders(db, LABELS);
    expect(mockSchedule.mock.calls[0][0].content.body).toContain('Push');
    // Train Push, then add an untrained Pull: least-recently-trained loses.
    const sessionId = await startWorkoutSession(db, pushId);
    const rt = await loadWorkoutRuntime(db, sessionId);
    const session = await db.get<any>('workout_sessions').find(rt!.sessionId);
    await actions.completeSession(session, { ...rt!.cursor, status: 'completed' });
    const pullId = await actions.createRoutine('Pull');
    await actions.assignRoutineToProgram(pullId, programId);
    const commit = await loadNextUpCommit(db);
    expect(commit?.routineName).toBe('Pull');
    await syncTrainingReminders(db, LABELS);
    expect(mockSchedule.mock.calls[1][0].content.body).toContain('Pull');
  });

  it('removing the last routine from the program stops reminders', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    const programId = await actions.createProgram('Strength');
    const pushId = await actions.createRoutine('Push');
    await actions.assignRoutineToProgram(pushId, programId);
    await saveReminderPrefs(db, { enabled: true, hour: 7, minute: 30 });
    await syncTrainingReminders(db, LABELS);
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    await actions.removeRoutineFromProgram(pushId);
    await syncTrainingReminders(db, LABELS);
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    expect(mockCancel).toHaveBeenCalledTimes(2);
  });

  it('preferences survive reload and sync works with zero in-memory setup', async () => {
    const db = makeDb();
    await programWithRoutine(db, 'Strength', 'Push');
    await saveReminderPrefs(db, { enabled: true, hour: 6, minute: 15 });
    expect(await loadReminderPrefs(db)).toEqual({ enabled: true, hour: 6, minute: 15 });
    await syncTrainingReminders(db, LABELS);
    expect(mockSchedule.mock.calls[0][0].trigger).toEqual({ hour: 6, minute: 15, repeats: true });
  });
});

describe('reminder localization', () => {
  it('renders the body in Spanish with no raw keys', async () => {
    setStringsLocale('es');
    try {
      const labels = reminderLabels();
      expect(labels.today).toBe(getStrings('es').reminders.today);
      const plan = buildReminderPlan(
        { enabled: true, hour: 7, minute: 30 },
        { ...COMMIT, routineName: 'Empuje' },
        labels,
      );
      expect(plan!.body).toBe('Hoy: Empuje · 4 bloques · 5 series');
    } finally {
      setStringsLocale('en');
    }
  });

  it('uses the active dictionary for labels', () => {
    expect(reminderLabels().today).toBe('Today');
    setStringsLocale('es');
    try {
      expect(reminderLabels().today).toBe('Hoy');
    } finally {
      setStringsLocale('en');
    }
  });
});
