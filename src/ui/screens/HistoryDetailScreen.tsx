import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { database } from '../../data';
import { loadSessionDetail, type HistoryDetail } from '../../data/history';
import { saveSessionNote, normalizeExerciseNote } from '../../data/notes';
import { makeDbActions } from '../../data/actions';
import {
  analyzeStepEvidence,
  loadProgressionSnapshot,
  type ProgressionSnapshot,
} from '../../data/progression';
import type { ProgressionEvidence } from '../../analytics/progression';
import { SessionProgressionSummary } from '../ProgressionCard';
import { strings } from '../../constants/strings';
import { overrideReasonLabel, sessionEndReasonLabel } from './WorkoutScreen';
import { formatCount, formatKg, msToSeconds } from '../../utils/units';
import { calculateSessionLoad, gramRepsToKgReps } from '../../analytics/load';
import { summarizeAdherence, type AdherenceSummary } from '../../analytics/adherence';
import { normalizeExecutionType, normalizeOverrideReason } from '../../workout/execution';
import { plannedSets } from '../../workout/sessionProgress';
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

/** Localized block-kind badge (dictionary already carries the locale casing). */
function blockKindLabel(kind: string): string {
  const map = strings.routines.blockKind as Record<string, string>;
  return map[kind] ?? kind.toUpperCase();
}

/** Localized block-role badge (1.1.0); null when main/legacy. */
function blockRoleLabel(role: string | null): string | null {
  if (role === 'warmup') return strings.routines.blockRoleWarmup;
  if (role === 'cooldown') return strings.routines.blockRoleCooldown;
  return null;
}

/** Localized execution marker for a performed set (Phase 3C); null when unmarked. */
function executionLabel(executionType: string | null | undefined): string | null {
  if (executionType === 'modified') return strings.history.execModified;
  if (executionType === 'extra') return strings.history.execExtra;
  if (executionType === 'drop') return strings.history.execDrop;
  return null;
}

