import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { database } from '../../data';
import { loadDashboard, type DashboardData } from '../../data/dashboard';
import { strings } from '../../constants/strings';
import { loadActiveWorkout } from '../../workout/runner';
import { gramRepsToKgReps } from '../../analytics/load';
import { formatCount } from '../../utils/units';
import { useNav, type Route } from '../navigation';
import { BarChart } from '../Charts';
import { Enter } from '../motion';
import { Card, EmptyState, MetricCard, Screen } from '../components';

interface ActiveRow {
  id: string;
  name: string;
  hint: string | null;
}

interface ToolItem {
  label: string;
  route: Route;
  testID: string;
}

interface ToolGroupData {
  testID: string;
  label: string;
  items: ToolItem[];
}

const emptyDashboard = (): DashboardData => ({
  recent: [],
  week: { sessionCount: 0, resistanceGramReps: 0, completedSetCount: 0, wallMs: 0 },
  daily: [],
  lastRoutine: null,
});

/**
 * Section heading — same markup as `SectionHeader`, plus an explicit header
 * role so screen readers can walk the dashboard by headings (the shared
 * component does not expose the role and lives in a file this screen can't
 * edit).
 */
function SectionHeading({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <View className="mb-2 mt-6 flex-row items-center justify-between">
      <Text accessibilityRole="header" className="text-overline uppercase text-dim">
        {title}
      </Text>
      {right}
    </View>
  );
}

/**
 * Compact navigation row (≥56dp): explicit role/label/state for assistive
 * tech, optional mono value, chevron as a non-color affordance.
 */
