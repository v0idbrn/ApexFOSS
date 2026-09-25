import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { database } from '../../data';
import { loadDashboard, type DashboardData } from '../../data/dashboard';
import { strings } from '../../constants/strings';
import { loadActiveWorkout } from '../../workout/runner';
import { gramRepsToKgReps } from '../../analytics/load';
import { formatCount } from '../../utils/units';
import { useNav } from '../navigation';
import { BarChart } from '../Charts';
import { Enter } from '../motion';
import {
  ActionTile,
  Card,
  EmptyState,
  ListRow,
  MetricCard,
  Screen,
  SectionHeader,
} from '../components';

interface ActiveRow {
  id: string;
  name: string;
  hint: string | null;
}

const emptyDashboard = (): DashboardData => ({
  recent: [],
  week: { sessionCount: 0, resistanceGramReps: 0, completedSetCount: 0, wallMs: 0 },
  daily: [],
  lastRoutine: null,
});

/** Home — athlete dashboard (Phase 2J §3): today, start, week, routine, recent, tools. */
export function HomeScreen() {
  const { push } = useNav();
  const [active, setActive] = useState<ActiveRow | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);

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
      setDashboard(await loadDashboard(database, Date.now()));
    } catch {
      setDashboard(emptyDashboard());
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const week = dashboard?.week;
  const daily = dashboard?.daily ?? [];
  const recent = dashboard?.recent ?? [];
  const lastRoutine = dashboard?.lastRoutine ?? null;
  const now = new Date();
  const dateLabel = now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const formatDay = (ts: number) => new Date(ts).toLocaleDateString(undefined, { weekday: 'narrow' });

  const toolsRow1 = [
    { label: strings.home.exercises, route: 'exercises' as const },
    { label: strings.home.routines, route: 'routines' as const },
    { label: strings.history.title, route: 'history' as const },
  ];
  const toolsRow2 = [
    { label: strings.athleteTools.load, route: 'load' as const },
    { label: strings.athleteTools.muscles, route: 'muscles' as const },
    { label: strings.athleteTools.readiness, route: 'readiness' as const },
  ];
  const toolsRow3 = [
    { label: strings.athleteTools.inventory, route: 'inventory' as const },
    { label: strings.portability.title, route: 'portability' as const },
  ];

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View className="px-4">
          <Enter className="mt-8">
            <Text className="text-overline uppercase text-accent-ink">{strings.home.today}</Text>
            <Text className="mt-1 text-display text-fg">{dateLabel}</Text>
          </Enter>

          <View className="mt-5">
            {active ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => push({ name: 'workout' })}
                style={({ pressed }) => (pressed ? { opacity: 0.85 } : undefined)}
                className="min-h-16 flex-row items-center justify-between rounded-xl border border-accent bg-accent/10 px-4 py-3"
              >
                <View className="flex-1 pr-2">
                  <Text className="text-overline uppercase text-accent-ink">{strings.home.activeSession}</Text>
                  <Text numberOfLines={1} className="mt-0.5 text-heading text-fg">
                    {active.name}
                  </Text>
                  {active.hint ? (
                    <Text className="mt-0.5 text-caption text-dim">{active.hint}</Text>
                  ) : null}
                </View>
                <Text className="text-body font-semibold text-accent-ink">{strings.home.resume}</Text>
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={strings.home.startWorkout}
                onPress={() => push({ name: 'routines' })}
                style={({ pressed }) => (pressed ? { opacity: 0.85, transform: [{ scale: 0.99 }] } : undefined)}
                className="min-h-16 flex-row items-center justify-between rounded-xl border border-accent bg-accent px-4 py-3"
              >
                <Text className="text-title text-fg">{strings.home.startWorkout}</Text>
                <Text className="text-xl text-fg">›</Text>
              </Pressable>
            )}
          </View>

          <Enter delayMs={60}>
            <SectionHeader title={strings.home.weekSection} />
            <View className="flex-row gap-2">
              <MetricCard
                size="sm"
                label={strings.home.weekSessions}
                value={formatCount(week?.sessionCount ?? 0)}
              />
              <MetricCard
                size="sm"
                label={strings.home.weekVolume}
                value={formatCount(gramRepsToKgReps(week?.resistanceGramReps ?? 0))}
                unit={strings.load.kgReps}
              />
              <MetricCard
                size="sm"
                label={strings.home.weekTime}
                value={formatCount((week?.wallMs ?? 0) / 60000)}
                unit={strings.home.weekTimeUnit}
              />
            </View>
            <Card tone="tonal" className="mt-2">
              <Text className="text-overline uppercase text-dim">{strings.home.chartCaption}</Text>
              <View className="mt-2">
                <BarChart
                  data={daily.map((d) => ({
                    key: String(d.dayStartMs),
                    value: d.resistanceGramReps,
                    caption: formatDay(d.dayStartMs),
                  }))}
                  label={strings.home.chartCaption}
                  format={(v) => formatCount(gramRepsToKgReps(v))}
                  emptyHint={strings.home.chartEmpty}
                />
              </View>
            </Card>
          </Enter>

          {lastRoutine ? (
            <Enter delayMs={100}>
              <SectionHeader title={strings.home.currentRoutine} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${strings.home.currentRoutine}: ${lastRoutine.name}`}
                onPress={() => push({ name: 'routineEditor', routineId: lastRoutine.id })}
                style={({ pressed }) => (pressed ? { opacity: 0.8 } : undefined)}
                className="min-h-14 flex-row items-center justify-between rounded-xl border border-line bg-surface px-4 py-3"
              >
                <View className="flex-1 pr-2">
                  <Text numberOfLines={1} className="text-heading text-fg">
                    {lastRoutine.name}
                  </Text>
                  <Text className="mt-0.5 text-caption text-dim">
                    {strings.home.lastTrained}:{' '}
                    {new Date(lastRoutine.lastTrainedAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </Text>
                </View>
                <Text className="text-xl text-dim">›</Text>
              </Pressable>
            </Enter>
          ) : null}

          <SectionHeader title={strings.home.recent} />
          {recent.length > 0 ? (
            <View className="overflow-hidden rounded-xl border border-line">
              {recent.slice(0, 3).map((s) => (
                <ListRow
                  key={s.id}
                  title={s.name}
                  subtitle={`${new Date(s.endedAt ?? s.startedAt).toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })} · ${s.setCount} ${strings.history.sets}`}
                  right={
                    <Text className="font-mono text-body text-fg">
                      {s.durationMs !== null ? `${Math.round(s.durationMs / 60000)} ${strings.home.weekTimeUnit}` : '—'}
                    </Text>
                  }
                  onPress={() => push({ name: 'historyDetail', sessionId: s.id })}
                />
              ))}
            </View>
          ) : (
            <EmptyState
              title={strings.home.recentEmptyTitle}
              message={strings.home.recentEmptyBody}
              description={strings.home.noSessions}
              actionLabel={strings.home.startWorkout}
              onAction={() => push({ name: 'routines' })}
            />
          )}

          <SectionHeader title={strings.home.tools} />
          <View className="flex-row gap-2">
            {toolsRow1.map((t) => (
              <ActionTile key={t.route} label={t.label} onPress={() => push({ name: t.route })} />
            ))}
          </View>
          <View className="mt-2 flex-row gap-2">
            {toolsRow2.map((t) => (
              <ActionTile key={t.route} label={t.label} onPress={() => push({ name: t.route })} />
            ))}
          </View>
          <View className="mt-2 flex-row gap-2">
            {toolsRow3.map((t) => (
              <ActionTile key={t.route} label={t.label} onPress={() => push({ name: t.route })} />
            ))}
          </View>

          <SectionHeader title={strings.home.appSection} />
          <View className="overflow-hidden rounded-xl border border-line">
            <ListRow
              title={strings.trust.title}
              subtitle={strings.trust.limitations}
              testID="home-trust"
              onPress={() => push({ name: 'trust' })}
            />
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}
