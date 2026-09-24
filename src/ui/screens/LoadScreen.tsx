import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { database } from '../../data';
import { listCompletedSessions, loadSessionDetail, type HistoryDetail } from '../../data/history';
import { strings } from '../../constants/strings';
import {
  calculateDateRangeLoad,
  dateRange,
  gramRepsToKgReps,
  msToSeconds,
  type DateRangeKind,
  type DatedSession,
  type SetLoadInput,
} from '../../analytics/load';
import { useNav } from '../navigation';
import { AppHeader, Card, ErrorState, LoadingState, Screen, SectionHeader } from '../components';

function toSetInputs(detail: HistoryDetail): DatedSession['exercises'] {
  return detail.blocks.map((block) => ({
    exerciseName: block.steps.map((s) => s.exerciseName).filter(Boolean).join(' / ') || strings.common.none,
    sets: block.steps.flatMap((step) =>
      step.logs.map(
        (log): SetLoadInput => ({
          weightGrams: log.weightGrams,
          reps: log.reps,
          durationMs: log.durationMs,
          isCompleted: true,
        }),
      ),
    ),
  }));
}

const RANGES: DateRangeKind[] = ['today', '7d', '28d'];

function rangeLabel(kind: DateRangeKind): string {
  if (kind === 'today') return strings.load.today;
  if (kind === '7d') return strings.load.last7;
  return strings.load.last28;
}

export function LoadScreen() {
  const { pop } = useNav();
  const [sessions, setSessions] = useState<DatedSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<DateRangeKind>('7d');

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const items = await listCompletedSessions(database);
      const detailed: DatedSession[] = [];
      for (const item of items) {
        const detail = await loadSessionDetail(database, item.id);
        if (!detail) continue;
        detailed.push({
          sessionId: detail.id,
          name: detail.name,
          timestampMs: detail.endedAt ?? detail.startedAt,
          startedAt: detail.startedAt,
          endedAt: detail.endedAt,
          exercises: toSetInputs(detail),
        });
      }
      setSessions(detailed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const agg = useMemo(() => calculateDateRangeLoad(sessions, dateRange(kind, Date.now())), [sessions, kind]);

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
              <Text className={`text-sm font-semibold ${kind === r ? 'text-accent' : 'text-dim'}`}>
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
            <Text className="text-center text-sm text-dim">{strings.load.noData}</Text>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