function HomeRow({
  label,
  subtitle,
  value,
  testID,
  onPress,
}: {
  label: string;
  subtitle?: string;
  value?: string;
  testID?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${label} — ${subtitle}` : label}
      accessibilityState={{ disabled: false }}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => (pressed ? { opacity: 0.8 } : undefined)}
      className="min-h-14 flex-row items-center justify-between border-b border-line px-4 py-3"
    >
      <View className="flex-1 pr-3">
        <Text numberOfLines={1} className="text-base font-medium text-fg">
          {label}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} className="mt-0.5 text-sm text-dim">
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View className="flex-row items-center gap-2">
        {value ? <Text className="font-mono text-body text-fg">{value}</Text> : null}
        <Text
          importantForAccessibility="no"
          accessibilityElementsHidden
          className="text-xl text-dim"
        >
          ›
        </Text>
      </View>
    </Pressable>
  );
}

/** One condensed quick-tools group: captioned card block (replaces the tile wall). */
function ToolGroup({
  label,
  items,
  testID,
  onOpen,
}: {
  label: string;
  items: ToolItem[];
  testID: string;
  onOpen: (route: Route) => void;
}) {
  return (
    <View testID={testID} className="overflow-hidden rounded-xl border border-line bg-surface">
      <Text
        accessibilityRole="header"
        className="border-b border-line bg-surface-2 px-4 py-2 text-overline uppercase text-dim"
      >
        {label}
      </Text>
      {items.map((item) => (
        <HomeRow
          key={item.testID}
          label={item.label}
          testID={item.testID}
          onPress={() => onOpen(item.route)}
        />
      ))}
    </View>
  );
}

/**
 * Home — athlete dashboard (Phase 2L Stage E). Typographic header, a single
 * dominant hero (resume the active session, or start one), the week strip and
 * daily chart, current routine + recent training, a progress-snapshot entry,
 * and every former quick tool condensed into three grouped row blocks.
 */
export function HomeScreen() {
  const { push, selectTab, startWorkout } = useNav();
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

  /** Tab roots switch tabs (never get pushed into a stack); everything else pushes. */
  const openRoute = useCallback(
    (route: Route) => {
      if (route.name === 'routines') selectTab('routines');
      else push(route);
    },
    [push, selectTab],
  );

  const toolGroups: ToolGroupData[] = [
    {
      testID: 'home-group-authoring',
      label: strings.home.authoring,
      items: [
        { label: strings.home.exercises, route: { name: 'exercises' }, testID: 'home-tool-exercises' },
        { label: strings.home.routines, route: { name: 'routines' }, testID: 'home-tool-routines' },
      ],
    },
    {
      testID: 'home-group-training',
      label: strings.home.training,
      items: [
        { label: strings.history.title, route: { name: 'history' }, testID: 'home-tool-history' },
        { label: strings.athleteTools.records, route: { name: 'records' }, testID: 'home-tool-records' },
        { label: strings.athleteTools.load, route: { name: 'load' }, testID: 'home-tool-load' },
        { label: strings.athleteTools.muscles, route: { name: 'muscles' }, testID: 'home-tool-muscles' },
        { label: strings.athleteTools.readiness, route: { name: 'readiness' }, testID: 'home-tool-readiness' },
        { label: strings.athleteTools.inventory, route: { name: 'inventory' }, testID: 'home-tool-inventory' },
      ],
    },
    {
      testID: 'home-group-app',
      label: strings.home.appSection,
      items: [
        { label: strings.portability.title, route: { name: 'portability' }, testID: 'home-tool-portability' },
        { label: strings.trust.title, route: { name: 'trust' }, testID: 'home-trust' },
      ],
    },
  ];

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View className="px-4">
          <Enter className="mt-6">
            <View testID="home-header" className="flex-row items-start justify-between">
              <View className="flex-1 pr-3">
                <Text accessibilityRole="header" className="text-title text-fg">
                  {strings.home.title}
                </Text>
                <Text className="mt-0.5 text-caption text-dim">{strings.home.tagline}</Text>
              </View>
              <View className="items-end">
                <Text className="text-overline uppercase text-accent-ink">{strings.home.today}</Text>
                <Text className="mt-0.5 text-label text-muted">{dateLabel}</Text>
              </View>
            </View>
          </Enter>

          <Enter delayMs={40} className="mt-5">
            {active ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${strings.home.activeSession}: ${active.name}`}
                accessibilityState={{ disabled: false }}
                onPress={startWorkout}
                testID="home-hero-active"
                style={({ pressed }) => (pressed ? { opacity: 0.9, transform: [{ scale: 0.99 }] } : undefined)}
                className="min-h-32 rounded-2xl border-2 border-accent bg-accent/10 px-5 py-5"
              >
                <Text className="text-overline uppercase text-accent-ink">{strings.home.activeSession}</Text>
                <Text numberOfLines={1} className="mt-1.5 text-title text-fg">
                  {active.name}
                </Text>
                {active.hint ? <Text className="mt-1 text-body text-dim">{active.hint}</Text> : null}
                <View className="mt-4 min-h-12 flex-row items-center justify-between rounded-lg bg-accent px-4 py-3">
                  <Text className="text-base font-semibold text-fg">{strings.home.resume}</Text>
                  <Text
                    importantForAccessibility="no"
                    accessibilityElementsHidden
                    className="text-title text-fg"
                  >
                    ›
                  </Text>
                </View>
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={strings.home.startWorkout}
                accessibilityState={{ disabled: false }}
                onPress={() => selectTab('routines')}
                testID="home-hero-start"
                style={({ pressed }) => (pressed ? { opacity: 0.9, transform: [{ scale: 0.99 }] } : undefined)}
                className="min-h-32 rounded-2xl border border-accent bg-accent px-5 py-5"
              >
                <Text className="text-overline uppercase text-fg">{strings.home.today}</Text>
                <Text className="mt-1.5 text-title text-fg">{strings.home.startWorkout}</Text>
                <View className="mt-3 flex-row items-center justify-between">
                  <Text className="flex-1 pr-3 text-body text-fg">{strings.train.emptyBody}</Text>
                  <Text
                    importantForAccessibility="no"
                    accessibilityElementsHidden
                    className="text-metric-lg text-fg"
                  >
                    ›
                  </Text>
                </View>
              </Pressable>
            )}
          </Enter>

          <Enter delayMs={80}>
            <SectionHeading title={strings.home.weekSection} />
            <View className="flex-row gap-2">
              <MetricCard
                size="sm"
                label={strings.home.weekSessions}
                value={formatCount(week?.sessionCount ?? 0)}
                testID="home-week-sessions"
              />
              <MetricCard
                size="sm"
                label={strings.home.weekVolume}
                value={formatCount(gramRepsToKgReps(week?.resistanceGramReps ?? 0))}
                unit={strings.load.kgReps}
                testID="home-week-volume"
              />
              <MetricCard
                size="sm"
                label={strings.home.weekTime}
                value={formatCount((week?.wallMs ?? 0) / 60000)}
                unit={strings.home.weekTimeUnit}
                testID="home-week-time"
              />
            </View>
            <Card tone="tonal" className="mt-3" testID="home-chart">
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
              <SectionHeading title={strings.home.currentRoutine} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${strings.home.currentRoutine}: ${lastRoutine.name}`}
                accessibilityState={{ disabled: false }}
                onPress={() => push({ name: 'routineEditor', routineId: lastRoutine.id })}
                testID="home-current-routine"
                style={({ pressed }) => (pressed ? { opacity: 0.8 } : undefined)}
                className="min-h-16 flex-row items-center justify-between rounded-xl border border-line bg-surface px-4 py-3"
              >
                <View className="flex-1 pr-2">
                  <Text numberOfLines={1} className="text-card-title text-fg">
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
                <Text
                  importantForAccessibility="no"
                  accessibilityElementsHidden
                  className="text-xl text-dim"
                >
                  ›
                </Text>
              </Pressable>
            </Enter>
          ) : null}

          <Enter delayMs={120}>
            <SectionHeading
              title={strings.home.recent}
              right={
                recent.length > 0 ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={strings.common.viewAll}
                    accessibilityState={{ disabled: false }}
                    onPress={() => push({ name: 'history' })}
                    testID="home-view-all"
                    hitSlop={8}
                    className="min-h-11 justify-center px-1"
                  >
                    <Text className="text-caption font-semibold text-accent-ink">{strings.common.viewAll}</Text>
                  </Pressable>
                ) : undefined
              }
            />
            {recent.length > 0 ? (
              <View className="overflow-hidden rounded-xl border border-line">
                {recent.slice(0, 3).map((s) => (
                  <HomeRow
                    key={s.id}
                    testID={`home-recent-${s.id}`}
                    label={s.name}
                    subtitle={`${new Date(s.endedAt ?? s.startedAt).toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })} · ${s.setCount} ${strings.history.sets}`}
                    value={
                      s.durationMs !== null
                        ? `${Math.round(s.durationMs / 60000)} ${strings.home.weekTimeUnit}`
                        : '—'
                    }
                    onPress={() => push({ name: 'historyDetail', sessionId: s.id })}
                  />
                ))}
              </View>
            ) : (
              <EmptyState
                title={strings.home.recentEmptyTitle}
                message={strings.home.recentEmptyBody}
                actionLabel={strings.home.startWorkout}
                onAction={() => selectTab('routines')}
              />
            )}
          </Enter>

          <Enter delayMs={140} className="mt-6">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${strings.home.progressSnapshot}: ${strings.home.snapshotSub}`}
              accessibilityState={{ disabled: false }}
              onPress={() => selectTab('progress')}
              testID="home-progress-snapshot"
              style={({ pressed }) => (pressed ? { opacity: 0.85, transform: [{ scale: 0.99 }] } : undefined)}
              className="min-h-16 flex-row items-center rounded-2xl border border-line bg-surface-2 px-4 py-4"
            >
              <View
                importantForAccessibility="no"
                accessibilityElementsHidden
                className="mr-3 h-12 w-12 items-center justify-center rounded-xl border border-accent bg-accent/10"
              >
                <Text className="text-title text-accent-ink">▲</Text>
              </View>
              <View className="flex-1 pr-2">
                <Text numberOfLines={1} className="text-card-title text-fg">
                  {strings.home.progressSnapshot}
                </Text>
                <Text numberOfLines={1} className="mt-0.5 text-caption text-dim">
                  {strings.home.snapshotSub}
                </Text>
              </View>
              <Text importantForAccessibility="no" accessibilityElementsHidden className="text-xl text-dim">
                ›
              </Text>
            </Pressable>
          </Enter>

          <Enter delayMs={160}>
            <SectionHeading title={strings.home.tools} />
            <View className="gap-3">
              {toolGroups.map((group) => (
                <ToolGroup
                  key={group.testID}
                  testID={group.testID}
                  label={group.label}
                  items={group.items}
                  onOpen={openRoute}
                />
              ))}
            </View>
          </Enter>
        </View>
      </ScrollView>
    </Screen>
  );
}
