import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { database } from '../data';
import { makeDbActions } from '../data/actions';
import { loadGoals, type GoalWithProgress } from '../data/goals';
import { strings } from '../constants/strings';
import { formatKg, kgToGrams } from '../utils/units';
import {
  Button,
  Card,
  EmptyState,
  IconButton,
  ListRow,
  NumberField,
  SectionHeader,
  confirmDestructive,
} from './components';
import { useNav } from './navigation';
import { ExercisePickerScreen } from './screens/ExercisePickerScreen';

/**
 * Phase 4D: strength goals section — athlete picks an exercise and a target
 * e1RM; progress is derived from history (pure evaluateGoal), never stored.
 */
export function GoalSection() {
  const { push } = useNav();
  const [goals, setGoals] = useState<GoalWithProgress[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [pending, setPending] = useState<{ exerciseId: string; exerciseName: string } | null>(null);
  const [kg, setKg] = useState<number | null>(null);
  const [targetError, setTargetError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      setGoals(await loadGoals(database));
    } catch {
      setGoals([]);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = async () => {
    if (!pending) return;
    if (kg === null || !Number.isFinite(kg) || kg <= 0) {
      setTargetError(strings.goals.targetRequired);
      return;
    }
    setBusy(true);
    setTargetError(null);
    setSaveError(null);
    try {
      await makeDbActions(database).createGoal(pending.exerciseId, kgToGrams(kg));
      setPending(null);
      setKg(null);
      await reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSaveError(msg.includes('already has') ? strings.goals.exists : msg);
    } finally {
      setBusy(false);
    }
  };

  const remove = (goal: GoalWithProgress) => {
    confirmDestructive(strings.goals.deleteConfirm, () => {
      void makeDbActions(database)
        .deleteGoal(goal.id)
        .then(reload);
    });
  };

  const subtitle = (goal: GoalWithProgress): string => {
    if (goal.currentGrams === null) {
      return `${formatKg(goal.targetGrams)} kg · ${strings.goals.noData}`;
    }
    const pct = Math.round((goal.progress ?? 0) * 100);
    const base = `${formatKg(goal.currentGrams)} / ${formatKg(goal.targetGrams)} kg · ${pct}%`;
    return goal.achieved ? `${base} · ${strings.goals.achieved}` : base;
  };

  if (goals === null) return null;

  return (
    <View>
      <SectionHeader
        title={strings.goals.title}
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={strings.goals.add}
            onPress={() => setPicking(true)}
            testID="goals-add"
            hitSlop={8}
          >
            <Text className="text-caption font-semibold text-accent-ink">{strings.goals.add}</Text>
          </Pressable>
        }
      />

      {pending ? (
        <Card testID="goals-form">
          <Text accessibilityLabel={pending.exerciseName} className="text-card-title text-fg">
            {pending.exerciseName}
          </Text>
          <View className="mt-3">
            <NumberField label={strings.goals.targetKg} value={kg} onChange={setKg} suffix="kg" />
          </View>
          {targetError ? (
            <Text accessibilityRole="alert" className="mt-1 text-caption text-danger">
              {targetError}
            </Text>
          ) : null}
          {saveError ? (
            <Text accessibilityRole="alert" className="mt-1 text-caption text-danger">
              {saveError}
            </Text>
          ) : null}
          <View className="mt-3 flex-row gap-2">
            <Button
              label={strings.goals.add}
              onPress={() => void save()}
              disabled={busy}
              className="flex-1"
            />
            <Button
              label={strings.common.cancel}
              variant="secondary"
              onPress={() => {
                setPending(null);
                setKg(null);
                setTargetError(null);
                setSaveError(null);
              }}
              className="flex-1"
            />
          </View>
        </Card>
      ) : null}

      {goals.length === 0 ? (
        <EmptyState message={strings.goals.emptyBody} />
      ) : (
        <View className="overflow-hidden rounded-xl border border-line bg-surface">
          {goals.map((goal) => (
            <ListRow
              key={goal.id}
              title={goal.exerciseName}
              subtitle={subtitle(goal)}
              testID={`goal-row-${goal.id}`}
              onPress={() => push({ name: 'exerciseEditor', exerciseId: goal.exerciseId })}
              right={
                <IconButton
                  label={strings.goals.delete}
                  glyph="×"
                  variant="danger"
                  testID={`goal-delete-${goal.id}`}
                  onPress={() => remove(goal)}
                />
              }
            />
          ))}
        </View>
      )}

      {picking ? (
        <ExercisePickerScreen
          onPick={(exerciseId, exerciseName) => {
            setPicking(false);
            setPending({ exerciseId, exerciseName });
            setKg(null);
            setTargetError(null);
            setSaveError(null);
          }}
          onCancel={() => setPicking(false)}
        />
      ) : null}
    </View>
  );
}
