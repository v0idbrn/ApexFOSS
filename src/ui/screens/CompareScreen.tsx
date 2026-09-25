import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { database } from '../../data';
import { loadAnalyticsSnapshot, type AnalyticsSession } from '../../data/analytics';
import { strings } from '../../constants/strings';
import { gramRepsToKgReps } from '../../analytics/load';
import {
  compareSessions,
  previousSessionBefore,
  type ExerciseComparison,
  type SessionComparison,
} from '../../analytics/compare';
import { useNav } from '../navigation';
import { AppHeader, Badge, Card, EmptyState, ErrorState, LoadingState, Screen, SectionHeader } from '../components';
import { Enter } from '../motion';

const fmtDate = (ts: number) =>
  new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

function signed(n: number): string {
  return `${n > 0 ? '+' : ''}${n}`;
}

function DeltaText({ delta, unit }: { delta: number; unit: string }) {
  return (
    <Text className={`text-caption ${delta === 0 ? 'text-dim' : 'text-accent-ink'}`}>
      {signed(delta)} {unit}
    </Text>
  );
}

function TotalRow({ label, previous, current, delta, unit }: { label: string; previous: string; current: string; delta: number; unit: string }) {
  return (
    <View className="mt-3 border-t border-line pt-3 first:mt-0 first:border-t-0 first:pt-0">
      <Text className="text-overline uppercase text-dim">{label}</Text>
      <View className="mt-1 flex-row items-baseline justify-between">
        <Text className="text-caption text-dim">
          {strings.compare.previous}: {previous}
        </Text>
        <Text className="text-caption text-dim">
          {strings.compare.selected}: {current}
        </Text>
      </View>
      <View className="mt-0.5 items-end">
        <DeltaText delta={delta} unit={unit} />
      </View>
    </View>
  );
}

function bestLine(previous: string, current: string): string {
  return `${strings.compare.previous} ${previous} → ${strings.compare.selected} ${current}`;
}

