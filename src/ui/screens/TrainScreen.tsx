import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { database } from '../../data';
import { makeDbActions } from '../../data/actions';
import { loadDashboard, type DashboardData, type DashboardSession } from '../../data/dashboard';
import { loadNextUp, type NextUpInfo } from '../../data/scheduling';
import { loadActiveWorkout, startWorkoutSession } from '../../workout/runner';
import { reminderLabels, syncTrainingReminders } from '../../notifications/reminders';
import { useActiveSessionStore } from '../../state/activeSessionStore';
import { strings } from '../../constants/strings';
import { gramRepsToKgReps } from '../../analytics/load';
import { formatCount } from '../../utils/units';
import { useNav } from '../navigation';
import { Card, EmptyState, ListRow, Screen, SectionHeader } from '../components';
import { Enter } from '../motion';

interface ActiveRow {
  id: string;
  name: string;
  hint: string | null;
}

interface RoutineRow {
  id: string;
  name: string;
  blockCount: number;
  stepCount: number;
}

/**
 * Train hub (Phase 2L tab 3): the between-sets home. Active session first,
 * one-tap repeat of the last workout, recent routines, last session recap.
 */
export function TrainScreen() {
  const { push, selectTab, startWorkout } = useNav();
  const [active, setActive] = useState<ActiveRow | null>(null);
  const [routines, setRoutines] = useState<RoutineRow[]>([]);
  const [lastSession, setLastSession] = useState<DashboardSession | null>(null);
  const [nextUp, setNextUp] = useState<NextUpInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setSession = useActiveSessionStore((s) => s.setSession);

  const reload = useCallback(async () => {
    try {
      const rt = await loadActiveWorkout(database);
      setActive(
        rt && rt.cursor.status === 'active'
          ? {
              id: rt.sessionId,
              name: rt.definition.name,
              hint: `${strings.workout.block} ${rt.cursor.blockIndex + 1}/${rt.definition.blocks.length}`,
            }
          : null,
      );
    } catch {
      setActive(null);
    }
    try {
      setRoutines((await makeDbActions(database).listRoutinesWithCounts()).slice(0, 3));
    } catch {
      setRoutines([]);
    }
    try {
      const dash: DashboardData = await loadDashboard(database, Date.now());
      setLastSession(dash.recent[0] ?? null);
    } catch {
      setLastSession(null);
    }
    try {
      setNextUp(await loadNextUp(database));
    } catch {
      setNextUp(null);
    }
    // Program/routine/session state may have changed since the last visit —
    // recompute the managed training reminder (cancel + reschedule one id).
    void syncTrainingReminders(database, reminderLabels());
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const repeatLast = useCallback(async () => {
    if (!lastSession?.routineId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const sessionId = await startWorkoutSession(database, lastSession.routineId);
      setSession(sessionId, lastSession.name);
      // The corresponding session is starting — drop its pending reminder
      // instance; future repeats are recomputed by the same call.
      void syncTrainingReminders(database, reminderLabels());
      startWorkout();
    } catch {
      setError(strings.workout.startFailed);
    } finally {
      setBusy(false);
    }
  }, [lastSession, busy, setSession, startWorkout]);

  const startNext = useCallback(async () => {
    if (!nextUp || busy) return;
    setBusy(true);
    setError(null);
    try {
      const sessionId = await startWorkoutSession(database, nextUp.routineId);
      setSession(sessionId, nextUp.routineName);
      void syncTrainingReminders(database, reminderLabels());
      startWorkout();
    } catch {
      setError(strings.workout.startFailed);
    } finally {
      setBusy(false);
    }
  }, [nextUp, busy, setSession, startWorkout]);

  const fmtDate = (ts: number) =>
    new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View className="px-4">
          <Enter className="mt-8">
            <Text className="text-display text-fg">{strings.train.title}</Text>
          </Enter>

          <View className="mt-5">
            {active ? (
              <Enter>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${strings.train.resume}: ${active.name}`}
                  onPress={startWorkout}
                  testID="train-active-card"
                  style={({ pressed }) => (pressed ? { opacity: 0.85 } : undefined)}
                  className="min-h-16 flex-row items-center justify-between rounded-xl border border-accent bg-accent/10 px-4 py-3"
                >
                  <View className="flex-1 pr-2">
                    <Text className="text-overline uppercase text-accent-ink">{strings.train.inProgress}</Text>
                    <Text numberOfLines={1} className="mt-0.5 text-heading text-fg">
                      {active.name}
                    </Text>
                    {active.hint ? <Text className="mt-0.5 text-caption text-dim">{active.hint}</Text> : null}
                  </View>
                  <Text className="text-body font-semibold text-accent-ink">{strings.train.resume}</Text>
                </Pressable>
              </Enter>
            ) : (
              <Enter>
                <Card tone="accent" testID="train-ready-card">
                  <Text className="text-heading text-fg">{strings.train.emptyTitle}</Text>
                  <Text className="mt-1 text-body text-dim">{strings.train.emptyBody}</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={strings.train.emptyAction}
                    onPress={() => selectTab('routines')}
                    testID="train-choose-routine"
                    style={({ pressed }) => (pressed ? { opacity: 0.85, transform: [{ scale: 0.99 }] } : undefined)}
                    className="mt-4 min-h-12 items-center justify-center rounded-lg bg-accent px-4"
                  >
                    <Text className="text-base font-semibold text-fg">{strings.train.emptyAction}</Text>
                  </Pressable>
                  {lastSession?.routineId ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={strings.train.repeatLast}
                      onPress={() => void repeatLast()}
                      disabled={busy}
                      testID="train-repeat-last"
                      style={({ pressed }) => (pressed ? { opacity: 0.85 } : undefined)}
                      className={`mt-2 min-h-12 items-center justify-center rounded-lg border border-line bg-surface px-4 ${busy ? 'opacity-50' : ''}`}
                    >
                      <Text className="text-base text-fg">{strings.train.repeatLast}</Text>
                    </Pressable>
                  ) : null}
                  {error ? (
                    <Text className="mt-2 text-sm text-danger" testID="train-error">
                      {error}
                    </Text>
                  ) : null}
                </Card>
              </Enter>
            )}
          </View>

          {nextUp ? (
            <Enter delayMs={40}>
              <Card testID="train-next-up" className="mt-4">
                <Text className="text-overline uppercase text-accent-ink">{strings.workout.nextUp}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${strings.workout.nextUp}: ${nextUp.routineName} (${nextUp.programName})`}
                  onPress={() => push({ name: 'programDetail', programId: nextUp.programId })}
                  testID="train-next-up-program"
                  style={({ pressed }) => (pressed ? { opacity: 0.85 } : undefined)}
                  className="min-h-12 justify-center"
                >
                  <Text numberOfLines={1} className="mt-1 text-heading text-fg">
                    {nextUp.routineName}
                  </Text>
                  <Text numberOfLines={1} className="mt-0.5 text-caption text-dim">
                    {nextUp.programName}
                  </Text>
                  {nextUp.neverTrained ? (
                    <Text className="mt-0.5 text-caption text-warning">{strings.train.nextUpNew}</Text>
                  ) : null}
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${strings.routines.start} ${nextUp.routineName}`}
                  onPress={() => void startNext()}
                  disabled={busy}
                  testID="train-next-up-start"
                  style={({ pressed }) => (pressed ? { opacity: 0.85 } : undefined)}
                  className={`mt-2 min-h-12 items-center justify-center rounded-lg bg-accent px-4 ${
                    busy ? 'opacity-50' : ''
                  }`}
                >
                  <Text className="text-base font-semibold text-fg">{strings.routines.start}</Text>
                </Pressable>
              </Card>
            </Enter>
          ) : null}

          <Enter delayMs={60}>
            <SectionHeader
              title={strings.train.recentRoutines}
              right={
                routines.length > 0 ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={strings.common.viewAll}
                    onPress={() => selectTab('routines')}
                    hitSlop={8}
                  >
                    <Text className="text-caption font-semibold text-accent-ink">{strings.common.viewAll}</Text>
                  </Pressable>
                ) : undefined
              }
            />
            {routines.length > 0 ? (
              <View className="overflow-hidden rounded-xl border border-line bg-surface">
                {routines.map((r) => (
                  <ListRow
                    key={r.id}
                    title={r.name}
                    subtitle={`${strings.routines.blocks}: ${r.blockCount} · ${strings.routines.steps}: ${r.stepCount}`}
                    onPress={() => selectTab('routines')}
                  />
                ))}
              </View>
            ) : (
              <EmptyState
                message={strings.train.emptyBody}
                actionLabel={strings.routines.emptyAction}
                onAction={() => selectTab('routines')}
              />
            )}
          </Enter>

          <Enter delayMs={100}>
            <SectionHeader title={strings.train.lastSession} />
            {lastSession ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${strings.train.lastSession}: ${lastSession.name}`}
                onPress={() => push({ name: 'historyDetail', sessionId: lastSession.id })}
                testID="train-last-session"
                style={({ pressed }) => (pressed ? { opacity: 0.8 } : undefined)}
                className="min-h-14 flex-row items-center justify-between rounded-xl border border-line bg-surface px-4 py-3"
              >
                <View className="flex-1 pr-2">
                  <Text numberOfLines={1} className="text-card-title text-fg">
                    {lastSession.name}
                  </Text>
                  <Text className="mt-0.5 text-caption text-dim">
                    {fmtDate(lastSession.endedAt ?? lastSession.startedAt)} · {lastSession.setCount}{' '}
                    {lastSession.setCount === 1 ? strings.workout.set : strings.history.sets}
                  </Text>
                </View>
                <Text className="font-mono text-body text-fg">
                  {formatCount(gramRepsToKgReps(lastSession.resistanceGramReps))} {strings.load.kgReps}
                </Text>
              </Pressable>
            ) : (
              <EmptyState
                message={strings.train.noSessions}
                actionLabel={strings.train.emptyAction}
                onAction={() => selectTab('routines')}
              />
            )}
          </Enter>
        </View>
      </ScrollView>
    </Screen>
  );
}
