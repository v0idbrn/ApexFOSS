import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { Q } from '@nozbe/watermelondb';
import { database } from '../../data';
import { makeDbActions } from '../../data/actions';
import { MetricFlag, type ExerciseMeta } from '../../types';
import { strings } from '../../constants/strings';
import { useNav } from '../navigation';
import { AppHeader, EmptyState, ErrorState, HeaderButton, ListRow, LoadingState, Screen, TextField, confirmDestructive } from '../components';
import { Enter } from '../motion';

function metricSummary(flags: number): string {
  const parts: string[] = [];
  if (flags & MetricFlag.WEIGHT) parts.push(strings.exercises.metricWeight);
  if (flags & MetricFlag.REPS) parts.push(strings.exercises.metricReps);
  if (flags & MetricFlag.DURATION) parts.push(strings.exercises.metricDuration);
  if (flags & MetricFlag.DISTANCE) parts.push(strings.exercises.metricDistance);
  return parts.join(' · ');
}

export function ExerciseListScreen() {
  const { push, pop } = useNav();
  const [rows, setRows] = useState<ExerciseMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await database
        .get<any>('exercises')
        .query(Q.sortBy('name', 'asc'))
        .fetch();
      setRows(
        list.map((e: any) => ({
          id: e.id,
          name: e.name as string,
          category: e.category as string,
          equipment: e.equipment as string,
          metricFlags: e.metricFlags as number,
        })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, query]);

  const remove = (row: ExerciseMeta) => {
    confirmDestructive(`${strings.exercises.deleteConfirm}\n\n${row.name}`, async () => {
      try {
        await makeDbActions(database).deleteExercise(row.id);
        await reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  return (
    <Screen>
      <AppHeader
        title={strings.exercises.title}
        onBack={pop}
        right={<HeaderButton label={strings.exercises.newExercise} onPress={() => push({ name: 'exerciseEditor', exerciseId: null })} />}
      />
      <View className="px-4 pt-3">
        <TextField
          value={query}
          onChangeText={setQuery}
          placeholder={strings.exercises.search}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>
      <Enter className="flex-1">
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : rows.length === 0 ? (
        <EmptyState
          message={strings.exercises.empty}
          actionLabel={strings.exercises.newExercise}
          onAction={() => push({ name: 'exerciseEditor', exerciseId: null })}
        />
      ) : (
        <FlatList
          className="mt-3"
          data={filtered}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View className="items-center py-8">
              <Text className="text-dim">{strings.common.none}</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View className="flex-row items-stretch">
              <View className="flex-1">
                <ListRow
                  title={item.name}
                  subtitle={[item.category, item.equipment, metricSummary(item.metricFlags)]
                    .filter(Boolean)
                    .join(' · ')}
                  onPress={() => push({ name: 'exerciseEditor', exerciseId: item.id })}
                />
              </View>
              <View className="w-16 items-center justify-center">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${strings.common.delete} ${item.name}`}
                  onPress={() => remove(item)}
                  hitSlop={8}
                  className="h-12 w-12 items-center justify-center rounded-lg"
                >
                  <Text className="text-base text-danger">✕</Text>
                </Pressable>
              </View>
            </View>
          )}
        />
      )}
      </Enter>
    </Screen>
  );
}
