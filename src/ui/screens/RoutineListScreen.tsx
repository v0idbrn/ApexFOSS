import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { database } from '../../data';
import { makeDbActions } from '../../data/actions';
import { startWorkoutSession } from '../../workout/runner';
import { useActiveSessionStore } from '../../state/activeSessionStore';
import { strings } from '../../constants/strings';
import { useNav } from '../navigation';
import { AppHeader, EmptyState, ErrorState, HeaderButton, ListRow, LoadingState, Screen, confirmDestructive } from '../components';

interface RoutineRow {
  id: string;
  name: string;
  blockCount: number;
  stepCount: number;
}

export function RoutineListScreen() {
  const { push, pop } = useNav();
  const [rows, setRows] = useState<RoutineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const setSession = useActiveSessionStore((s) => s.setSession);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await makeDbActions(database).listRoutinesWithCounts());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const remove = (row: RoutineRow) => {
    confirmDestructive(`${strings.routines.deleteConfirm}\n\n${row.name}`, async () => {
      try {
        await makeDbActions(database).deleteRoutine(row.id);
        await reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  const start = async (row: RoutineRow) => {
    try {
      const active = await makeDbActions(database).getActiveSession();
      if (active) {
        Alert.alert(strings.workout.start, strings.workout.activeConflict, [
          { text: strings.common.cancel, style: 'cancel' },
          {
            text: strings.routines.start,
            onPress: () => {
              void startAndNavigate(row);
            },
          },
        ]);
        return;
      }
      await startAndNavigate(row);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const startAndNavigate = async (row: RoutineRow) => {
    try {
      const sessionId = await startWorkoutSession(database, row.id);
      setSession(sessionId, row.name);
      push({ name: 'workout' });
    } catch (e) {
      setError(e instanceof Error ? e.message : strings.workout.startFailed);
    }
  };

  return (
    <Screen>
      <AppHeader
        title={strings.routines.title}
        onBack={pop}
        right={<HeaderButton label={strings.routines.newRoutine} onPress={() => push({ name: 'routineEditor', routineId: null })} />}
      />
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : rows.length === 0 ? (
        <EmptyState
          message={strings.routines.empty}
          actionLabel={strings.routines.emptyAction}
          onAction={() => push({ name: 'routineEditor', routineId: null })}
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <View className="flex-row items-stretch">
              <View className="flex-1">
                <ListRow
                  title={item.name}
                  subtitle={`${item.blockCount} ${strings.routines.blocks.toLowerCase()} · ${item.stepCount} ${strings.routines.steps.toLowerCase()}`}
                  onPress={() => push({ name: 'routineEditor', routineId: item.id })}
                />
              </View>
              <View className="w-14 items-center justify-center">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${strings.routines.start} ${item.name}`}
                  onPress={() => void start(item)}
                  hitSlop={8}
                  className="h-12 w-12 items-center justify-center rounded-lg"
                >
                  <Text className="text-base text-accent-ink">▶</Text>
                </Pressable>
              </View>
              <View className="w-14 items-center justify-center">
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
    </Screen>
  );
}
