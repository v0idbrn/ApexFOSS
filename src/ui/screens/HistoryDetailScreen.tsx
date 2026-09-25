import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { database } from '../../data';
import { loadSessionDetail, type HistoryDetail } from '../../data/history';
import { saveSessionNote } from '../../data/notes';
import { strings } from '../../constants/strings';
import { formatKg } from '../../utils/units';
import { calculateSessionLoad, gramRepsToKgReps, msToSeconds } from '../../analytics/load';
import { useNav } from '../navigation';
import { AppHeader, Button, Card, ErrorState, LoadingState, Screen, SectionHeader, TextField } from '../components';
import { Enter } from '../motion';

function formatWhen(ts: number): string {
  try {
    return new Date(ts).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return new Date(ts).toISOString();
  }
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

function targetLine(s: {
  targetWeightGrams: number | null;
  targetRepsMin: number | null;
  targetRepsMax: number | null;
  targetDurationMs: number | null;
}): string {
  const parts: string[] = [];
  if (s.targetWeightGrams !== null) parts.push(`${formatKg(s.targetWeightGrams)} kg`);
  if (s.targetRepsMin !== null) {
    parts.push(
      s.targetRepsMax !== null && s.targetRepsMax !== s.targetRepsMin
        ? `${s.targetRepsMin}–${s.targetRepsMax} reps`
        : `${s.targetRepsMin} reps`,
    );
  }
  if (s.targetDurationMs !== null) parts.push(`${Math.round(s.targetDurationMs / 1000)} s`);
  return parts.join(' × ');
}

function actualLine(l: {
  weightGrams: number | null;
  reps: number | null;
  durationMs: number | null;
  rir: number | null;
}): string {
  const parts: string[] = [];
  if (l.weightGrams !== null) parts.push(`${formatKg(l.weightGrams)} kg`);
  if (l.reps !== null) parts.push(`${l.reps} reps`);
  if (l.durationMs !== null) parts.push(`${Math.round(l.durationMs / 1000)} s`);
  if (l.rir !== null) parts.push(`RIR ${l.rir}`);
  return parts.length > 0 ? parts.join(' × ') : strings.history.notLogged;
}

export function HistoryDetailScreen({ sessionId }: { sessionId: string }) {
  const { pop, push } = useNav();
  const [detail, setDetail] = useState<HistoryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await loadSessionDetail(database, sessionId);
      if (!d) {
        setError(strings.history.detailMissing);
        setDetail(null);
      } else {
        setDetail(d);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  // Session note editing — initialized from the loaded detail, independent of reloads.
  const [noteText, setNoteText] = useState('');
  const [noteSaved, setNoteSaved] = useState(false);
  useEffect(() => {
    if (!detail) return;
    setNoteText(detail.note ?? '');
    setNoteSaved(false);
  }, [detail]);

  const saveNote = useCallback(async () => {
    if (!detail) return;
    try {
      const value = await saveSessionNote(database, detail.id, noteText);
      setNoteText(value ?? '');
      setNoteSaved(true);
    } catch {
      setNoteSaved(false);
    }
  }, [detail, noteText]);

  const sessionLoad = useMemo(() => {
    if (!detail) return null;
    return calculateSessionLoad({
      sessionId: detail.id,
      name: detail.name,
      startedAt: detail.startedAt,
      endedAt: detail.endedAt,
      exercises: detail.blocks.map((block) => ({
        exerciseName: block.steps.map((s) => s.exerciseName).filter(Boolean).join(' / '),
        sets: block.steps.flatMap((step) =>
          step.logs.map((log) => ({
            weightGrams: log.weightGrams,
            reps: log.reps,
            durationMs: log.durationMs,
            isCompleted: true as const,
          })),
        ),
      })),
    });
  }, [detail]);

  if (loading) {
    return (
      <Screen>
        <AppHeader title={strings.history.detail} onBack={pop} />
        <LoadingState />
      </Screen>
    );
  }

  if (error || !detail) {
    return (
      <Screen>
        <AppHeader title={strings.history.detail} onBack={pop} />
        <ErrorState message={error ?? strings.history.detailMissing} onRetry={load} />
      </Screen>
    );
  }

  return (
    <Screen>
      <AppHeader title={detail.name} onBack={pop} />
      <Enter className="flex-1">
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View className="px-4 pt-4">
          <Card>
            <Text className="text-lg font-semibold text-fg">{detail.name}</Text>
            <Text className="mt-1 text-sm text-dim">
              {strings.history.completedAt}: {formatWhen(detail.endedAt ?? detail.startedAt)}
            </Text>
            <Text className="mt-0.5 text-sm text-dim">
              {strings.history.duration}: {formatDuration(detail.durationMs)}
            </Text>
            <Text className="mt-0.5 text-sm text-dim">
              {strings.history.sets}: {detail.totalCompletedSets}
            </Text>
          </Card>

          <Card className="mt-3">
            <TextField
              label={strings.notes.label}
              multiline
              numberOfLines={3}
              value={noteText}
              onChangeText={(t) => {
                setNoteText(t);
                setNoteSaved(false);
              }}
              placeholder={strings.notes.placeholder}
              textAlignVertical="top"
            />
            <Button
              label={strings.notes.save}
              variant="secondary"
              className="mt-2"
              onPress={() => void saveNote()}
            />
            {noteSaved ? (
              <Text className="mt-1.5 text-sm text-accent-ink">{strings.notes.saved}</Text>
            ) : null}
          </Card>

          {sessionLoad && sessionLoad.completedSetCount > 0 ? (
            <Card className="mt-3">
              <Text className="text-xs font-semibold uppercase tracking-wider text-dim">
                {strings.history.sessionLoad}
              </Text>
              <Text className="mt-2 text-lg font-bold text-fg">
                {gramRepsToKgReps(sessionLoad.resistanceGramReps)} {strings.load.kgReps}
              </Text>
              <Text className="mt-0.5 text-sm text-dim">
                {strings.history.resistanceLoad}: {sessionLoad.resistanceSetCount} {strings.load.sets}
              </Text>
              <Text className="mt-0.5 text-sm text-dim">
                {strings.history.durationWork}: {msToSeconds(sessionLoad.durationMs)} {strings.load.seconds} ·{' '}
                {sessionLoad.durationSetCount} {strings.load.sets}
              </Text>
            </Card>
          ) : null}

          <View className="mt-3">
            <Button
              label={strings.history.compare}
              variant="secondary"
              onPress={() => push({ name: 'compare', sessionId })}
            />
          </View>
        </View>

        {detail.blocks.map((block) => (
          <View key={`b${block.blockIndex}`} className="px-4 pt-4">
            <SectionHeader
              title={`${strings.workout.block} ${block.blockIndex + 1} · ${block.name}`}
              right={<Text className="text-xs text-dim">{block.kind.toUpperCase()}</Text>}
            />
            {block.steps.map((step) => {
              const target = targetLine(step);
              return (
                <Card key={`b${block.blockIndex}s${step.stepIndex}`} className="mb-2">
                  <Text className="text-base font-medium text-fg">{step.exerciseName || strings.common.none}</Text>
                  {target ? <Text className="mt-0.5 text-xs text-dim">{strings.workout.target}: {target}</Text> : null}
                  <Text className="mt-2 text-xs font-semibold uppercase tracking-wider text-dim">
                    {strings.history.actualPerformed}
                  </Text>
                  {step.logs.length === 0 ? (
                    <Text className="mt-1 text-sm text-dim">{strings.history.notLogged}</Text>
                  ) : (
                    step.logs.map((log, i) => (
                      <Text key={i} className="mt-1 font-mono text-sm text-fg">
                        {log.round > 1 || block.rounds > 1 ? `R${log.round} · ` : ''}
                        {actualLine(log)}
                      </Text>
                    ))
                  )}
                </Card>
              );
            })}
          </View>
        ))}
      </ScrollView>
      </Enter>
    </Screen>
  );
}
