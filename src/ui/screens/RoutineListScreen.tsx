import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { database } from '../../data';
import { makeDbActions } from '../../data/actions';
import { loadDashboard } from '../../data/dashboard';
import { definitionFromDraft } from '../../data/serialize';
import { checkIntegrity } from '../../engine/integrity';
import { startWorkoutSession } from '../../workout/runner';
import { reminderLabels, syncTrainingReminders } from '../../notifications/reminders';
import { useActiveSessionStore } from '../../state/activeSessionStore';
import { strings } from '../../constants/strings';
import type { BlockKind } from '../../types/engine';
import type { RoutineDraft } from '../../types/draft';
import { useNav } from '../navigation';
import {
  AppHeader,
  Badge,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  confirmDestructive,
} from '../components';
import { Enter } from '../motion';

interface RoutineRow {
  id: string;
  name: string;
  blockCount: number;
  stepCount: number;
}

/** Card model: list counts + everything derived from the routine draft / dashboard. */
interface RoutineCard extends RoutineRow {
  /** Distinct exercises across blocks — null when the draft could not be read. */
  exerciseCount: number | null;
  /** True when every integrity check passes for this routine. */
  integrityOk: boolean;
  /** True when another loaded routine shares this name (case-insensitive). */
  duplicate: boolean;
  blockKinds: BlockKind[];
  lastTrainedAt: number | null;
}

const CHECK_GLYPH = '✓';
const WARN_GLYPH = '⚠';

async function enrichRow(
  row: RoutineRow,
  duplicate: boolean,
  lastTrainedAt: number | null,
  drafts: Record<string, RoutineDraft>,
): Promise<RoutineCard> {
  try {
    const draft = await makeDbActions(database).loadRoutineDraft(row.id);
    drafts[row.id] = draft;
    const exercises = new Set<string>();
    for (const block of draft.blocks) {
      for (const step of block.steps) {
        const key = step.exerciseId || step.exerciseName;
        if (key) exercises.add(key);
      }
    }
    const issues = checkIntegrity(definitionFromDraft(draft));
    return {
      ...row,
      exerciseCount: exercises.size,
      integrityOk: issues.length === 0,
      duplicate,
      blockKinds: [...new Set(draft.blocks.map((b) => b.kind))],
      lastTrainedAt,
    };
  } catch {
    // Degrade to a warning state instead of blanking the list.
    return { ...row, exerciseCount: null, integrityOk: false, duplicate, blockKinds: [], lastTrainedAt };
  }
}

function CardAction({
  label,
  accessibilityLabel,
  onPress,
  testID,
  variant = 'secondary',
  disabled = false,
  className = '',
}: {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  testID: string;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  className?: string;
}) {
  const tones = {
    primary: 'border border-accent bg-accent',
    secondary: 'border border-line bg-surface-2',
    danger: 'border border-danger/60 bg-danger/10',
  } as const;
  const ink = {
    primary: 'text-fg font-semibold',
    secondary: 'text-fg',
    danger: 'text-danger font-semibold',
  } as const;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => (pressed ? { opacity: 0.85 } : undefined)}
      className={`min-h-12 flex-row items-center justify-center rounded-lg px-3 ${tones[variant]} ${
        disabled ? 'opacity-50' : ''
      } ${className}`}
    >
      <Text numberOfLines={1} className={`text-label ${ink[variant]}`}>
        {label}
      </Text>
    </Pressable>
  );
}

