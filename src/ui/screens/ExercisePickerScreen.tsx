import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Modal, Text, View } from 'react-native';
import { Q } from '@nozbe/watermelondb';
import { database } from '../../data';
import { strings } from '../../constants/strings';
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
      <View className="flex-1 bg-bg pt-10">
        <View className="h-14 min-h-14 flex-row items-center border-b border-line px-1">
          <Text className="flex-1 px-3 text-lg font-semibold text-fg">{strings.exercises.selectTitle}</Text>
          <Text
            accessibilityRole="button"
            accessibilityLabel={strings.common.cancel}
            onPress={onCancel}
            className="h-12 min-h-12 flex-row items-center px-4 text-base text-accent"
          >
            {strings.common.cancel}
          </Text>
        </View>
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
        {loading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : rows.length === 0 ? (
          <EmptyState message={strings.exercises.selectEmpty} />
        ) : (
          <FlatList
            className="mt-3"
            data={filtered}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <View className="items-center py-8">
                <Text className="text-dim">{strings.common.noMatches}</Text>
              </View>
            }
            renderItem={({ item }) => (
              <ListRow
                title={item.name}
                subtitle={item.category}
                onPress={() => onPick(item.id, item.name)}
                right={<Text className="text-base text-accent">{strings.common.add}</Text>}
              />
            )}
          />
        )}
      </View>
    </Modal>
  );
}
