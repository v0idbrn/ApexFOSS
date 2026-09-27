import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { strings } from '../../constants/strings';
import { database } from '../../data';
import { makeDbActions } from '../../data/actions';
import { useNav } from '../navigation';
import {
  AppHeader,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  SectionHeader,
  TextField,
  confirmDestructive,
} from '../components';
import { Enter } from '../motion';

interface ProgramRow {
  id: string;
  name: string;
  routineCount: number;
}

interface RoutineRow {
  id: string;
  name: string;
}

/**
 * Program detail (Phase 4A): rename, ordered member routines (tap opens the
 * routine editor), remove, add from unassigned routines, and delete program
 * (detaches — routines are never cascaded).
 */
export function ProgramDetailScreen({ programId }: { programId: string }) {
  const { pop, push } = useNav();
  const [program, setProgram] = useState<ProgramRow | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [members, setMembers] = useState<RoutineRow[]>([]);
  const [unassigned, setUnassigned] = useState<RoutineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const actions = makeDbActions(database);
      const all = await actions.listProgramsWithCounts();
      const found = all.find((p) => p.id === programId) ?? null;
      if (!found) {
        setNotFound(true);
        setProgram(null);
        setMembers([]);
        setUnassigned([]);
        return;
      }
      setNotFound(false);
      setProgram(found);
      setName(found.name);
      setMembers(await actions.listProgramRoutines(programId));
      setUnassigned(await actions.listUnassignedRoutines());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [programId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const saveName = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError(strings.programs.nameRequired);
      return;
    }
    setSavingName(true);
    setNameError(null);
    try {
      await makeDbActions(database).renameProgram(programId, trimmed);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingName(false);
    }
  };

  const assign = async (routineId: string) => {
    try {
      await makeDbActions(database).assignRoutineToProgram(routineId, programId);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const removeMember = (row: RoutineRow) => {
    confirmDestructive(`${strings.programs.remove}?\n\n${row.name}`, () => {
      void (async () => {
        try {
          await makeDbActions(database).removeRoutineFromProgram(row.id);
          await reload();
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      })();
    });
  };

  const removeProgram = () => {
    confirmDestructive(strings.programs.deleteConfirm, () => {
      void (async () => {
        try {
          await makeDbActions(database).deleteProgram(programId);
          pop();
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      })();
    });
  };

  return (
    <Screen>
      <AppHeader title={program?.name ?? strings.programs.title} onBack={pop} />
      <Enter className="flex-1">
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
          {loading ? (
            <LoadingState />
          ) : notFound ? (
            <EmptyState message={strings.programs.notFound} />
          ) : error ? (
            <ErrorState message={error} onRetry={reload} />
          ) : (
            <View className="px-4 pt-4">
              <Card testID="program-rename-card">
                <TextField
                  label={strings.programs.rename}
                  value={name}
                  onChangeText={(t) => {
                    setName(t);
                    setNameError(null);
                  }}
                  error={nameError}
                  testID="program-rename-input"
                />
                <Button
                  label={strings.common.save}
                  onPress={() => void saveName()}
                  disabled={savingName}
                  className="mt-3"
                />
              </Card>

              <SectionHeader title={strings.programs.members} />
              {members.length === 0 ? (
                <Text className="text-sm text-dim">{strings.programs.noMembers}</Text>
              ) : (
                members.map((row) => (
                  <Card key={row.id} testID={`program-member-${row.id}`} className="mb-2">
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${strings.common.edit} ${row.name}`}
                      accessibilityState={{ disabled: false }}
                      onPress={() => push({ name: 'routineEditor', routineId: row.id })}
                      testID={`program-member-open-${row.id}`}
                      style={({ pressed }) => (pressed ? { opacity: 0.85 } : undefined)}
                      className="min-h-12 justify-center"
                    >
                      <Text numberOfLines={1} className="text-card-title text-fg">
                        {row.name}
                      </Text>
                    </Pressable>
                    <Button
                      label={strings.programs.remove}
                      variant="secondary"
                      onPress={() => removeMember(row)}
                      className="mt-2"
                    />
                  </Card>
                ))
              )}

              <SectionHeader title={strings.programs.addRoutine} />
              {unassigned.length === 0 ? (
                <Text className="text-sm text-dim">{strings.programs.noUnassigned}</Text>
              ) : (
                unassigned.map((row) => (
                  <Card key={row.id} testID={`program-candidate-${row.id}`} className="mb-2">
                    <View className="flex-row items-center gap-2">
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${row.name}`}
                        accessibilityState={{ disabled: false }}
                        onPress={() => push({ name: 'routineEditor', routineId: row.id })}
                        testID={`program-candidate-open-${row.id}`}
                        style={({ pressed }) => (pressed ? { opacity: 0.85 } : undefined)}
                        className="min-h-12 flex-1 justify-center"
                      >
                        <Text numberOfLines={1} className="text-card-title text-fg">
                          {row.name}
                        </Text>
                      </Pressable>
                      <Button
                        label={strings.programs.addRoutine}
                        variant="primary"
                        onPress={() => void assign(row.id)}
                      />
                    </View>
                  </Card>
                ))
              )}

              <View className="mt-6">
                <Button label={strings.programs.delete} variant="danger" onPress={removeProgram} />
              </View>
            </View>
          )}
        </ScrollView>
      </Enter>
    </Screen>
  );
}
