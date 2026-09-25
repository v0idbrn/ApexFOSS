import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { database } from '../../data';
import { loadAnalyticsSnapshot, type AnalyticsSession } from '../../data/analytics';
import { strings } from '../../constants/strings';
import { formatKg, mmToM } from '../../utils/units';
import { exercisePrs, prHistory, type ExercisePr, type PrEvent, type PrMetric } from '../../analytics/records';
import { useNav } from '../navigation';
import { AppHeader, Badge, Card, EmptyState, ErrorState, LoadingState, Screen, SectionHeader } from '../components';

const fmtDate = (ts: number) =>
  new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

function metricLabel(metric: PrMetric): string {
  switch (metric) {
    case 'weight':
      return strings.records.weight;
    case 'reps':
      return strings.records.reps;
    case 'estimated1rm':
      return strings.records.est1rm;
    case 'duration':
      return strings.records.duration;
    case 'distance':
      return strings.records.distance;
  }
}

function metricText(metric: PrMetric, value: number): string {
  switch (metric) {
    case 'weight':
    case 'estimated1rm':
      return `${formatKg(value)} ${strings.records.kg}`;
    case 'reps':
      return String(value);
    case 'duration':
      return `${Math.round(value / 1000)} ${strings.records.secUnit}`;
    case 'distance':
      return `${mmToM(value)} ${strings.records.mUnit}`;
  }
}

function PrRow({ metric, value, atMs }: { metric: PrMetric; value: number | null; atMs: number | null }) {
  if (value === null) return null;
  return (
    <View className="mt-3 flex-row items-baseline justify-between">
      <View className="flex-1 pr-2">
        <Text className="text-caption uppercase tracking-wider text-dim">{metricLabel(metric)}</Text>
        {metric === 'estimated1rm' ? <Badge label={strings.records.estimateBadge} tone="neutral" /> : null}
      </View>
      <View className="items-end">
        <Text className="text-metric font-mono text-fg">{metricText(metric, value)}</Text>
        {atMs !== null ? <Text className="mt-0.5 text-caption text-dim">{fmtDate(atMs)}</Text> : null}
      </View>
    </View>
  );
}

function PrCard({
  pr,
  expanded,
  onToggle,
  history,
}: {
  pr: ExercisePr;
  expanded: boolean;
  onToggle: () => void;
  history: PrEvent[];
}) {
  return (
    <Card>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${pr.exerciseName}, ${strings.records.title}`}
        onPress={onToggle}
        style={({ pressed }) => (pressed ? { opacity: 0.85 } : undefined)}
        className="min-h-12 flex-row items-center justify-between"
      >
        <Text className="flex-1 text-heading text-fg" numberOfLines={1}>
          {pr.exerciseName}
        </Text>
        <Text className="text-caption text-accent-ink">{expanded ? strings.records.hideHistory : strings.records.showHistory}</Text>
      </Pressable>
      <PrRow metric="weight" value={pr.bestWeightGrams} atMs={pr.bestWeightAtMs} />
      <PrRow metric="reps" value={pr.bestReps} atMs={pr.bestRepsAtMs} />
      <PrRow metric="estimated1rm" value={pr.estimated1rmGrams} atMs={pr.estimated1rmAtMs} />
      <PrRow metric="duration" value={pr.bestDurationMs} atMs={pr.bestDurationAtMs} />
      <PrRow metric="distance" value={pr.bestDistanceMm} atMs={pr.bestDistanceAtMs} />
      {expanded ? (
        <View className="mt-3 border-t border-line pt-3">
          <Text className="text-overline uppercase text-dim">{strings.records.history}</Text>
          {history.length === 0 ? (
            <Text className="mt-2 text-caption text-dim">{strings.load.noData}</Text>
          ) : (
            history.map((event, i) => (
              <View key={`${event.metric}-${event.timestampMs}-${i}`} className="mt-2">
                <Text className="text-sm text-fg">
                  {metricLabel(event.metric)} · {metricText(event.metric, event.value)}
                </Text>
                <Text className="text-caption text-dim">
                  {fmtDate(event.timestampMs)}
                  {event.previousValue !== null
                    ? ` · ${strings.records.previously} ${metricText(event.metric, event.previousValue)}`
                    : ''}
                </Text>
              </View>
            ))
          )}
        </View>
      ) : null}
      {expanded && pr.estimated1rmGrams !== null ? (
        <Text className="mt-3 text-caption text-dim">{strings.records.estimateHint}</Text>
      ) : null}
    </Card>
  );
}

export function RecordsScreen() {
  const { pop } = useNav();
  const [sessions, setSessions] = useState<AnalyticsSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

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

  const prs = useMemo(() => exercisePrs(sessions), [sessions]);
  const history = useMemo(
    () => (expanded ? prHistory(sessions, expanded) : []),
    [sessions, expanded],
  );

  if (loading) {
    return (
      <Screen>
        <AppHeader title={strings.records.title} onBack={pop} />
        <LoadingState />
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen>
        <AppHeader title={strings.records.title} onBack={pop} />
        <ErrorState message={error} onRetry={reload} />
      </Screen>
    );
  }

  return (
    <Screen>
      <AppHeader title={strings.records.title} onBack={pop} />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        {prs.length === 0 ? (
          <View className="px-4 pt-8">
            <EmptyState title={strings.records.emptyTitle} message={strings.records.emptyBody} />
          </View>
        ) : (
          <View className="px-4 pt-4">
            <SectionHeader title={strings.records.title} />
            {prs.map((pr) => (
              <View key={pr.exerciseName} className="mb-2">
                <PrCard
                  pr={pr}
                  expanded={expanded === pr.exerciseName}
                  onToggle={() => setExpanded((cur) => (cur === pr.exerciseName ? null : pr.exerciseName))}
                  history={history}
                />
              </View>
            ))}
            <Text className="mt-1 text-caption text-dim">{strings.records.estimateHint}</Text>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
