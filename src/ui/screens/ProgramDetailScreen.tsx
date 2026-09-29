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
  Chip,
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
  mesocycleId: string | null;
}

interface MesocycleRow {
  id: string;
  name: string;
  sortOrder: number;
  routineCount: number;
  stage: string | null;
}

/**
 * Program detail (Phase 4A + 4B): rename, mesocycle phases (create / rename /
 * delete with staged routines preserved), member routines with per-routine
 * staging chips, add from unassigned routines, and delete program.
 * Delete operations detach — routines are never cascaded.
 */
export function ProgramDetailScreen({ programId }: { programId: string }) {
  const { pop, push } = useNav();
  const [program, setProgram] = useState<ProgramRow | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [members, setMembers] = useState<RoutineRow[]>([]);
  const [unassigned, setUnassigned] = useState<Array<{ id: string; name: string }>>([]);
  const [mesos, setMesos] = useState<MesocycleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [mesoName, setMesoName] = useState('');
  const [mesoError, setMesoError] = useState<string | null>(null);
  const [mesoDrafts, setMesoDrafts] = useState<Record<string, string>>({});

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
        setMesos([]);
        return;
      }
      setNotFound(false);
      setProgram(found);
      setName(found.name);
      const loadedMesos = await actions.listMesocycles(programId);
      setMesos(loadedMesos);
      setMesoDrafts(Object.fromEntries(loadedMesos.map((m) => [m.id, m.name])));
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

  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

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

  const createMesocycle = () => {
    const trimmed = mesoName.trim();
    if (!trimmed) {
      setMesoError(strings.programs.nameRequired);
      return;
    }
    void run(async () => {
      await makeDbActions(database).createMesocycle(programId, trimmed);
      setMesoName('');
    });
  };

  const saveMesocycle = (mesoId: string) => {
    const trimmed = (mesoDrafts[mesoId] ?? '').trim();
    if (!trimmed) {
      setMesoError(strings.programs.nameRequired);
      return;
    }
    void run(async () => {
      await makeDbActions(database).renameMesocycle(mesoId, trimmed);
    });
  };

  const setMesoStage = (mesoId: string, stage: 'normal' | 'deload' | null) => {
    void run(async () => {
      await makeDbActions(database).setMesocycleStage(mesoId, stage === 'normal' ? null : stage);
    });
  };

  const deleteMesocycle = (meso: MesocycleRow) => {
    confirmDestructive(strings.programs.deleteMesocycleConfirm, () => {
      void run(async () => {
        await makeDbActions(database).deleteMesocycle(meso.id);
      });
    });
  };

  const toggleStage = (row: RoutineRow, mesoId: string | null) => {
    void run(async () => {
      const actions = makeDbActions(database);
      if (mesoId == null) await actions.removeRoutineFromMesocycle(row.id);
      else if (row.mesocycleId === mesoId) await actions.removeRoutineFromMesocycle(row.id);
      else await actions.assignRoutineToMesocycle(row.id, mesoId);
    });
  };

  const assign = (routineId: string) =>
    run(() => makeDbActions(database).assignRoutineToProgram(routineId, programId));

  const removeMember = (row: RoutineRow) => {
    confirmDestructive(`${strings.programs.remove}?\n\n${row.name}`, () => {
      void run(() => makeDbActions(database).removeRoutineFromProgram(row.id));
    });
  };

  const removeProgram = () => {
    confirmDestructive(strings.programs.deleteConfirm, () => {
      void makeDbActions(database)
        .deleteProgram(programId)
        .then(pop)
        .catch((e) => setError(e instanceof Error ? e.message : String(e)));
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

              <SectionHeader title={strings.programs.mesocycles} />
              <Card testID="meso-create-card" className="mb-2">
                <TextField
                  label={strings.programs.mesocycleName}
                  value={mesoName}
                  onChangeText={(t) => {
                    setMesoName(t);
                    setMesoError(null);
                  }}
                  error={mesoError}
                  testID="meso-name-input"
                />
                <Button
                  label={strings.programs.createMesocycle}
                  onPress={createMesocycle}
                  disabled={loading}
                  className="mt-3"
                />
              </Card>
              {mesos.length === 0 ? (
                <Text className="text-sm text-dim">{strings.programs.noMesocycles}</Text>
              ) : (
                mesos.map((m) => (
                  <Card key={m.id} testID={`meso-card-${m.id}`} className="mb-2">
                    <TextField
                      label={`${strings.programs.renameMesocycle} · ${m.routineCount} ${strings.programs.routinesLabel}`}
                      value={mesoDrafts[m.id] ?? m.name}
                      onChangeText={(t) => setMesoDrafts((prev) => ({ ...prev, [m.id]: t }))}
                      testID={`meso-rename-input-${m.id}`}
                    />
                    <Text className="mb-2 mt-3 text-sm text-dim">{strings.programs.mesocycleStage}</Text>
                    <View className="flex-row flex-wrap gap-2">
                      <Chip
                        label={strings.programs.stageNormal}
                        active={(m.stage ?? 'normal') === 'normal'}
                        onPress={() => void setMesoStage(m.id, null)}
                      />
                      <Chip
                        label={strings.programs.stageDeload}
                        active={m.stage === 'deload'}
                        onPress={() => void setMesoStage(m.id, 'deload')}
                      />
                    </View>
                    <View className="mt-2 flex-row gap-2">
                      <View className="flex-1">
                        <Button
                          label={strings.common.save}
                          variant="secondary"
                          onPress={() => saveMesocycle(m.id)}
                        />
                      </View>
                      <View className="flex-1">
                        <Button
                          label={strings.programs.deleteMesocycle}
                          variant="danger"
                          onPress={() => deleteMesocycle(m)}
                        />
                      </View>
                    </View>
                  </Card>
                ))
              )}

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
                    {mesos.length > 0 ? (
                      <View className="mt-1 flex-row flex-wrap gap-2">
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`${row.name}: ${strings.programs.noStage}`}
                          accessibilityState={{ selected: row.mesocycleId === null }}
                          onPress={() => toggleStage(row, null)}
                          testID={`stage-none-${row.id}`}
                          className={`min-h-10 flex-row items-center rounded-lg border px-3 ${
                            row.mesocycleId === null ? 'border-accent bg-accent/10' : 'border-line bg-surface-2'
                          }`}
                        >
                          <Text
                            className={`text-sm ${
                              row.mesocycleId === null ? 'text-accent-ink' : 'text-dim'
                            }`}
                          >
                            {strings.programs.noStage}
                          </Text>
                        </Pressable>
                        {mesos.map((m) => {
                          const active = row.mesocycleId === m.id;
                          return (
                            <Pressable
                              key={m.id}
                              accessibilityRole="button"
                              accessibilityLabel={`${row.name}: ${m.name}`}
                              accessibilityState={{ selected: active }}
                              onPress={() => toggleStage(row, m.id)}
                              testID={`stage-${row.id}-${m.id}`}
                              className={`min-h-10 flex-row items-center rounded-lg border px-3 ${
                                active ? 'border-accent bg-accent/10' : 'border-line bg-surface-2'
                              }`}
                            >
                              <Text className={`text-sm ${active ? 'text-accent-ink' : 'text-dim'}`}>
                                {m.name}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    ) : null}
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
                        onPress={() => assign(row.id)}
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
