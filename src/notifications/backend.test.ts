/**
 * Backend selection for local notifications (normal build: expo-notifications,
 * F-Droid build: local ApexNotifications module) — docs/DECISIONS.md.
 */

describe('notification backend probe', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('expo-notifications');
  });

  it('latches upstream when expo-notifications permissions resolve', async () => {
    jest.resetModules();
    const getPermissionsAsync = jest.fn(async () => ({ granted: true }));
    jest.doMock('expo-notifications', () => ({
      getPermissionsAsync,
      scheduleNotificationAsync: jest.fn(),
    }));
    const backend = require('./backend');
    const upstream = await backend.upstreamNotifications();
    expect(upstream).not.toBeNull();
    expect(getPermissionsAsync).toHaveBeenCalledTimes(1);
    // Latched: second call does not re-probe.
    await backend.upstreamNotifications();
    expect(getPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('never loads expo-notifications when its natives are absent (F-Droid build)', async () => {
    jest.resetModules();
    const expoNotifications = jest.fn();
    jest.doMock('expo-notifications', () => {
      expoNotifications();
      return { getPermissionsAsync: jest.fn() };
    });
    jest.doMock('expo-modules-core', () => ({
      requireNativeModule: (name: string) => {
        throw new Error(`Cannot find native module '${name}'`);
      },
    }));
    const backend = require('./backend');
    const upstream = await backend.upstreamNotifications();
    expect(upstream).toBeNull();
    // Requiring the package when natives are missing is a fatal error on
    // device (Metro guardedLoadModule) — it must be unreachable.
    expect(expoNotifications).not.toHaveBeenCalled();
    jest.dontMock('expo-modules-core');
  });

  it('falls back to the local backend when native modules are absent (F-Droid build)', async () => {
    jest.resetModules();
    jest.doMock('expo-notifications', () => ({
      getPermissionsAsync: jest.fn().mockRejectedValue(new Error('module not found')),
      scheduleNotificationAsync: jest.fn(),
    }));
    const backend = require('./backend');
    const upstream = await backend.upstreamNotifications();
    expect(upstream).toBeNull();
    // No local native module in node either -> null (degrades like today).
    expect(backend.localNotifications()).toBeNull();
  });

  it('schedules and cancels through the local adapter shape', async () => {
    jest.resetModules();
    const native = {
      scheduleDailyAsync: jest.fn(async () => 'daily-1'),
      scheduleOnceAsync: jest.fn(async () => 'once-1'),
      cancelAsync: jest.fn(async () => undefined),
      cancelAllAsync: jest.fn(async () => undefined),
      listScheduledAsync: jest.fn(async () => ['a', 'b']),
      setChannelAsync: jest.fn(async () => undefined),
    };
    const { localNotificationAdapter } = require('./backend');
    const adapter = localNotificationAdapter(native);

    const dailyId = await adapter.scheduleNotificationAsync({
      identifier: 'apex-training-reminder',
      content: { title: 'ApexFOSS', body: 'today: Push', sound: false },
      trigger: { hour: 7, minute: 0, repeats: true },
    });
    expect(dailyId).toBe('daily-1');
    expect(native.scheduleDailyAsync).toHaveBeenCalledWith(
      'apex-training-reminder',
      'ApexFOSS',
      'today: Push',
      null,
      7,
      0,
    );

    const timerId = await adapter.scheduleNotificationAsync({
      content: { title: 'Rest done', body: 'Rest is over — next set.', sound: false },
      trigger: { type: 'date', timestamp: 1_700_000_000_000 },
    });
    expect(timerId).toBe('once-1');
    expect(native.scheduleOnceAsync).toHaveBeenCalledWith(
      null,
      'Rest done',
      'Rest is over — next set.',
      null,
      1_700_000_000_000,
    );

    await adapter.cancelScheduledNotificationAsync('once-1');
    expect(native.cancelAsync).toHaveBeenCalledWith('once-1');

    await adapter.cancelAllScheduledNotificationsAsync();
    expect(native.cancelAllAsync).toHaveBeenCalledTimes(1);

    const all = await adapter.getAllScheduledNotificationsAsync();
    expect(all).toEqual([{ identifier: 'a' }, { identifier: 'b' }]);

    await adapter.setNotificationChannelAsync('training-reminders', {
      name: 'ApexFOSS',
      importance: 5,
      sound: false,
    });
    expect(native.setChannelAsync).toHaveBeenCalledWith(
      'training-reminders',
      'ApexFOSS',
      5,
      false,
    );
  });
});

describe('index notification routing', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('expo-notifications');
  });

  it('schedules rest timers through expo-notifications when upstream is available', async () => {
    jest.resetModules();
    const mockSchedule = jest.fn(async () => 'timer-1');
    jest.doMock('expo-notifications', () => ({
      getPermissionsAsync: jest.fn(async () => ({ granted: true })),
      requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
      setNotificationHandler: jest.fn(),
      scheduleNotificationAsync: mockSchedule,
      cancelScheduledNotificationAsync: jest.fn(),
      cancelAllScheduledNotificationsAsync: jest.fn(),
      getAllScheduledNotificationsAsync: jest.fn(async () => []),
    }));
    const index = require('./index');
    const id = await index.scheduleTimerNotification(1_700_000_000_000, 'Rest done');
    expect(id).toBe('timer-1');
    expect(mockSchedule).toHaveBeenCalledWith({
      content: { title: 'Rest done', body: 'Rest is over — next set.', sound: false },
      trigger: { type: 'date', timestamp: 1_700_000_000_000 },
    });
    index.__resetNotificationPermissionLatchForTests();
  });

  it('never schedules through expo-notifications when its natives are absent', async () => {
    jest.resetModules();
    const mockSchedule = jest.fn(async () => 'timer-1');
    jest.doMock('expo-notifications', () => ({
      getPermissionsAsync: jest.fn().mockRejectedValue(new Error('module not found')),
      scheduleNotificationAsync: mockSchedule,
    }));
    const index = require('./index');
    const id = await index.scheduleTimerNotification(1_700_000_000_000, 'Rest done');
    expect(id).toBeNull();
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('skips scheduling when exact alarms are unavailable (API 34+ denied by default)', async () => {
    jest.resetModules();
    const native = {
      scheduleOnceAsync: jest.fn(async () => 'once-1'),
      canScheduleExactAlarmsAsync: jest.fn(async () => false),
    };
    const { localNotificationAdapter } = require('./backend');
    const adapter = localNotificationAdapter(native);
    const id = await adapter.scheduleNotificationAsync({
      content: { title: 'Rest done', body: 'Rest is over — next set.', sound: false },
      trigger: { type: 'date', timestamp: 1_700_000_000_000 },
    });
    expect(id).toBeNull();
    expect(native.scheduleOnceAsync).not.toHaveBeenCalled();
  });

  it('schedules when exact alarms are granted', async () => {
    jest.resetModules();
    const native = {
      scheduleOnceAsync: jest.fn(async () => 'once-1'),
      canScheduleExactAlarmsAsync: jest.fn(async () => true),
    };
    const { localNotificationAdapter } = require('./backend');
    const adapter = localNotificationAdapter(native);
    const id = await adapter.scheduleNotificationAsync({
      content: { title: 'Rest done', body: 'x', sound: false },
      trigger: { type: 'date', timestamp: 1_700_000_000_000 },
    });
    expect(id).toBe('once-1');
    expect(native.scheduleOnceAsync).toHaveBeenCalledTimes(1);
  });
});
