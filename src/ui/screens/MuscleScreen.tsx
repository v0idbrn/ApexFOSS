import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { database } from '../../data';
import { loadAnalyticsSnapshot, type AnalyticsSnapshot } from '../../data/analytics';
import { strings } from '../../constants/strings';
import {
  calculateMuscleHeatmap,
  type MuscleHeatmap,
  type MuscleId,
  type MuscleRegionLoad,
} from '../../analytics/muscles';
import { dateRange, gramRepsToKgReps, type DateRangeKind } from '../../analytics/load';
import { useNav } from '../navigation';
import { AppHeader, Card, EmptyState, ErrorState, LoadingState, Screen, SectionHeader } from '../components';
import { Enter } from '../motion';

const RANGES: DateRangeKind[] = ['7d', '28d'];

function rangeLabel(kind: DateRangeKind): string {
  return kind === '7d' ? strings.load.last7 : strings.load.last28;
}

function groupLabel(muscle: MuscleId): string {
  return strings.muscles.groups[muscle];
}

function percentLabel(shareBp: number): string {
  return `${(shareBp / 100).toFixed(1)}%`;
}

function unmappedNote(count: number): string {
  const noun = count === 1 ? strings.muscles.exerciseOne : strings.muscles.exerciseMany;
  return `${strings.muscles.unmappedFor} ${count} ${noun}`;
}

/**
 * Muscle distribution (Phase 2F): deterministic mapping → aggregated heat grid.
 * Structured region grid with load bars (no chart/SVG dependencies).
 * Timed work is excluded from volume; unknown exercises stay unmapped.
 */
export function MuscleScreen() {
  const { pop } = useNav();
  const [snapshot, setSnapshot] = useState<AnalyticsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<DateRangeKind>('7d');
  const [selected, setSelected] = useState<MuscleId | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await loadAnalyticsSnapshot(database));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const heatmap: MuscleHeatmap | null = useMemo(() => {
    if (!snapshot) return null;
    return calculateMuscleHeatmap(snapshot.sessions, dateRange(kind, Date.now()));
  }, [snapshot, kind]);

  if (loading) {
    return (
      <Screen>
        <AppHeader title={strings.muscles.title} onBack={pop} />
        <LoadingState />
      </Screen>
    );
  }

  if (error || !heatmap) {
    return (
      <Screen>
        <AppHeader title={strings.muscles.title} onBack={pop} />
        <ErrorState message={error ?? strings.common.error} onRetry={reload} />
      </Screen>
    );
  }

  const detail: MuscleRegionLoad | null =
    selected !== null ? heatmap.regions.find((region) => region.muscle === selected) ?? null : null;
  const empty = heatmap.totalResistanceGramReps === 0;

  return (
    <Screen>
      <AppHeader title={strings.muscles.title} onBack={pop} />
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
              {strings.muscles.mappedLoad}
            </Text>
            <Text className="mt-3 text-2xl font-bold text-fg">
              {gramRepsToKgReps(heatmap.mappedResistanceGramReps)} {strings.load.kgReps}
            </Text>
            <Text className="mt-1 text-sm text-dim">
              {strings.muscles.sessions}: {heatmap.sessionCount} · {strings.muscles.exercisesLabel}:{' '}
              {heatmap.mappedExerciseCount}/{heatmap.totalExerciseCount}
            </Text>
            {heatmap.unmappedExercises.length > 0 ? (
              <Text className="mt-0.5 text-sm text-dim">
                {unmappedNote(heatmap.unmappedExercises.length)}
              </Text>
            ) : null}
          </Card>
        </View>

        {empty || heatmap.regions.length === 0 ? (
          <View className="px-4 pt-6">
            <EmptyState message={strings.muscles.noData} />
          </View>
        ) : (
          <View className="px-4 pt-4">
            <SectionHeader title={strings.muscles.title} />
            <View className="flex-row flex-wrap justify-between gap-2">
              {heatmap.regions.map((region) => {
                const isSelected = selected === region.muscle;
                const sharePct = Math.max(0, Math.min(100, region.shareBp / 100));
                return (
                  <Pressable
                    key={region.muscle}
                    accessibilityRole="button"
                    accessibilityLabel={groupLabel(region.muscle)}
                    accessibilityState={{ selected: isSelected }}
                    onPress={() => setSelected(isSelected ? null : region.muscle)}
                    className={`w-[48%] rounded-xl border p-3 ${
                      isSelected ? 'border-accent bg-accent/10' : 'border-line bg-surface'
                    }`}
                  >
                    <Text className="text-sm font-semibold text-fg">{groupLabel(region.muscle)}</Text>
                    <View className="mt-1 flex-row items-baseline justify-between">
                      <Text className="text-lg font-bold text-fg">
                        {gramRepsToKgReps(region.resistanceGramReps)} {strings.load.kgReps}
                      </Text>
                      <Text className="text-xs text-dim">{percentLabel(region.shareBp)}</Text>
                    </View>
                    <View className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
                      <View className="h-1.5 rounded-full bg-accent" style={{ width: `${sharePct}%` }} />
                    </View>
                    <Text className="mt-1 text-xs text-dim">
                      {strings.muscles.sets}: {region.resistanceSetCount}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text className="mt-3 text-xs text-dim">{strings.muscles.detailHint}</Text>
          </View>
        )}

        {detail ? (
          <View className="px-4 pt-4">
            <Card>
              <Text className="text-lg font-semibold text-fg">{groupLabel(detail.muscle)}</Text>
              <Text className="mt-2 text-2xl font-bold text-fg">
                {gramRepsToKgReps(detail.resistanceGramReps)} {strings.load.kgReps}
              </Text>
              <Text className="mt-1 text-sm text-dim">
                {strings.muscles.share}: {percentLabel(detail.shareBp)} · {strings.muscles.sets}:{' '}
                {detail.resistanceSetCount}
              </Text>
              <Text className="mt-3 text-xs font-semibold uppercase tracking-wider text-dim">
                {strings.muscles.contributing}
              </Text>
              {detail.exercises.map((exercise) => (
                <View
                  key={exercise.exerciseName}
                  className="mt-1 flex-row items-center justify-between gap-2"
                >
                  <Text className="flex-1 text-sm text-fg" numberOfLines={1}>
                    {exercise.exerciseName}
                  </Text>
                  <Text className="text-sm text-dim">
                    {gramRepsToKgReps(exercise.resistanceGramReps)} {strings.load.kgReps}
                  </Text>
                </View>
              ))}
            </Card>
          </View>
        ) : null}
      </ScrollView>
      </Enter>
    </Screen>
  );
}
