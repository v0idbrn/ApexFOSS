import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { database } from '../../data';
import { loadDashboard, type DashboardData } from '../../data/dashboard';
import { strings } from '../../constants/strings';
import { gramRepsToKgReps } from '../../analytics/load';
import { formatCount } from '../../utils/units';
import { useNav } from '../navigation';
import { EmptyState, ListRow, MetricCard, Screen, SectionHeader } from '../components';
import { Enter } from '../motion';

/**
 * Progress hub (Phase 2L tab 4): one destination for the whole analytical
 * surface — weekly overview, history, records, load trends, muscle
 * analytics — with progressive disclosure into the dedicated screens.
 */
export function ProgressScreen() {
  const { push, selectTab } = useNav();
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);

  const reload = useCallback(async () => {
    try {
      setDashboard(await loadDashboard(database, Date.now()));
    } catch {
      setDashboard(null);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const week = dashboard?.week;
  const recent = dashboard?.recent ?? [];

  const analysisRows = [
    { title: strings.history.title, subtitle: strings.progress.historySub, route: 'history' as const, testID: 'progress-history' },
    { title: strings.records.title, subtitle: strings.progress.recordsSub, route: 'records' as const, testID: 'progress-records' },
    { title: strings.athleteTools.load, subtitle: strings.progress.loadSub, route: 'load' as const, testID: 'progress-load' },
    { title: strings.athleteTools.muscles, subtitle: strings.progress.musclesSub, route: 'muscles' as const, testID: 'progress-muscles' },
  ];

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View className="px-4">
          <Enter className="mt-8">
            <Text className="text-overline uppercase text-accent-ink">{strings.progress.title}</Text>
            <Text className="mt-1 text-display text-fg">{strings.home.weekSection}</Text>
          </Enter>

          <Enter delayMs={40}>
            <View className="mt-4 flex-row gap-2">
              <MetricCard
                size="sm"
                label={strings.home.weekSessions}
                value={formatCount(week?.sessionCount ?? 0)}
                testID="progress-week-sessions"
              />
              <MetricCard
                size="sm"
                label={strings.home.weekVolume}
                value={formatCount(gramRepsToKgReps(week?.resistanceGramReps ?? 0))}
                unit={strings.load.kgReps}
                testID="progress-week-volume"
              />
              <MetricCard
                size="sm"
                label={strings.home.weekTime}
                value={formatCount((week?.wallMs ?? 0) / 60000)}
                unit={strings.home.weekTimeUnit}
              />
            </View>
          </Enter>

          <Enter delayMs={80}>
            <SectionHeader title={strings.progress.analytics} />
            <View className="overflow-hidden rounded-xl border border-line">
              {analysisRows.map((row) => (
                <ListRow
                  key={row.route}
                  title={row.title}
                  subtitle={row.subtitle}
                  testID={row.testID}
                  onPress={() => push({ name: row.route })}
                />
              ))}
            </View>
          </Enter>

          <Enter delayMs={120}>
            <SectionHeader
              title={strings.home.recent}
              right={
                recent.length > 0 ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={strings.progress.viewHistory}
                    onPress={() => push({ name: 'history' })}
                    hitSlop={8}
                  >
                    <Text className="text-caption font-semibold text-accent-ink">{strings.common.viewAll}</Text>
                  </Pressable>
                ) : undefined
              }
            />
            {recent.length > 0 ? (
              <View className="overflow-hidden rounded-xl border border-line">
                {recent.slice(0, 4).map((s) => (
                  <ListRow
                    key={s.id}
                    title={s.name}
                    subtitle={`${new Date(s.endedAt ?? s.startedAt).toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })} · ${s.setCount} ${strings.history.sets}`}
                    onPress={() => push({ name: 'historyDetail', sessionId: s.id })}
                  />
                ))}
              </View>
            ) : (
              <EmptyState
                title={strings.home.recentEmptyTitle}
                message={strings.home.recentEmptyBody}
                actionLabel={strings.home.startWorkout}
                onAction={() => selectTab('train')}
              />
            )}
          </Enter>
        </View>
      </ScrollView>
    </Screen>
  );
}