/** Localized athlete-stated reason (Phase 3C); null when none stated or unknown. */
function historyReasonLabel(reason: string | null | undefined): string | null {
  if (reason == null) return null;
  if (
    reason === 'load_reduced' ||
    reason === 'load_increased' ||
    reason === 'reps_reduced' ||
    reason === 'reps_increased' ||
    reason === 'fatigue' ||
    reason === 'pain_discomfort' ||
    reason === 'equipment_unavailable' ||
    reason === 'time_constraint' ||
    reason === 'other'
  ) {
    return overrideReasonLabel(reason);
  }
  return null;
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

  // Per-exercise notes (1.1.0) — keyed by position, same save pattern as the session note.
  const [exNotes, setExNotes] = useState<Record<string, string>>({});
  const [exSaved, setExSaved] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!detail) return;
    const init: Record<string, string> = {};
    for (const block of detail.blocks) {
      for (const step of block.steps) {
        init[`${block.blockIndex}:${step.stepIndex}`] = step.exerciseNote ?? '';
      }
    }
    setExNotes(init);
    setExSaved({});
  }, [detail]);

  // Progression intelligence (Phase 3B): one batched snapshot → engine per step.
  const [stepEvidence, setStepEvidence] = useState<Map<string, ProgressionEvidence>>(new Map());
  useEffect(() => {
    if (!detail) return;
    let cancelled = false;
    loadProgressionSnapshot(database)
      .then((prog: ProgressionSnapshot) => {
        if (cancelled) return;
        const now = Date.now();
        const out = new Map<string, ProgressionEvidence>();
        for (const block of detail.blocks) {
          for (const step of block.steps) {
            const stepDef = detail.definition.blocks[block.blockIndex]?.steps[step.stepIndex];
            if (!stepDef) continue;
            const evidence = analyzeStepEvidence(prog, stepDef, now);
            if (evidence) out.set(`${block.blockIndex}:${step.stepIndex}`, evidence);
          }
        }
        setStepEvidence(out);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
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

  const saveExNote = useCallback(
    async (blockIndex: number, stepIndex: number, plannedName: string) => {
      if (!detail) return;
      const key = `${blockIndex}:${stepIndex}`;
      try {
        const value = await makeDbActions(database).setSessionExerciseNote(
          detail.id,
          blockIndex,
          stepIndex,
          plannedName,
          normalizeExerciseNote(exNotes[key] ?? ''),
        );
        void value;
        setExNotes((prev) => ({ ...prev, [key]: normalizeExerciseNote(exNotes[key] ?? '') ?? '' }));
        setExSaved((prev) => ({ ...prev, [key]: true }));
      } catch {
        setExSaved((prev) => ({ ...prev, [key]: false }));
      }
    },
    [detail, exNotes],
  );

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

  // Session adherence (Phase 3D): prescription denominator + recorded rows.
  const adherence = useMemo<AdherenceSummary | null>(() => {
    if (!detail) return null;
    const performed = detail.blocks.flatMap((block) =>
      block.steps.flatMap((step) => step.logs.map((log) => ({
        // loadSessionDetail only returns performed rows here; skipped live apart.
        isCompleted: true,
        executionType: normalizeExecutionType(log.executionType),
      }))),
    );
    const skipped = detail.blocks.reduce(
      (n, block) => n + block.steps.reduce((m, step) => m + step.skipped.length, 0),
      0,
    );
    return summarizeAdherence({ planned: plannedSets(detail.definition), performed, skipped });
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
            {detail.status === 'incomplete' ? (
              <Text className="mt-1 text-sm font-semibold text-warning">
                {strings.history.incomplete}
                {detail.incompleteReason ? ` · ${sessionEndReasonLabel(detail.incompleteReason)}` : ''}
              </Text>
            ) : null}
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
              accessibilityLabel={strings.notes.label}
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
              <Text accessibilityLiveRegion="polite" className="mt-1.5 text-sm text-accent-ink">
                {strings.notes.saved}
              </Text>
            ) : null}
          </Card>

          {adherence && adherence.planned > 0 ? (
            <Card className="mt-3" testID="history-adherence">
              <Text accessibilityRole="header" className="text-xs font-semibold uppercase tracking-wider text-dim">
                {strings.history.adherence}
              </Text>
              <Text className="mt-2 text-sm text-fg" testID="history-adherence-summary">
                {adherence.plannedPerformed}/{adherence.planned} {strings.workout.plannedSets}
                {adherence.status === 'complete' ? ` · ${strings.history.completed}` : ''}
              </Text>
              {adherence.skipped > 0 ||
              adherence.modified > 0 ||
              adherence.extra > 0 ||
              adherence.drop > 0 ? (
                <Text className="mt-0.5 text-sm text-dim" testID="history-adherence-deviations">
                  {[
                    adherence.skipped > 0 ? `${adherence.skipped} ${strings.history.skippedSets}` : null,
                    adherence.modified > 0 ? `${adherence.modified} ${strings.history.adherenceModified}` : null,
                    adherence.extra > 0 ? `${adherence.extra} ${strings.history.adherenceExtra}` : null,
                    adherence.drop > 0 ? `${adherence.drop} ${strings.history.adherenceDrop}` : null,
                  ]
                    .filter((part): part is string => part !== null)
                    .join(' · ')}
                </Text>
              ) : null}
            </Card>
          ) : null}

          {sessionLoad && sessionLoad.completedSetCount > 0 ? (
            <Card className="mt-3">
              <Text accessibilityRole="header" className="text-xs font-semibold uppercase tracking-wider text-dim">
                {strings.history.sessionLoad}
              </Text>
              <Text className="mt-2 text-lg font-bold text-fg">
                {formatCount(gramRepsToKgReps(sessionLoad.resistanceGramReps))} {strings.load.kgReps}
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

        {detail.blocks.map((block, blockIdx) => (
          <Enter key={`b${block.blockIndex}`} delayMs={Math.min(blockIdx, 6) * 40} className="px-4 pt-4">
            <SectionHeader
              title={`${strings.workout.block} ${block.blockIndex + 1} · ${block.name}`}
              right={
                <View className="flex-row items-center gap-2">
                  {blockRoleLabel(block.role) ? (
                    <Text className="text-xs font-semibold text-accent-ink">{blockRoleLabel(block.role)}</Text>
                  ) : null}
                  <Text className="text-xs text-dim">{blockKindLabel(block.kind)}</Text>
                </View>
              }
            />
            {block.steps.map((step) => {
              const target = targetLine(step);
              const noteKey = `${block.blockIndex}:${step.stepIndex}`;
              const subReason = normalizeOverrideReason(step.substitution?.reason ?? null);
              return (
                <Card key={`b${block.blockIndex}s${step.stepIndex}`} className="mb-2">
                  <Text className="text-base font-medium text-fg">{step.exerciseName || strings.common.none}</Text>
                  {step.substitution ? (
                    <Text className="mt-0.5 text-sm text-accent-ink">
                      → {step.substitution.actualExerciseName}
                      {subReason ? ` (${overrideReasonLabel(subReason)})` : ''} · {strings.history.substituted}
                    </Text>
                  ) : null}
                  {stepEvidence.get(`${block.blockIndex}:${step.stepIndex}`) ? (
                    <View className="mt-2">
                      <SessionProgressionSummary
                        evidence={stepEvidence.get(`${block.blockIndex}:${step.stepIndex}`)!}
                        testID={`history-progression-${block.blockIndex}-${step.stepIndex}`}
                      />
                    </View>
                  ) : null}
                  {target ? <Text className="mt-0.5 text-xs text-dim">{strings.workout.target}: {target}</Text> : null}
                  <Text className="mt-2 text-xs font-semibold uppercase tracking-wider text-dim">
                    {strings.history.actualPerformed}
                  </Text>
                  {step.logs.length === 0 && step.skipped.length === 0 ? (
                    <Text className="mt-1 text-sm text-dim">{strings.history.notLogged}</Text>
                  ) : (
                    <>
                      {step.logs.map((log, i) => {
                        const marker = executionLabel(log.executionType);
                        const reason = historyReasonLabel(log.overrideReason);
                        return (
                          <Text key={i} className="mt-1 font-mono text-sm text-fg">
                            {log.round > 1 || block.rounds > 1 ? `R${log.round} · ` : ''}
                            {actualLine(log)}
                            {marker ? ` · ${marker}` : ''}
                            {reason ? ` (${reason})` : ''}
                          </Text>
                        );
                      })}
                      {step.skipped.length > 0 ? (
                        <Text className="mt-1 text-sm text-dim">
                          {strings.history.skippedSets}:{' '}
                          {step.skipped
                            .map((s) => `R${s.round}S${s.setIndex}`)
                            .join(', ')}
                        </Text>
                      ) : null}
                    </>
                  )}
                  <TextField
                    label={strings.notes.exerciseLabel}
                    accessibilityLabel={`${strings.notes.exerciseLabel} ${step.exerciseName}`}
                    value={exNotes[noteKey] ?? ''}
                    onChangeText={(t) => {
                      setExNotes((prev) => ({ ...prev, [noteKey]: t }));
                      setExSaved((prev) => ({ ...prev, [noteKey]: false }));
                    }}
                    placeholder={strings.notes.exercisePlaceholder}
                    testID={`history-exnote-${block.blockIndex}-${step.stepIndex}`}
                  />
                  <Button
                    label={strings.notes.save}
                    variant="secondary"
                    className="mt-2"
                    testID={`history-exnote-save-${block.blockIndex}-${step.stepIndex}`}
                    onPress={() =>
                      void saveExNote(block.blockIndex, step.stepIndex, step.exerciseName)
                    }
                  />
                  {exSaved[noteKey] ? (
                    <Text accessibilityLiveRegion="polite" className="mt-1.5 text-sm text-accent-ink">
                      {strings.notes.saved}
                    </Text>
                  ) : null}
                </Card>
              );
            })}
          </Enter>
        ))}
      </ScrollView>
      </Enter>
    </Screen>
  );
}