function RoutineCardView({
  card,
  starting,
  onOpen,
  onPreview,
  onStart,
  onDelete,
}: {
  card: RoutineCard;
  starting: boolean;
  onOpen: (card: RoutineCard) => void;
  onPreview: (card: RoutineCard) => void;
  onStart: (card: RoutineCard) => void;
  onDelete: (card: RoutineCard) => void;
}) {
  const name = card.name.trim() || strings.routines.untitledRoutine;
  const meta: string[] = [];
  if (card.exerciseCount != null) meta.push(`${strings.routines.exercises}: ${card.exerciseCount}`);
  meta.push(`${strings.routines.blocks}: ${card.blockCount}`);
  meta.push(`${strings.routines.steps}: ${card.stepCount}`);
  const okInk = card.integrityOk ? 'text-success' : 'text-warning';

  return (
    <Card testID={`routine-card-${card.id}`} className="mb-3">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${strings.common.edit} ${name}`}
        accessibilityState={{ disabled: false }}
        onPress={() => onOpen(card)}
        testID={`routine-open-${card.id}`}
        style={({ pressed }) => (pressed ? { opacity: 0.85 } : undefined)}
        className="min-h-12 justify-center"
      >
        <Text numberOfLines={1} className="text-card-title text-fg">
          {name}
        </Text>
        <Text numberOfLines={1} className="mt-1 text-label text-dim">
          {meta.join(' · ')}
        </Text>
        {card.lastTrainedAt != null ? (
          <Text numberOfLines={1} className="mt-0.5 text-caption text-muted">
            {`${strings.home.lastTrained}: ${new Date(card.lastTrainedAt).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
            })}`}
          </Text>
        ) : null}
      </Pressable>

      <View className="mt-2 flex-row flex-wrap items-center gap-2">
        <View
          testID={`routine-integrity-${card.id}`}
          className="flex-row items-center gap-1 rounded-full border border-line bg-surface-2 px-2.5 py-1"
        >
          <Text className={`text-caption ${okInk}`}>{card.integrityOk ? CHECK_GLYPH : WARN_GLYPH}</Text>
          <Text className={`text-label ${okInk}`}>
            {card.integrityOk ? strings.routines.integrityOk : strings.integrity.warning}
          </Text>
        </View>
        {card.duplicate ? (
          <Badge label={strings.routines.duplicate} testID={`routine-duplicate-${card.id}`} />
        ) : null}
        {card.blockKinds.map((kind) => (
          <Badge
            key={kind}
            label={strings.routines.blockKind[kind]}
            testID={`routine-kind-${card.id}-${kind}`}
          />
        ))}
      </View>

      <View className="mt-3 flex-row gap-2">
        <CardAction
          className="flex-1"
          label={strings.routines.previewAction}
          accessibilityLabel={`${strings.routines.previewAction} ${name}`}
          testID={`routine-preview-${card.id}`}
          onPress={() => onPreview(card)}
        />
        <CardAction
          className="flex-1"
          variant="primary"
          label={strings.routines.start}
          accessibilityLabel={`${strings.routines.start} ${name}`}
          testID={`routine-start-${card.id}`}
          disabled={starting}
          onPress={() => onStart(card)}
        />
      </View>
      <View className="mt-2 flex-row gap-2">
        <CardAction
          className="flex-1"
          label={strings.common.edit}
          accessibilityLabel={`${strings.common.edit} ${name}`}
          testID={`routine-edit-${card.id}`}
          onPress={() => onOpen(card)}
        />
        <CardAction
          className="flex-1"
          variant="danger"
          label={strings.common.delete}
          accessibilityLabel={`${strings.common.delete} ${name}`}
          testID={`routine-delete-${card.id}`}
          onPress={() => onDelete(card)}
        />
      </View>
    </Card>
  );
}

/**
 * Routines list (Phase 2L STAGE F): rich cards with counts, integrity and
 * duplicate badges, plus per-card preview / start / edit / delete actions.
 * Data logic (load, start, delete) is unchanged from the previous version —
 * the draft is only read to enrich the presentation.
 */
export function RoutineListScreen() {
  const { push, pop, depth } = useNav();
  const [cards, setCards] = useState<RoutineCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const drafts = useRef<Record<string, RoutineDraft>>({});
  const setSession = useActiveSessionStore((s) => s.setSession);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await makeDbActions(database).listRoutinesWithCounts();
      let lastTrained: { id: string; at: number } | null = null;
      try {
        const dash = await loadDashboard(database, Date.now());
        lastTrained = dash.lastRoutine
          ? { id: dash.lastRoutine.id, at: dash.lastRoutine.lastTrainedAt }
          : null;
      } catch {
        lastTrained = null;
      }
      const nameCounts = new Map<string, number>();
      for (const row of rows) {
        const key = row.name.trim().toLowerCase();
        nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
      }
      setCards(
        await Promise.all(
          rows.map((row) =>
            enrichRow(
              row,
              (nameCounts.get(row.name.trim().toLowerCase()) ?? 0) > 1,
              lastTrained && lastTrained.id === row.id ? lastTrained.at : null,
              drafts.current,
            ),
          ),
        ),
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

  const remove = (row: RoutineRow) => {
    confirmDestructive(`${strings.routines.deleteConfirm}\n\n${row.name}`, async () => {
      try {
        delete drafts.current[row.id];
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
    setStartingId(row.id);
    try {
      const sessionId = await startWorkoutSession(database, row.id);
      setSession(sessionId, row.name);
      void syncTrainingReminders(database, reminderLabels());
      push({ name: 'workout' });
    } catch (e) {
      setError(e instanceof Error ? e.message : strings.workout.startFailed);
    } finally {
      setStartingId(null);
    }
  };

  const preview = async (row: RoutineRow) => {
    try {
      const draft = drafts.current[row.id] ?? (await makeDbActions(database).loadRoutineDraft(row.id));
      drafts.current[row.id] = draft;
      push({ name: 'routinePreview', draft });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Screen>
      <AppHeader
        title={strings.routines.title}
        onBack={depth > 1 ? pop : undefined}
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={strings.routines.newRoutine}
            accessibilityState={{ disabled: false }}
            onPress={() => push({ name: 'routineEditor', routineId: null })}
            testID="routines-new"
            style={({ pressed }) => (pressed ? { opacity: 0.85 } : undefined)}
            className="min-h-12 min-w-12 items-center justify-center rounded-lg px-3"
          >
            <Text className="text-base font-semibold text-accent-ink">{strings.routines.newRoutine}</Text>
          </Pressable>
        }
      />
      <Enter className="flex-1">
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : (
        <FlatList
          data={cards}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32 }}
          ListHeaderComponent={
            <View>
              <Card testID="programs-entry" className="mb-3">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${strings.programs.title}. ${strings.programs.subtitle}`}
                  accessibilityState={{ disabled: false }}
                  onPress={() => push({ name: 'programs' })}
                  testID="programs-entry-open"
                  style={({ pressed }) => (pressed ? { opacity: 0.85 } : undefined)}
                  className="min-h-12 justify-center"
                >
                  <Text numberOfLines={1} className="text-card-title text-fg">
                    {strings.programs.title}
                  </Text>
                  <Text numberOfLines={1} className="mt-1 text-label text-dim">
                    {strings.programs.subtitle}
                  </Text>
                </Pressable>
              </Card>
              <Card testID="templates-entry" className="mb-3">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${strings.templates.title}. ${strings.templates.subtitle}`}
                  accessibilityState={{ disabled: false }}
                  onPress={() => push({ name: 'templates' })}
                  testID="templates-entry-open"
                  style={({ pressed }) => (pressed ? { opacity: 0.85 } : undefined)}
                  className="min-h-12 justify-center"
                >
                  <Text numberOfLines={1} className="text-card-title text-fg">
                    {strings.templates.title}
                  </Text>
                  <Text numberOfLines={1} className="mt-1 text-label text-dim">
                    {strings.templates.subtitle}
                  </Text>
                </Pressable>
              </Card>
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              message={strings.routines.empty}
              actionLabel={strings.routines.emptyAction}
              onAction={() => push({ name: 'routineEditor', routineId: null })}
            />
          }
          renderItem={({ item, index }) => (
            <Enter delayMs={Math.min(index, 6) * 40}>
              <RoutineCardView
                card={item}
                starting={startingId === item.id}
                onOpen={(c) => push({ name: 'routineEditor', routineId: c.id })}
                onPreview={(c) => void preview(c)}
                onStart={(c) => void start(c)}
                onDelete={remove}
              />
            </Enter>
          )}
        />
      )}
      </Enter>
    </Screen>
  );
}
