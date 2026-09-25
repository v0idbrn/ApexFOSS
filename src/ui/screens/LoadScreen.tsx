import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { database } from '../../data';
import { loadAnalyticsSnapshot, type AnalyticsSession } from '../../data/analytics';
import { strings } from '../../constants/strings';
import {
  calculateDateRangeLoad,
  dateRange,
  gramRepsToKgReps,
  msToSeconds,
  type DateRangeKind,
} from '../../analytics/load';
import { rollingSummary, weeklySeries } from '../../analytics/athlete';
import {
  calculateLoadRatio,
  calculateWindowTotals,
  compareWindows,
  currentWindow,
  previousWindow,
  type WindowComparison,
} from '../../analytics/trends';
import { useNav } from '../navigation';
import { AppHeader, Card, EmptyState, ErrorState, LoadingState, MetricCard, Screen, SectionHeader } from '../components';
import { Enter } from '../motion';
import { BarChart } from '../Charts';
import { formatCount } from '../../utils/units';

const RANGES: DateRangeKind[] = ['today', '7d', '28d'];

function rangeLabel(kind: DateRangeKind): string {
  if (kind === 'today') return strings.load.today;
  if (kind === '7d') return strings.load.last7;
  return strings.load.last28;
}

/** Short axis caption for a weekly bucket: local month/day (e.g. "9/18"). */
function weekCaption(weekStartMs: number): string {
  const d = new Date(weekStartMs);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function changeLabel(comparison: WindowComparison): string {
  if (comparison.percentChange === null) return strings.load.trends.noPrevious;
  const value = comparison.percentChange;
  return `${value > 0 ? '+' : ''}${value}%`;
}

function TrendCard({
  title,
  previousLabel,
  comparison,
}: {
  title: string;
  previousLabel: string;
  comparison: WindowComparison;
}) {
  return (
    <Card>
      <Text className="text-xs font-semibold uppercase tracking-wider text-dim">{title}</Text>
      <Text className="mt-3 text-xl font-bold text-fg">
        {gramRepsToKgReps(comparison.current.resistanceGramReps)} {strings.load.kgReps}
      </Text>
      <Text className="mt-1 text-sm text-dim">
        {previousLabel}: {gramRepsToKgReps(comparison.previous.resistanceGramReps)} {strings.load.kgReps}
      </Text>
      <Text className="mt-0.5 text-sm text-dim">
        {strings.load.trends.change}: {changeLabel(comparison)}
      </Text>
      <Text className="mt-0.5 text-xs text-dim">
        {strings.load.trends.sessions}: {comparison.current.sessionCount}
      </Text>
    </Card>
  );
}

export function LoadScreen() {
  const { pop } = useNav();
  const [sessions, setSessions] = useState<AnalyticsSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<DateRangeKind>('7d');

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const snapshot = await loadAnalyticsSnapshot(database);
      setSessions(snapshot.sessions);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const agg = useMemo(
    () => calculateDateRangeLoad(sessions, dateRange(kind, Date.now())),
    [sessions, kind],
  );

  const now = Date.now();
  const trend7 = compareWindows(
    calculateWindowTotals(sessions, currentWindow(now, 7)),
    calculateWindowTotals(sessions, previousWindow(now, 7)),
  );
  const trend28 = compareWindows(
    calculateWindowTotals(sessions, currentWindow(now, 28)),
    calculateWindowTotals(sessions, previousWindow(now, 28)),
  );
  const loadRatio = calculateLoadRatio(
    trend7.current.resistanceGramReps,
    trend28.previous.resistanceGramReps,
    trend28.previous.sessionCount,
  );
  const rhythm = rollingSummary(sessions, now, 7);
  const weekly = weeklySeries(sessions, now, 8);

  if (loading) {
    return (
      <Screen>
        <AppHeader title={strings.load.title} onBack={pop} />
        <LoadingState />
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen>
        <AppHeader title={strings.load.title} onBack={pop} />
        <ErrorState message={error} onRetry={reload} />
      </Screen>
    );
  }

  const empty = agg.completedSetCount === 0;

  return (
    <Screen>
      <AppHeader title={strings.load.title} onBack={pop} />
      <Enter className="flex-1">
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View className="flex-row gap-2 px-4 pt-4">
          {RANGES.map((r) => (
            <Pressable
              key={r}
              accessibilityRole="button"
              accessibilityState={{ selected: kind === r }}
              onPress={() => setKind(r)}
              className={`min-h-12 flex-1 items-center justify-center rounded-lg border px-3 ${
                kind === r ? 'border-accent bg-accent/10' : 'border-line bg-surface'
              }`}
            >
              <Text className={`text-sm font-semibold ${kind === r ? 'text-accent-ink' : 'text-dim'}`}>
                {rangeLabel(r)}
              </Text>
            </Pressable>
          ))}
        </View>

        <View className="px-4 pt-4">
          <Card>
            <Text className="text-xs font-semibold uppercase tracking-wider text-dim">
              {strings.load.completedSets}: {agg.completedSetCount}
            </Text>
            <Text className="mt-3 text-2xl font-bold text-fg">
              {gramRepsToKgReps(agg.resistanceGramReps)} {strings.load.kgReps}
            </Text>
            <Text className="mt-1 text-sm text-dim">
              {strings.load.resistance}: {agg.resistanceSetCount} {strings.load.sets}
            </Text>
            <Text className="mt-0.5 text-sm text-dim">
              {strings.load.duration}: {msToSeconds(agg.durationMs)} {strings.load.seconds} · {agg.durationSetCount}{' '}
              {strings.load.sets}
            </Text>
          </Card>
        </View>

        {empty ? (
          <View className="px-4 pt-6">
            <EmptyState message={strings.load.noData} />
          </View>
        ) : null}

        <View className="px-4">
          <SectionHeader title={strings.load.trends.section} />
          <TrendCard
            title={strings.load.trends.current7}
            previousLabel={strings.load.trends.previous7}
            comparison={trend7}
          />
          <View className="h-2" />
          <TrendCard
            title={strings.load.trends.current28}
            previousLabel={strings.load.trends.previous28}
            comparison={trend28}
          />
          <View className="h-2" />
          <Card>
            <Text className="text-xs font-semibold uppercase tracking-wider text-dim">
              {strings.load.ratio.label}
            </Text>
            {loadRatio.status === 'ok' ? (
              <View>
                <Text className="mt-3 text-2xl font-bold text-fg">{loadRatio.ratio?.toFixed(2)}</Text>
                <Text className="mt-1 text-sm text-dim">
                  {strings.load.ratio.currentWeek}:{' '}
                  {gramRepsToKgReps(loadRatio.acuteWeeklyGramReps)} {strings.load.kgReps}
                </Text>
                <Text className="mt-0.5 text-sm text-dim">
                  {strings.load.ratio.baselineWeek}:{' '}
                  {gramRepsToKgReps(loadRatio.chronicWeeklyGramReps ?? 0)} {strings.load.kgReps}
                </Text>
              </View>
            ) : (
              <Text className="mt-3 text-sm text-dim">
                {loadRatio.status === 'no_baseline'
                  ? strings.load.ratio.noBaseline
                  : strings.load.ratio.zeroBaseline}
              </Text>
            )}
          </Card>
        </View>

        <View className="px-4 pt-6">
          <SectionHeader title={strings.load.rhythm.section} />
          <Card>
            <Text className="text-overline uppercase text-dim">{strings.load.rhythm.window}</Text>
            <View className="mt-2 flex-row gap-2">
              <MetricCard
                size="sm"
                label={strings.load.rhythm.frequency}
                value={rhythm.sessionsPerWeek === null ? '—' : formatCount(rhythm.sessionsPerWeek)}
              />
              <MetricCard
                size="sm"
                label={strings.load.rhythm.avgSets}
                value={rhythm.avgSetsPerSession === null ? '—' : String(rhythm.avgSetsPerSession)}
              />
              <MetricCard
                size="sm"
                label={strings.load.rhythm.density}
                value={
                  rhythm.densityGramRepsPerMinute === null
                    ? '—'
                    : formatCount(gramRepsToKgReps(rhythm.densityGramRepsPerMinute))
                }
                unit={strings.load.rhythm.densityUnit}
              />
            </View>
            <View className="mt-4">
              <Text className="text-overline uppercase text-dim">{strings.load.rhythm.weeklyCaption}</Text>
              <View className="mt-2">
                <BarChart
                  label={strings.load.rhythm.weeklyLabel}
                  data={weekly.map((p, i) => ({
                    key: `w${i}`,
                    value: gramRepsToKgReps(p.resistanceGramReps),
                    caption: weekCaption(p.weekStartMs),
                  }))}
                  format={(v) => String(Math.round(v))}
                  emptyHint={strings.load.rhythm.weeklyEmpty}
                />
              </View>
            </View>
          </Card>
        </View>
      </ScrollView>
      </Enter>
    </Screen>
  );
}
