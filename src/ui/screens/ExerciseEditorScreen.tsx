import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { database } from '../../data';
import { makeDbActions } from '../../data/actions';
import { muscleCatalog } from '../../data/analytics';
import { resolveContributions } from '../../analytics/muscles';
import { MetricFlag } from '../../types';
import { strings } from '../../constants/strings';
import type { SubstitutionExercise } from '../../analytics/substitutions';
import { useNav } from '../navigation';
import { SubstitutionList } from '../SubstitutionList';
import {
  AppHeader,
  Button,
  Chip,
  ErrorState,
  LoadingState,
  Screen,
  SectionHeader,
  TextField,
  confirmDestructive,
} from '../components';

interface FormState {
  name: string;
  category: string;
  equipment: string;
  metricFlags: number;
}

const emptyForm: FormState = { name: '', category: '', equipment: '', metricFlags: MetricFlag.WEIGHT | MetricFlag.REPS };

export function ExerciseEditorScreen({ exerciseId }: { exerciseId: string | null }) {
  const { pop } = useNav();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [loading, setLoading] = useState(exerciseId !== null);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [candidates, setCandidates] = useState<SubstitutionExercise[]>([]);

  const toSubstitution = useCallback((row: any): SubstitutionExercise => {
    const catalog = muscleCatalog();
    const metricFlags = typeof row.metricFlags === 'number' ? row.metricFlags : 0;
    return {
      id: row.id ?? null,
      name: row.name ?? '',
      category: row.category ?? '',
      equipment: row.equipment ?? '',
      metricFlags,
      contributions: resolveContributions(catalog, {
        id: row.id ?? null,
        name: row.name ?? '',
        category: row.category ?? '',
        equipment: row.equipment ?? '',
        metricFlags,
      }),
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await makeDbActions(database).listExercises();
        if (cancelled) return;
        setCandidates(rows.map((row: any) => toSubstitution(row)));
      } catch {
        if (!cancelled) setCandidates([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [toSubstitution]);

  const target = useMemo<SubstitutionExercise>(
    () => ({
      id: exerciseId,
      name: form.name.trim(),
      category: form.category.trim(),
      equipment: form.equipment.trim(),
      metricFlags: form.metricFlags,
      contributions: resolveContributions(muscleCatalog(), {
        id: exerciseId,
        name: form.name.trim(),
        category: form.category.trim(),
        equipment: form.equipment.trim(),
        metricFlags: form.metricFlags,
      }),
    }),
    [exerciseId, form],
  );

  const load = useCallback(async () => {
    if (!exerciseId) return;
    setLoading(true);
    setError(null);
    try {
      const ex = await database.get<any>('exercises').find(exerciseId);
      setForm({
        name: ex.name ?? '',
        category: ex.category ?? '',
        equipment: ex.equipment ?? '',
        metricFlags: typeof ex.metricFlags === 'number' ? ex.metricFlags : 0,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [exerciseId]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    const name = form.name.trim();
    if (!name) {
      setNameError(strings.exercises.nameRequired);
      return;
    }
    setNameError(null);
    setSaving(true);
    setError(null);
    try {
      const actions = makeDbActions(database);
      const payload = { name, category: form.category.trim(), equipment: form.equipment.trim(), metricFlags: form.metricFlags };
      if (exerciseId) await actions.updateExercise(exerciseId, payload);
      else await actions.createExercise(payload);
      pop();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const toggleMetric = (flag: number) =>
    setForm((f) => ({ ...f, metricFlags: f.metricFlags ^ flag }));

  const remove = () => {
    if (!exerciseId) return;
    confirmDestructive(`${strings.exercises.deleteConfirm}\n\n${form.name}`, async () => {
      try {
        await makeDbActions(database).deleteExercise(exerciseId);
        pop();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  return (
    <Screen>
      <AppHeader
        title={exerciseId ? strings.exercises.editTitle : strings.exercises.newExercise}
        onBack={pop}
      />
      {loading ? (
        <LoadingState />
      ) : error && !saving ? (
        <ErrorState message={error} onRetry={load} />
      ) : (
        <ScrollView contentContainerClassName="gap-4 p-4 pb-10" keyboardShouldPersistTaps="handled">
          {error ? <Text className="text-sm text-danger">{error}</Text> : null}
          <TextField
            label={strings.exercises.name}
            value={form.name}
            onChangeText={(t) => {
              setForm((f) => ({ ...f, name: t }));
              if (nameError && t.trim()) setNameError(null);
            }}
            error={nameError}
            placeholder={strings.exercises.namePlaceholder}
            autoCapitalize="words"
          />
          <TextField
            label={strings.exercises.category}
            value={form.category}
            onChangeText={(t) => setForm((f) => ({ ...f, category: t }))}
            placeholder={strings.exercises.categoryPlaceholder}
          />
          <TextField
            label={strings.exercises.equipment}
            value={form.equipment}
            onChangeText={(t) => setForm((f) => ({ ...f, equipment: t }))}
            placeholder={strings.exercises.equipmentPlaceholder}
          />
          <View>
            <Text className="mb-2 text-sm text-dim">{strings.exercises.metrics}</Text>
            <View className="flex-row flex-wrap gap-2">
              <Chip label={strings.exercises.metricWeight} active={!!(form.metricFlags & MetricFlag.WEIGHT)} onPress={() => toggleMetric(MetricFlag.WEIGHT)} />
              <Chip label={strings.exercises.metricReps} active={!!(form.metricFlags & MetricFlag.REPS)} onPress={() => toggleMetric(MetricFlag.REPS)} />
              <Chip label={strings.exercises.metricDuration} active={!!(form.metricFlags & MetricFlag.DURATION)} onPress={() => toggleMetric(MetricFlag.DURATION)} />
              <Chip label={strings.exercises.metricDistance} active={!!(form.metricFlags & MetricFlag.DISTANCE)} onPress={() => toggleMetric(MetricFlag.DISTANCE)} />
            </View>
          </View>
          {form.name.trim() ? (
            <View>
              <SectionHeader title={strings.substitutions.title} />
              <Text className="mb-2 text-caption text-dim">{strings.substitutions.note}</Text>
              <SubstitutionList target={target} candidates={candidates} />
            </View>
          ) : null}
          <Button label={saving ? '…' : strings.common.save} onPress={save} disabled={saving} />
          {exerciseId ? (
            <View className="mt-4">
              <Button label={strings.common.delete} variant="danger" onPress={remove} />
            </View>
          ) : null}
        </ScrollView>
      )}
    </Screen>
  );
}