function ExerciseCard({ ex }: { ex: ExerciseComparison }) {
  const both = ex.present === 'both';
  const badge =
    ex.present === 'baseline'
      ? strings.compare.onlyPrevious
      : ex.present === 'current'
        ? strings.compare.onlySelected
        : null;
  const volumePrev = gramRepsToKgReps(ex.baseline.resistanceGramReps);
  const volumeCur = gramRepsToKgReps(ex.current.resistanceGramReps);
  return (
    <Card className="mb-2">
      <View className="flex-row items-center justify-between">
        <Text className="flex-1 text-heading text-fg" numberOfLines={1}>
          {ex.exerciseName}
        </Text>
        {badge ? <Badge label={badge} tone="neutral" /> : null}
      </View>
      <View className="mt-2">
        <Text className="text-overline uppercase text-dim">{strings.compare.volume}</Text>
        <Text className="mt-0.5 text-sm text-fg">
          {bestLine(`${volumePrev} ${strings.compare.kgRepsUnit}`, `${volumeCur} ${strings.compare.kgRepsUnit}`)}
        </Text>
        {both && ex.volumePercentChange !== null ? (
          <Text className="text-caption text-dim">
            {strings.compare.change}: {signed(ex.volumeDeltaGramReps / 1000)} {strings.compare.kgRepsUnit} ·{' '}
            {signed(ex.volumePercentChange)}%
          </Text>
        ) : null}
      </View>
      {ex.baseline.bestWeightGrams !== null || ex.current.bestWeightGrams !== null ? (
        <View className="mt-2">
          <Text className="text-overline uppercase text-dim">{strings.compare.bestWeight}</Text>
          <Text className="mt-0.5 text-sm text-fg">
            {bestLine(
              ex.baseline.bestWeightGrams === null ? '—' : `${ex.baseline.bestWeightGrams / 1000} kg`,
              ex.current.bestWeightGrams === null ? '—' : `${ex.current.bestWeightGrams / 1000} kg`,
            )}
          </Text>
        </View>
      ) : null}
      {ex.baseline.bestReps !== null || ex.current.bestReps !== null ? (
        <View className="mt-2">
          <Text className="text-overline uppercase text-dim">{strings.compare.bestReps}</Text>
          <Text className="mt-0.5 text-sm text-fg">
            {bestLine(
              ex.baseline.bestReps === null ? '—' : String(ex.baseline.bestReps),
              ex.current.bestReps === null ? '—' : String(ex.current.bestReps),
            )}
          </Text>
        </View>
      ) : null}
      {ex.baseline.estimated1rmGrams !== null || ex.current.estimated1rmGrams !== null ? (
        <View className="mt-2">
          <Text className="text-overline uppercase text-dim">{strings.compare.est1rm}</Text>
          <Text className="mt-0.5 text-sm text-fg">
            {bestLine(
              ex.baseline.estimated1rmGrams === null ? '—' : `${ex.baseline.estimated1rmGrams / 1000} kg`,
              ex.current.estimated1rmGrams === null ? '—' : `${ex.current.estimated1rmGrams / 1000} kg`,
            )}
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

export function CompareScreen({ sessionId }: { sessionId: string }) {
  const { pop } = useNav();
  const [sessions, setSessions] = useState<AnalyticsSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const comparison = useMemo<SessionComparison | null>(() => {
    const selected = sessions.find((s) => s.sessionId === sessionId);
    if (!selected) return null;
    const baseline = previousSessionBefore(sessions, selected.timestampMs);
    if (!baseline) return null;
    return compareSessions(baseline, selected);
  }, [sessions, sessionId]);

  const selectedFound = useMemo(() => sessions.some((s) => s.sessionId === sessionId), [sessions, sessionId]);

  if (loading) {
    return (
      <Screen>
        <AppHeader title={strings.compare.title} onBack={pop} />
        <LoadingState />
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen>
        <AppHeader title={strings.compare.title} onBack={pop} />
        <ErrorState message={error} onRetry={reload} />
      </Screen>
    );
  }

  if (!selectedFound) {
    return (
      <Screen>
        <AppHeader title={strings.compare.title} onBack={pop} />
        <ErrorState message={strings.history.detailMissing} onRetry={reload} />
      </Screen>
    );
  }

  if (!comparison) {
    return (
      <Screen>
        <AppHeader title={strings.compare.title} onBack={pop} />
        <View className="flex-1 items-center justify-center px-6">
          <EmptyState title={strings.compare.noBaseline} message={strings.compare.noBaselineBody} />
        </View>
      </Screen>
    );
  }

  const fmtVolume = (gramReps: number) => `${gramRepsToKgReps(gramReps)} ${strings.compare.kgRepsUnit}`;
  const fmtSets = (n: number) => String(n);
  const fmtTime = (ms: number) => `${Math.round(ms / 1000)} ${strings.compare.secondsUnit}`;

  return (
    <Screen>
      <AppHeader title={strings.compare.title} onBack={pop} />
      <Enter className="flex-1">
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View className="px-4 pt-4">
          <Card>
            <Text className="text-caption uppercase tracking-wider text-dim">
              {strings.compare.baseline}: {comparison.baselineRef.name} · {fmtDate(comparison.baselineRef.timestampMs)}
            </Text>
            <Text className="mt-1 text-caption uppercase tracking-wider text-accent-ink">
              {strings.compare.current}: {comparison.currentRef.name} · {fmtDate(comparison.currentRef.timestampMs)}
            </Text>
          </Card>

          <View className="mt-3">
            <SectionHeader title={strings.compare.totals} />
            <Card>
              <TotalRow
                label={strings.compare.volume}
                previous={fmtVolume(comparison.volume.previous)}
                current={fmtVolume(comparison.volume.current)}
                delta={comparison.volume.delta / 1000}
                unit={strings.compare.kgRepsUnit}
              />
              <TotalRow
                label={strings.compare.sets}
                previous={fmtSets(comparison.sets.previous)}
                current={fmtSets(comparison.sets.current)}
                delta={comparison.sets.delta}
                unit={strings.load.sets}
              />
              <TotalRow
                label={strings.compare.time}
                previous={fmtTime(comparison.duration.previous)}
                current={fmtTime(comparison.duration.current)}
                delta={Math.round(comparison.duration.delta / 1000)}
                unit={strings.compare.secondsUnit}
              />
            </Card>
          </View>

          <View className="mt-3">
            <SectionHeader title={strings.compare.exercises} />
            {comparison.exercises.length === 0 ? (
              <Card>
                <Text className="text-sm text-dim">{strings.compare.noPerExerciseLoad}</Text>
              </Card>
            ) : (
              comparison.exercises.map((ex) => <ExerciseCard key={ex.exerciseName} ex={ex} />)
            )}
          </View>
        </View>
      </ScrollView>
      </Enter>
    </Screen>
  );
}
