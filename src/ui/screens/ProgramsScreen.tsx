import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { strings } from '../../constants/strings';
import { database } from '../../data';
import { makeDbActions } from '../../data/actions';
import { useNav } from '../navigation';
import { AppHeader, Button, Card, EmptyState, ErrorState, LoadingState, Screen, TextField } from '../components';
import { Enter } from '../motion';

interface ProgramRow {
  id: string;
  name: string;
  routineCount: number;
}

/**
 * Programs list (Phase 4A): a named container of ordered routines.
 * Creation is an inline form (no Alert.prompt on Android); each row opens
 * ProgramDetailScreen for rename / membership management.
 */
export function ProgramsScreen() {
  const { pop, push } = useNav();
  const [programs, setPrograms] = useState<ProgramRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPrograms(await makeDbActions(database).listProgramsWithCounts());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError(strings.programs.nameRequired);
      return;
    }
    setCreating(true);
    setNameError(null);
    try {
      await makeDbActions(database).createProgram(trimmed);
      setName('');
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Screen>
      <AppHeader title={strings.programs.title} onBack={pop} />
      <Enter className="flex-1">
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
          <View className="px-4 pt-4">
            <Card testID="programs-create-card">
              <TextField
                label={strings.programs.name}
                value={name}
                onChangeText={(t) => {
                  setName(t);
                  setNameError(null);
                }}
                error={nameError}
                testID="programs-name-input"
              />
              <Button
                label={strings.programs.create}
                onPress={() => void create()}
                disabled={creating || loading}
                className="mt-3"
              />
            </Card>
          </View>

          <View className="px-4">
            {loading ? (
              <LoadingState />
            ) : error ? (
              <ErrorState message={error} onRetry={reload} />
            ) : programs.length === 0 ? (
              <EmptyState message={strings.programs.empty} />
            ) : (
              programs.map((p, index) => (
                <Enter key={p.id} delayMs={Math.min(index, 6) * 40}>
                  <Card testID={`program-card-${p.id}`} className="mt-3">
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${p.name}, ${p.routineCount} ${strings.programs.routinesLabel}`}
                      accessibilityState={{ disabled: false }}
                      onPress={() => push({ name: 'programDetail', programId: p.id })}
                      testID={`program-row-${p.id}`}
                      style={({ pressed }) => (pressed ? { opacity: 0.85 } : undefined)}
                      className="min-h-12 justify-center"
                    >
                      <Text numberOfLines={1} className="text-card-title text-fg">
                        {p.name}
                      </Text>
                      <Text numberOfLines={1} className="mt-1 text-label text-dim">
                        {`${p.routineCount} ${strings.programs.routinesLabel}`}
                      </Text>
                    </Pressable>
                  </Card>
                </Enter>
              ))
            )}
          </View>
        </ScrollView>
      </Enter>
    </Screen>
  );
}
