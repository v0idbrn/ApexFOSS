import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { database } from '../../data';
import { makeDbActions } from '../../data/actions';
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
    </Screen>
  );
}
