import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Q } from '@nozbe/watermelondb';
import { database } from '../../data';
import { strings } from '../../constants/strings';
import { useNav } from '../navigation';
import { EmptyState, ErrorState, ListRow, LoadingState, TextField } from '../components';

interface Option {
  id: string;
  name: string;
  category: string;
}

/** Full-screen exercise selector: search → list → pick. Does not create exercises. */
export function ExercisePickerScreen({
  onPick,
  onCancel,
}: {
  onPick: (exerciseId: string, exerciseName: string) => void;
  onCancel: () => void;
}) {
  const { push } = useNav();
  const [rows, setRows] = useState<Option[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await database.get<any>('exercises').query(Q.sortBy('name', 'asc')).fetch();
      setRows(list.map((e: any) => ({ id: e.id, name: e.name as string, category: e.category as string })));
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

  return (
    <Modal visible animationType="slide" onRequestClose={onCancel} presentationStyle="fullScreen">
      <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-bg">
        <View className="h-14 min-h-14 flex-row items-center border-b border-line px-1">
          <Text accessibilityRole="header" className="flex-1 px-3 text-lg font-semibold text-fg">
            {strings.exercises.selectTitle}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={strings.common.cancel}
            onPress={onCancel}
            hitSlop={8}
            style={({ pressed }) => (pressed ? { opacity: 0.7 } : undefined)}
            className="h-12 min-h-12 min-w-12 items-center justify-center px-4"
          >
            <Text className="text-base text-accent-ink">{strings.common.cancel}</Text>
          </Pressable>
        </View>
        <View className="px-4 pt-3">
          <TextField
            value={query}
            onChangeText={setQuery}
            accessibilityLabel={strings.exercises.search}
            placeholder={strings.exercises.search}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
        </View>
        {loading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : rows.length === 0 ? (
          // Nothing exists to search yet, so the search field cannot be the
          // next step — the empty state carries the documented follow-up.
          <EmptyState
            message={strings.exercises.selectEmpty}
            actionLabel={strings.exercises.emptyAction}
            onAction={() => {
              onCancel();
              push({ name: 'exerciseEditor', exerciseId: null });
            }}
          />
        ) : (
          <FlatList
            className="mt-3"
            data={filtered}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              // A query with no hits: refining it in the search field above is
              // the next step, so this state deliberately offers no action.
              <EmptyState message={strings.common.noMatches} />
            }
            renderItem={({ item }) => (
              <View className="bg-surface">
                <ListRow
                  title={item.name}
                  subtitle={item.category}
                  onPress={() => onPick(item.id, item.name)}
                  right={<Text className="text-base text-accent-ink">{strings.common.add}</Text>}
                />
              </View>
            )}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}
