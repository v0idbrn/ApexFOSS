import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Pressable, ScrollView, Text, View } from 'react-native';
import { database } from '../../data';
import { strings } from '../../constants/strings';
import { formatCountdown, formatKg, formatTempo, gramsToKg, kgToGrams, secondsToMs } from '../../utils/units';
import { useTimerStore } from '../../state/timerStore';
import { useActiveSessionStore } from '../../state/activeSessionStore';
import type { BlockDef, EngineEvent, IntervalSpec, OverrideReason, PersistedInterval, Prescription, SetPayload, StepDef } from '../../types/engine';
import { classifySetExecution, OVERRIDE_REASONS } from '../../workout/execution';
import {
  applyWorkoutEvent,
  discardWorkout,
  isTimerExpired,
  loadActiveWorkout,
  loadWorkoutRuntime,
  reconcileTimerNotification,
  type WorkoutRuntime,
} from '../../workout/runner';
import {
  recommendNextLoad,
  DEFAULT_AUTOREG_CONFIG,
  type AutoregConfig,
  type AutoregRecommendation,
} from '../../analytics/autoregulation';
import {
  cancelTempo,
  hasActiveTempo,
  idleTempoRuntime,
  startTempo,
  tickTempo,
  type TempoEffect,
  type TempoRuntime,
} from '../../tempo/tempoTrainer';
import {
  cancelInterval,
  completeWorkPhase,
  hasActiveInterval,
  idleIntervalRuntime,
  resumeInterval,
  restartInterval,
  skipPhase,
  startInterval,
  tickInterval,
  type IntervalEffect,
  type IntervalRuntime,
} from '../../interval/intervalEngine';
import {
  activateIntervalKeepAwake,
  activateTempoKeepAwake,
  pulseIntervalHaptic,
  pulseTempoHaptic,
  releaseIntervalKeepAwake,
  releaseTempoKeepAwake,
} from '../../tempo/feedback';
import { useNav } from '../navigation';
import { theme } from '../../theme';
import { Enter } from '../motion';
import {
  AppHeader,
  Badge,
  Button,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  LoadingState,
  MetricCard,
  Progress,
  Screen,
  SectionHeader,
  TextField,
  confirmDestructive,
} from '../components';
import { Numpad, NumpadField } from '../Numpad';
import { sessionProgress } from '../../workout/sessionProgress';
import { loadSessionDetail } from '../../data/history';
import { saveSessionNote } from '../../data/notes';
import {
  analyzeStepEvidence,
  loadProgressionSnapshot,
} from '../../data/progression';
import type { ProgressionEvidence } from '../../analytics/progression';
import { SessionProgressionSummary } from '../ProgressionCard';
import { calculateSessionLoad, gramRepsToKgReps } from '../../analytics/load';
import { formatCount } from '../../utils/units';
import { TempoActiveCard, TempoReadyCard } from '../TempoTrainer';
import { IntervalActiveCard, IntervalReadyCard } from '../IntervalTrainer';
import {
  applyNumpadKey,
  applyNumpadModifier,
  isValidNumpadValue,
  readNumpadField,
  writeNumpadField,
  type NumpadField as NumpadFieldKey,
  type NumpadInput,
  type NumpadKey,
  type NumpadModifier,
} from '../numpadInput';

const emptyInputs = (): NumpadInput => ({ weightKg: '', reps: '', durationS: '', rir: '' });

/** Visual refresh for tempo countdown only — not a second authoritative timer. */
const TEMPO_UI_TICK_MS = 100;

/** Small prescription tile — training numbers stay scannable at a glance. */
function TargetTile({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}${unit ? ` ${unit}` : ''}`}
      className="min-w-20 rounded-lg border border-line bg-bg px-3 py-2"
    >
      <Text className="text-overline uppercase text-dim">{label}</Text>
      <View className="mt-0.5 flex-row items-baseline">
        <Text className="font-mono text-metric text-fg">{value}</Text>
        {unit ? <Text className="ml-1 text-caption text-dim">{unit}</Text> : null}
      </View>
    </View>
  );
}

/**
 * Compact prescription line (view-model, pure): "3 × 5 @ 60 kg RIR 2".
 * Shared by the step card (target strip) and the rest card's "next up".
 */
export function prescriptionParts(p: Prescription): string[] {
  const parts: string[] = [];
  if (p.targetSets !== null) parts.push(`${p.targetSets} ×`);
  if (p.targetRepsMin !== null) {
    parts.push(`${p.targetRepsMin}${p.targetRepsMax !== null ? `–${p.targetRepsMax}` : ''}`);
  }
  if (p.targetWeightGrams !== null) parts.push(`@ ${formatKg(p.targetWeightGrams)} ${strings.workout.weight}`);
  if (p.targetDurationMs !== null) parts.push(`${Math.round(p.targetDurationMs / 1000)}${strings.units.seconds}`);
  if (p.targetRir !== null) parts.push(`${strings.workout.rir} ${p.targetRir}`);
  return parts;
}

/** One-line prescription summary; `common.none` when the step prescribes nothing. */
export function prescriptionSummary(p: Prescription): string {
  const parts = prescriptionParts(p);
  return parts.length > 0 ? parts.join(' ') : strings.common.none;
}

/** Block-step position, e.g. "Step 2/4" ("" when the block has no steps). */
export function stepPositionLabel(stepIndex: number, stepCount: number): string {
  if (stepCount <= 0) return '';
  return `${strings.routines.step} ${Math.min(stepIndex + 1, stepCount)}/${stepCount}`;
}

/** Current-set position inside the step, e.g. "Set 1 of 3". */
export function setPositionLabel(setIndex: number, targetSets: number): string {
  const current = Math.min(Math.max(setIndex, 1), targetSets);
  return `${strings.workout.set} ${current} ${strings.workout.of} ${targetSets}`;
}

interface SessionSummary {
  durationMs: number | null;
  sets: number;
  volumeGramReps: number;
}

const toPayload = (step: StepDef, input: NumpadInput, overrideReason: OverrideReason | null): SetPayload => {
  const p = step.prescription;
  const w = input.weightKg.trim();
  const r = input.reps.trim();
  const d = input.durationS.trim();
  const rir = input.rir.trim();
  return {
    weightGrams: w ? kgToGrams(Number(w)) : p.targetWeightGrams,
    reps: r ? Math.max(0, Math.round(Number(r))) : p.targetRepsMin,
    durationMs: d ? secondsToMs(Math.max(0, Number(d))) : p.targetDurationMs,
    distanceMm: null,
    rir: rir ? Math.max(0, Math.round(Number(rir))) : p.targetRir,
    overrideReason,
  };
};

/** Localized label for an athlete-stated override reason (Phase 3C). */
export function overrideReasonLabel(reason: OverrideReason): string {
  switch (reason) {
    case 'load_reduced':
      return strings.workout.reasonLoadReduced;
    case 'load_increased':
      return strings.workout.reasonLoadIncreased;
    case 'reps_reduced':
      return strings.workout.reasonRepsReduced;
    case 'reps_increased':
      return strings.workout.reasonRepsIncreased;
    case 'fatigue':
      return strings.workout.reasonFatigue;
    case 'pain_discomfort':
      return strings.workout.reasonPain;
    case 'equipment_unavailable':
      return strings.workout.reasonEquipment;
    case 'time_constraint':
      return strings.workout.reasonTime;
    case 'other':
      return strings.workout.reasonOther;
  }
}

const validNumber = (s: string): boolean => isValidNumpadValue(s);

const fireTempoEffects = (effects: TempoEffect[]) => {
  for (const e of effects) pulseTempoHaptic(e);
};

const fireIntervalEffects = (effects: IntervalEffect[]) => {
  for (const e of effects) pulseIntervalHaptic(e);
};

function intervalRuntimeFromPersisted(p: PersistedInterval | null | undefined): IntervalRuntime {
  if (!p || p.status !== 'running' || !p.config) return idleIntervalRuntime();
  return {
    status: 'running',
    config: p.config,
    startedAt: p.startedAt,
    round: p.round,
    phase: p.phase,
    phaseStartsAt: p.phaseStartsAt,
    phaseEndsAt: p.phaseEndsAt,
    workDoneEarly: !!p.workDoneEarly,
  };
}

function toPersistedInterval(rt: IntervalRuntime): PersistedInterval | null {
  if (rt.status !== 'running' || !rt.config) return null;
  return {
    status: 'running',
    config: rt.config,
    startedAt: rt.startedAt,
    round: rt.round,
    phase: rt.phase,
    phaseStartsAt: rt.phaseStartsAt,
    phaseEndsAt: rt.phaseEndsAt,
    workDoneEarly: rt.workDoneEarly,
  };
}

export function WorkoutScreen() {
  const { pop, setBackInterceptor } = useNav();
  const [rt, setRt] = useState<WorkoutRuntime | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [completedView, setCompletedView] = useState(false);
  const [inputs, setInputs] = useState<NumpadInput>(emptyInputs);
  const [activeField, setActiveField] = useState<NumpadFieldKey | null>(null);
  // Ephemeral tempo trainer (intra-set aid) — never persisted, never engine-owned.
  const [tempo, setTempo] = useState<TempoRuntime>(idleTempoRuntime);
  const [tempoNow, setTempoNow] = useState(() => Date.now());
  // Interval trainer — runtime derived from timestamps; optional cursor.interval for recovery.
  const [intervalRt, setIntervalRt] = useState<IntervalRuntime>(idleIntervalRuntime);
  const [intervalNow, setIntervalNow] = useState(() => Date.now());
  const busyRef = useRef(false);
  const rtRef = useRef<WorkoutRuntime | null>(null);
  rtRef.current = rt;
  const tempoRef = useRef<TempoRuntime>(tempo);
  tempoRef.current = tempo;
  const intervalRef = useRef<IntervalRuntime>(intervalRt);
  intervalRef.current = intervalRt;
  const persistIntervalRef = useRef<(next: IntervalRuntime) => void>(() => {});
  // Completion micro-interaction: brief progress flash after a logged set.
  const [flash, setFlash] = useState(false);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Completed-session summary (duration / sets / volume) for the save screen.
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  // Post-workout session note — loaded with the completed view, saved on Done.
  const [noteText, setNoteText] = useState('');
  // Phase 3B: deterministic progression evidence for the trained steps.
  const [postProgression, setPostProgression] = useState<ProgressionEvidence[] | null>(null);

  // RIR autoregulation — runtime ephemeral only (never mutates definition/snapshots).
  const [autoregEnabled, setAutoregEnabled] = useState(false);
  const [autoregConfig, setAutoregConfig] = useState<AutoregConfig>(DEFAULT_AUTOREG_CONFIG);
  const [autoregSuggestion, setAutoregSuggestion] = useState<AutoregRecommendation | null>(null);
  const pendingAutoregRef = useRef<{ posKey: string; rec: AutoregRecommendation } | null>(null);

  const timer = useTimerStore();
  const setSession = useActiveSessionStore((s) => s.setSession);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const active = await loadActiveWorkout(database);
      if (!active) {
        setError(strings.workout.loadFailed);
        setRt(null);
        return;
      }
      setRt(active);
      setSession(active.sessionId, active.definition.name);
      if (active.cursor.status === 'completed') setCompletedView(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [setSession]);

  useEffect(() => {
    load();
  }, [load]);

  // Reconcile notification whenever an active timer is loaded (covers process death).
  // Paused timers reconcile to "no notification" (runner handles pausedAt).
  useEffect(() => {
    const c = rt?.cursor;
    if (!c || c.status !== 'active') return;
    void reconcileTimerNotification(rt.sessionId, c.timer, Date.now());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rt?.sessionId, rt?.cursor.timer?.expiresAt, rt?.cursor.timer?.pausedAt, rt?.cursor.status]);

  // Completed view: one narrow load for duration / sets / volume summary.
  useEffect(() => {
    if (!completedView || !rt) return;
    let cancelled = false;
    loadSessionDetail(database, rt.sessionId)
      .then(async (detail) => {
        if (cancelled || !detail) return;
        const load = calculateSessionLoad({
          sessionId: detail.id,
          name: detail.name,
          startedAt: detail.startedAt,
          endedAt: detail.endedAt,
          exercises: detail.blocks.flatMap((b) =>
            b.steps.map((s) => ({
              exerciseName: s.exerciseName,
              sets: s.logs.map((l) => ({
                weightGrams: l.weightGrams,
                reps: l.reps,
                durationMs: l.durationMs,
                isCompleted: true,
              })),
            })),
          ),
        });
        setSummary({
          durationMs: detail.durationMs,
          sets: load.completedSetCount,
          volumeGramReps: load.resistanceGramReps,
        });
        setNoteText(detail.note ?? '');
        // Progression evidence for the trained steps (same batched snapshot;
        // best-evidence step per exercise, engine-owned verdicts only).
        try {
          const prog = await loadProgressionSnapshot(database);
          const now = Date.now();
          const seenExercises = new Set<string>();
          const evidenceList: ProgressionEvidence[] = [];
          for (const block of detail.blocks) {
            for (const step of block.steps) {
              const stepDef = detail.definition.blocks[block.blockIndex]?.steps[step.stepIndex];
              if (!stepDef) continue;
              const identityKey = stepDef.exerciseId ?? `name:${stepDef.exerciseName}`;
              if (seenExercises.has(identityKey)) continue;
              const evidence = analyzeStepEvidence(prog, stepDef, now);
              if (evidence) {
                seenExercises.add(identityKey);
                evidenceList.push(evidence);
              }
            }
          }
          evidenceList.sort((a, b) => {
            const rank = (s: ProgressionEvidence['state']) => (s === 'progress' ? 0 : s === 'maintain' ? 1 : 2);
            return rank(a.state) - rank(b.state);
          });
          setPostProgression(evidenceList.length > 0 ? evidenceList.slice(0, 3) : []);
        } catch {
          setPostProgression(null);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [completedView, rt?.sessionId]);

  // Athlete-stated override reason (Phase 3C): optional, explicit, reset per set.
  const [overrideReason, setOverrideReason] = useState<OverrideReason | null>(null);

  // Reset actual inputs whenever the target set/step changes.
  const step = rt && rt.cursor.status === 'active' ? rt.definition.blocks[rt.cursor.blockIndex]?.steps[rt.cursor.stepIndex] : undefined;
  const posKey = rt ? `${rt.cursor.blockIndex}:${rt.cursor.stepIndex}:${rt.cursor.round}:${rt.cursor.setIndex}` : '';
  useEffect(() => {
    if (!step) {
      setInputs(emptyInputs());
      setActiveField(null);
      setAutoregSuggestion(null);
      setOverrideReason(null);
      return;
    }
    const p = step.prescription;
    const pending = pendingAutoregRef.current;
    const suggestionApplies = pending !== null && pending.posKey === posKey;
    setInputs({
      weightKg:
        suggestionApplies && pending.rec.recommendedWeightGrams > 0
          ? String(gramsToKg(pending.rec.recommendedWeightGrams) ?? '')
          : p.targetWeightGrams !== null
            ? String(gramsToKg(p.targetWeightGrams) ?? '')
            : '',
      reps: p.targetRepsMin !== null ? String(p.targetRepsMin) : '',
      durationS: p.targetDurationMs !== null ? String(Math.round(p.targetDurationMs / 1000)) : '',
      rir: p.targetRir !== null ? String(p.targetRir) : '',
    });
    if (suggestionApplies) {
      setAutoregSuggestion(pending.rec);
      pendingAutoregRef.current = null;
    } else {
      setAutoregSuggestion(null);
      pendingAutoregRef.current = null;
    }
    setActiveField('weight');
    setOverrideReason(null);
    // New set/step: discard any in-flight tempo/interval (no stale phase timestamps).
    setTempo(idleTempoRuntime());
    releaseTempoKeepAwake();
    setIntervalRt(idleIntervalRuntime());
    releaseIntervalKeepAwake();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posKey]);

  // Load persisted interval runtime when landing on an interval block (process death recovery).
  useEffect(() => {
    const c = rt?.cursor;
    if (!c || c.status !== 'active') return;
    const block = rt?.definition.blocks[c.blockIndex];
    if (!block || block.kind !== 'interval') {
      if (intervalRef.current.status !== 'idle') {
        intervalRef.current = cancelInterval();
        setIntervalRt(cancelInterval());
        releaseIntervalKeepAwake();
      }
      return;
    }
    if (c.interval) {
      const resumed = resumeInterval(intervalRuntimeFromPersisted(c.interval), Date.now());
      intervalRef.current = resumed.runtime;
      setIntervalRt(resumed.runtime);
      if (resumed.runtime.status === 'running') activateIntervalKeepAwake();
      fireIntervalEffects(resumed.effects);
    } else if (intervalRef.current.status === 'idle') {
      // stay idle — athlete starts intentionally
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rt?.sessionId, rt?.cursor.blockIndex, rt?.cursor.status]);

  // Tempo trainer: timestamp-based; UI tick derives remaining; engine never sees it.
  const applyTempoTick = useCallback((now: number) => {
    const current = tempoRef.current;
    if (current.status !== 'running') {
      setTempoNow(now);
      return;
    }
    const step = tickTempo(current, now);
    tempoRef.current = step.runtime;
    setTempo(step.runtime);
    setTempoNow(now);
    fireTempoEffects(step.effects);
    if (step.runtime.status === 'running') activateTempoKeepAwake();
    else releaseTempoKeepAwake();
  }, []);

  useEffect(() => {
    if (tempo.status !== 'running') return;
    activateTempoKeepAwake();
    const id = setInterval(() => applyTempoTick(Date.now()), TEMPO_UI_TICK_MS);
    return () => clearInterval(id);
  }, [tempo.status, applyTempoTick]);

  // Background/resume: re-derive phase from absolute timestamps (no drift, no blind restart).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') applyTempoTick(Date.now());
    });
    return () => sub.remove();
  }, [applyTempoTick]);

  // Unmount: never leak keep-awake, flash timers or a running tempo/interval reference.
  useEffect(() => {
    return () => {
      releaseTempoKeepAwake();
      releaseIntervalKeepAwake();
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, []);

  // Interval: timestamp-based; UI tick derives remaining; engine never sees phase events.
  const applyIntervalTick = useCallback((now: number) => {
    const current = intervalRef.current;
    if (current.status !== 'running') {
      setIntervalNow(now);
      return;
    }
    const step = tickInterval(current, now);
    intervalRef.current = step.runtime;
    setIntervalRt(step.runtime);
    setIntervalNow(now);
    fireIntervalEffects(step.effects);
    if (step.runtime.status === 'running') activateIntervalKeepAwake();
    else {
      releaseIntervalKeepAwake();
      persistIntervalRef.current(step.runtime);
    }
  }, []);

  useEffect(() => {
    if (intervalRt.status !== 'running') return;
    activateIntervalKeepAwake();
    const id = setInterval(() => applyIntervalTick(Date.now()), TEMPO_UI_TICK_MS);
    return () => clearInterval(id);
  }, [intervalRt.status, applyIntervalTick]);

  // Background/resume interval: re-derive from absolute timestamps.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') applyIntervalTick(Date.now());
    });
    return () => sub.remove();
  }, [applyIntervalTick]);

  const persistIntervalRuntime = useCallback((next: IntervalRuntime) => {
    const current = rtRef.current;
    if (!current) return;
    const persisted = toPersistedInterval(next);
    const cursor = { ...current.cursor, interval: persisted };
    // Application-layer write of optional runtime only — no engine event, no set_log.
    void current.session.update((rec) => {
      rec.cursorJson = JSON.stringify(cursor);
      rec.updatedAt = Date.now();
    }).catch(() => {
      // fail-soft: recovery re-derives or stays idle
    });
    rtRef.current = { ...current, cursor };
    setRt((prev) => (prev && prev.sessionId === current.sessionId ? { ...prev, cursor } : prev));
  }, []);
  persistIntervalRef.current = persistIntervalRuntime;

  const clearPersistedInterval = useCallback(() => {
    const current = rtRef.current;
    if (!current || !current.cursor.interval) return;
    const cursor = { ...current.cursor, interval: null };
    void current.session.update((rec) => {
      rec.cursorJson = JSON.stringify(cursor);
      rec.updatedAt = Date.now();
    }).catch(() => {});
    rtRef.current = { ...current, cursor };
    setRt((prev) => (prev && prev.sessionId === current.sessionId ? { ...prev, cursor } : prev));
  }, []);

  const onStartInterval = () => {
    const block = rtRef.current?.definition.blocks[rtRef.current.cursor.blockIndex];
    if (!block?.interval) return;
    const now = Date.now();
    const result = startInterval(block.interval, now);
    intervalRef.current = result.runtime;
    setIntervalRt(result.runtime);
    setIntervalNow(now);
    fireIntervalEffects(result.effects);
    if (result.runtime.status === 'running') {
      activateIntervalKeepAwake();
      persistIntervalRuntime(result.runtime);
    }
  };

  const onCancelInterval = () => {
    intervalRef.current = cancelInterval();
    setIntervalRt(cancelInterval());
    setIntervalNow(Date.now());
    releaseIntervalKeepAwake();
    clearPersistedInterval();
  };

  const onRestartInterval = () => {
    const now = Date.now();
    const result = restartInterval(intervalRef.current, now);
    intervalRef.current = result.runtime;
    setIntervalRt(result.runtime);
    setIntervalNow(now);
    fireIntervalEffects(result.effects);
    if (result.runtime.status === 'running') {
      activateIntervalKeepAwake();
      persistIntervalRuntime(result.runtime);
    } else {
      clearPersistedInterval();
    }
  };

  const onSkipIntervalPhase = () => {
    const now = Date.now();
    const result = skipPhase(intervalRef.current, now);
    intervalRef.current = result.runtime;
    setIntervalRt(result.runtime);
    setIntervalNow(now);
    fireIntervalEffects(result.effects);
    if (result.runtime.status === 'running') persistIntervalRuntime(result.runtime);
    else {
      releaseIntervalKeepAwake();
      clearPersistedInterval();
    }
  };

  const onFinishIntervalWork = () => {
    const now = Date.now();
    const result = completeWorkPhase(intervalRef.current, now);
    intervalRef.current = result.runtime;
    setIntervalRt(result.runtime);
    setIntervalNow(now);
    fireIntervalEffects(result.effects);
    if (result.runtime.status === 'running') persistIntervalRuntime(result.runtime);
  };

  const onStartTempo = () => {
    if (!step) return;
    const now = Date.now();
    const result = startTempo(step.prescription.tempo, now);
    tempoRef.current = result.runtime;
    setTempo(result.runtime);
    setTempoNow(now);
    fireTempoEffects(result.effects);
    if (result.runtime.status === 'running') activateTempoKeepAwake();
  };

  const onCancelTempo = () => {
    tempoRef.current = cancelTempo();
    setTempo(cancelTempo());
    setTempoNow(Date.now());
    releaseTempoKeepAwake();
  };

  const onRestartTempo = () => {
    onStartTempo();
  };

  // Timer: truth is cursor.timer.expiresAt. setTimeout only drives UI refresh / expiry event.
  // Paused timers (cursor pausedAt) schedule nothing: the countdown is frozen at expiresAt − pausedAt.
  const applyRef = useRef<(event: EngineEvent) => Promise<void>>(async () => {});
  useEffect(() => {
    const c = rt?.cursor;
    if (!c || c.status !== 'active' || !c.timer) {
      timer.clear();
      return;
    }
    timer.setFromCursor(c.timer);
    if (c.timer.pausedAt != null) return;
    if (isTimerExpired(c, Date.now())) {
      applyRef.current({ type: 'TIMER_EXPIRE', now: Date.now() });
      return;
    }
    const remaining = Math.max(0, c.timer.expiresAt - Date.now());
    const expireTimer = setTimeout(() => {
      applyRef.current({ type: 'TIMER_EXPIRE', now: Date.now() });
    }, remaining);
    const tick = setInterval(() => timer.tick(), 250);
    return () => {
      clearTimeout(expireTimer);
      clearInterval(tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rt?.cursor.timer?.expiresAt, rt?.cursor.timer?.kind, rt?.cursor.timer?.pausedAt, rt?.cursor.status]);

  // Background/resume: re-read persisted cursor (A2–A4). Never trust in-memory UI state.
  const reloadForResume = useCallback(async () => {
    const current = rtRef.current;
    try {
      const fresh = current ? await loadWorkoutRuntime(database, current.sessionId) : await loadActiveWorkout(database);
      if (!fresh) return;
      setRt(fresh);
      if (fresh.cursor.status === 'completed') {
        setCompletedView(true);
        timer.clear();
        setSession(null, null);
        return;
      }
      await reconcileTimerNotification(fresh.sessionId, fresh.cursor.timer, Date.now());
      if (isTimerExpired(fresh.cursor, Date.now())) {
        await applyRef.current({ type: 'TIMER_EXPIRE', now: Date.now() });
      } else if (fresh.cursor.timer) {
        timer.setFromCursor(fresh.cursor.timer);
      }
    } catch {
      // keep last known UI; next interaction re-reads
    }
  }, [setSession, timer]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' || state === 'background') {
        // background: refresh remaining from expiresAt (setTimeout may freeze);
        // active: detect expiration and dispatch through the runner.
        if (state === 'active') void reloadForResume();
        else {
          const c = rtRef.current?.cursor;
          if (c?.timer) timer.setFromCursor(c.timer);
        }
      }
    });
    return () => sub.remove();
  }, [reloadForResume, timer]);

  const apply = useCallback(
    async (event: EngineEvent) => {
      if (busyRef.current) return;
      const current = rtRef.current;
      if (!current) return;
      busyRef.current = true;
      setBusy(true);
      try {
        // Completing a set / advancing while tempo or interval runs: stop aids first.
        if (tempoRef.current.status === 'running') {
          tempoRef.current = cancelTempo();
          setTempo(cancelTempo());
          releaseTempoKeepAwake();
        }
        if (intervalRef.current.status !== 'idle') {
          intervalRef.current = cancelInterval();
          setIntervalRt(cancelInterval());
          releaseIntervalKeepAwake();
          clearPersistedInterval();
        }
        const next = await applyWorkoutEvent(database, current, event);
        setRt(next);
        if (event.type === 'COMPLETE_SET') {
          // Micro-interaction: short progress flash (interruptible, no loop).
          setFlash(true);
          if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
          flashTimerRef.current = setTimeout(() => setFlash(false), 450);
        }
        if (next.cursor.status === 'completed') {
          setCompletedView(true);
          timer.clear();
          setSession(null, null);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [setSession, timer, clearPersistedInterval],
  );
  applyRef.current = apply;

  // Android back: leave the screen but keep the session active (resume from Home).
  useEffect(() => {
    setBackInterceptor(() => false);
    return () => setBackInterceptor(null);
  }, [setBackInterceptor]);

  const { weightKg, reps, durationS, rir } = inputs;
  const inputsValid =
    validNumber(weightKg) && validNumber(reps) && validNumber(durationS) && validNumber(rir);
  // Phase 3C: show the optional reason row only when the entered actuals differ
  // from the prescription (same pure classifier the persistence layer uses).
  const inputsDiffer =
    step != null && classifySetExecution(step.prescription, toPayload(step, inputs, null)) === 'modified';

  const onNumpadKey = (key: NumpadKey) => {
    if (!activeField || busy) return;
    setInputs((prev) => writeNumpadField(prev, activeField, applyNumpadKey(readNumpadField(prev, activeField), key, activeField)));
  };

  const onNumpadModifier = (mod: NumpadModifier) => {
    if (!activeField || busy) return;
    setInputs((prev) => writeNumpadField(prev, activeField, applyNumpadModifier(readNumpadField(prev, activeField), activeField, mod)));
  };

  const onNumpadClear = () => {
    if (!activeField || busy) return;
    setInputs((prev) => writeNumpadField(prev, activeField, ''));
  };

  const onComplete = () => {
    if (!step || !inputsValid || !rt) return;
    // Opt-in RIR autoregulation: recommend next-set load from this set's actual RIR.
    if (autoregEnabled && step.prescription.targetRir !== null && autoregConfig.enabled) {
      const currentWeight =
        inputs.weightKg.trim() !== '' && Number.isFinite(Number(inputs.weightKg))
          ? kgToGrams(Number(inputs.weightKg))
          : step.prescription.targetWeightGrams;
      const actualRir = inputs.rir.trim() !== '' && Number.isFinite(Number(inputs.rir)) ? Math.round(Number(inputs.rir)) : null;
      const rec = recommendNextLoad(currentWeight, actualRir, {
        ...autoregConfig,
        enabled: true,
        targetRir: step.prescription.targetRir,
      });
      const c = rt.cursor;
      pendingAutoregRef.current = {
        posKey: `${c.blockIndex}:${c.stepIndex}:${c.round}:${c.setIndex + 1}`,
        rec,
      };
    }
    void apply({ type: 'COMPLETE_SET', now: Date.now(), set: toPayload(step, inputs, overrideReason) });
  };

  const onSkip = () => {
    if (!rt) return;
    if (rt.cursor.timer) void apply({ type: 'SKIP_TIMER', now: Date.now() });
    else void apply({ type: 'SKIP_STEP', now: Date.now() });
  };

  /**
   * Skip the current set (Phase 3C): the prescribed position is recorded as
   * skipped and execution advances. Undo restores the position.
   */
  const onSkipSet = () => {
    if (!rt || busy) return;
    void apply({ type: 'SKIP_SET', now: Date.now() });
  };

  /**
   * Log an additional set (Phase 3C): 'extra' for work beyond the prescription,
   * 'drop' for an immediate lower-load continuation. Cursor position is kept;
   * the set lands at the next extra index for this step.
   */
  const onExtraSet = (executionType: 'extra' | 'drop') => {
    if (!step || !inputsValid || !rt || busy) return;
    void apply({
      type: 'LOG_EXTRA_SET',
      now: Date.now(),
      set: toPayload(step, inputs, overrideReason),
      executionType,
    });
  };

  /**
   * Pause / resume the rest timer as an application-layer write to the canonical
   * cursor (same pattern as interval persistence). Pause freezes remaining =
   * expiresAt − pausedAt; resume rewrites expiresAt = now + remaining. No second
   * timer source of truth is introduced.
   */
  const onPauseResume = () => {
    const current = rtRef.current;
    const t = current?.cursor.timer;
    if (!current || !t || current.cursor.status !== 'active') return;
    const now = Date.now();
    const nextTimer =
      t.pausedAt != null
        ? { ...t, expiresAt: now + Math.max(0, t.expiresAt - t.pausedAt), pausedAt: null }
        : { ...t, pausedAt: now };
    const cursor = { ...current.cursor, timer: nextTimer };
    void current.session
      .update((rec) => {
        rec.cursorJson = JSON.stringify(cursor);
        rec.updatedAt = now;
      })
      .then(() => reconcileTimerNotification(current.sessionId, cursor.timer, now))
      .catch(() => {
        // fail-soft: reload on next resume reconciles the canonical cursor
      });
    rtRef.current = { ...current, cursor };
    setRt((prev) => (prev && prev.sessionId === current.sessionId ? { ...prev, cursor } : prev));
  };

  const onUndo = () => {
    void apply({ type: 'UNDO_LAST', now: Date.now() });
  };

  const onFinish = () => {
    Alert.alert(strings.workout.finish, strings.workout.finishConfirm, [
      { text: strings.common.cancel, style: 'cancel' },
      { text: strings.workout.finish, style: 'default', onPress: () => void apply({ type: 'COMPLETE_SESSION', now: Date.now() }) },
    ]);
  };

  const onDiscard = () => {
    confirmDestructive(strings.workout.discardConfirm, () => {
      void (async () => {
        const current = rtRef.current;
        if (!current) return;
        try {
          tempoRef.current = cancelTempo();
          setTempo(cancelTempo());
          releaseTempoKeepAwake();
          intervalRef.current = cancelInterval();
          setIntervalRt(cancelInterval());
          releaseIntervalKeepAwake();
          clearPersistedInterval();
          await discardWorkout(database, current);
          setSession(null, null);
          timer.clear();
          pop();
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      })();
    });
  };

  // Rest timer / completed session takes precedence: never overlap tempo or interval with REST.
  // Declared with other hooks (before early returns) to keep hook order stable.
  const restActive = !!rt && rt.cursor.status === 'active' && rt.cursor.timer !== null;
  const sessionDone = !!rt && (completedView || rt.cursor.status === 'completed');
  useEffect(() => {
    if ((restActive || sessionDone || !rt) && tempoRef.current.status !== 'idle') {
      tempoRef.current = cancelTempo();
      setTempo(cancelTempo());
      releaseTempoKeepAwake();
    }
    if ((restActive || sessionDone || !rt) && intervalRef.current.status !== 'idle') {
      intervalRef.current = cancelInterval();
      setIntervalRt(cancelInterval());
      releaseIntervalKeepAwake();
      clearPersistedInterval();
    }
  }, [restActive, sessionDone, rt, clearPersistedInterval]);

  if (loading) {
    return (
      <Screen>
        <AppHeader title={strings.workout.start} onBack={pop} />
        <LoadingState />
      </Screen>
    );
  }

  if (error && !rt) {
    return (
      <Screen>
        <AppHeader title={strings.workout.start} onBack={pop} />
        <ErrorState message={error} onRetry={load} />
      </Screen>
    );
  }

  if (!rt) {
    return (
      <Screen>
        <AppHeader title={strings.workout.start} onBack={pop} />
        <ErrorState message={strings.workout.loadFailed} onRetry={load} />
      </Screen>
    );
  }

  const { definition, cursor } = rt;
  const block = definition.blocks[cursor.blockIndex];
  const currentStep = block?.steps[cursor.stepIndex];
  const targetSets = Math.max(1, currentStep?.prescription.targetSets ?? 1);
  const canUndo = cursor.status === 'active' && cursor.lastReversible?.kind === 'set';
  const hasTimer = cursor.status === 'active' && cursor.timer !== null;
  const showNumpad = cursor.status === 'active' && !!currentStep && !hasTimer && block?.kind !== 'interval';
  const showTempo =
    cursor.status === 'active' &&
    !!currentStep &&
    !hasTimer &&
    block?.kind !== 'interval' &&
    hasActiveTempo(currentStep.prescription.tempo);
  const intervalSpec: IntervalSpec | null =
    cursor.status === 'active' && block?.kind === 'interval' && block.interval ? block.interval : null;
  const showInterval = !!intervalSpec && !hasTimer && hasActiveInterval(intervalSpec);
  const progress = sessionProgress(definition, cursor);
  const timerRemainingMs = hasTimer && cursor.timer
    ? cursor.timer.pausedAt != null
      ? Math.max(0, cursor.timer.expiresAt - cursor.timer.pausedAt)
      : timer.remainingMs || Math.max(0, cursor.timer.expiresAt - Date.now())
    : 0;
  // Rest-state presentation: kind + paused are always spelled out (never color-only).
  const restKind = hasTimer && cursor.timer
    ? cursor.timer.kind === 'rest'
      ? strings.timer.rest
      : strings.timer.autoAdvance
    : '';
  const restPaused = !!(hasTimer && cursor.timer && cursor.timer.pausedAt != null);
  const restCountdown = formatCountdown(timerRemainingMs);
  const restTargetStep =
    hasTimer && cursor.timer
      ? definition.blocks[cursor.timer.target.blockIndex]?.steps[cursor.timer.target.stepIndex]
      : undefined;
  const stepHeaderText = currentStep
    ? `${currentStep.exerciseName || strings.common.none}, ${stepPositionLabel(cursor.stepIndex, block?.steps.length ?? 0)}`
    : '';

  if (completedView || cursor.status === 'completed') {
    return (
      <Screen>
        <AppHeader title={definition.name} />
        <Enter className="flex-1 items-center justify-center px-6">
          <Text className="text-overline uppercase text-accent-ink">{strings.workout.summary}</Text>
          <Text accessibilityRole="header" className="mt-1.5 text-title text-success">
            {strings.workout.sessionSaved}
          </Text>
          <Text className="mt-1 text-caption text-dim">{definition.name}</Text>
          <View className="mt-6 w-full flex-row gap-2">
            <MetricCard
              size="sm"
              label={strings.history.duration}
              value={summary ? String(Math.round((summary.durationMs ?? 0) / 60000)) : '—'}
              unit={strings.home.weekTimeUnit}
            />
            <MetricCard size="sm" label={strings.workout.setsCompleted} value={summary ? String(summary.sets) : '—'} />
            <MetricCard
              size="sm"
              label={strings.history.volume}
              value={summary ? formatCount(gramRepsToKgReps(summary.volumeGramReps)) : '—'}
              unit={strings.load.kgReps}
            />
          </View>
          {postProgression && postProgression.length > 0 ? (
            <View className="mt-6 w-full max-w-sm items-stretch">
              {postProgression.map((ev, i) => (
                <View key={i} className={i > 0 ? 'mt-2' : undefined}>
                  <SessionProgressionSummary evidence={ev} testID={`post-progression-${i}`} />
                </View>
              ))}
            </View>
          ) : null}
          <View className="mt-6 w-full max-w-sm">
            <TextField
              label={strings.notes.label}
              multiline
              numberOfLines={3}
              value={noteText}
              onChangeText={setNoteText}
              placeholder={strings.notes.placeholder}
              textAlignVertical="top"
            />
          </View>
          <View className="mt-6 w-full max-w-sm">
            <Button
              label={strings.common.done}
              onPress={() => {
                void (async () => {
                  if (rt?.sessionId) {
                    try {
                      await saveSessionNote(database, rt.sessionId, noteText);
                    } catch {
                      // Best-effort: never block leaving the summary over a note write.
                    }
                  }
                  setSession(null, null);
                  pop();
                })();
              }}
            />
          </View>
        </Enter>
      </Screen>
    );
  }

  return (
    <Screen>
      <AppHeader
        title={definition.name}
        onBack={pop}
        right={
          <Button label={strings.workout.discard} variant="danger" onPress={onDiscard} className="mr-1 px-2" />
        }
      />
      <View className="flex-1">
        <ScrollView contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        <View className="px-4 pt-4">
          <View className="flex-row items-center justify-between gap-2">
            <Text className="flex-1 text-overline uppercase text-dim" numberOfLines={1}>
              {strings.workout.block} {cursor.blockIndex + 1}/{definition.blocks.length}
              {block ? ` · ${block.name}` : ''}
            </Text>
            <Badge
              label={`${strings.workout.round} ${cursor.round}/${block?.rounds ?? 1}`}
              tone="neutral"
            />
          </View>

          {currentStep ? (
            <View
              testID="step-header"
              accessible
              accessibilityRole="header"
              accessibilityLiveRegion="polite"
              accessibilityLabel={stepHeaderText}
              className="mt-2"
            >
              <Text className="text-title text-fg" numberOfLines={2}>
                {currentStep.exerciseName || strings.common.none}
              </Text>
              <View className="mt-1 flex-row items-center gap-2">
                <Text className="text-caption text-dim" testID="step-position">
                  {stepPositionLabel(cursor.stepIndex, block?.steps.length ?? 0)}
                </Text>
                {block && block.kind !== 'normal' ? (
                  <Badge label={strings.routines.blockKind[block.kind]} tone="accent" />
                ) : null}
              </View>
            </View>
          ) : null}

          {currentStep ? (
            <View
              testID="session-progress-panel"
              className={`mt-3 rounded-lg border px-2 py-2 ${flash ? 'bg-success/10' : 'bg-transparent'}`}
              style={{
                borderColor: flash ? theme.semantic.success : theme.semantic.border,
              }}
            >
              <Progress
                value={progress.ratio}
                label={`${progress.doneSets} ${strings.workout.of} ${progress.totalSets} ${strings.workout.plannedSets}`}
                testID="session-progress"
              />
              <View className="mt-1.5 flex-row items-center justify-between">
                <Text className="font-mono text-body text-fg" testID="set-position">
                  {setPositionLabel(cursor.setIndex, targetSets)}
                </Text>
                <Text
                  className={`text-caption ${flash ? 'text-success' : 'text-dim'}`}
                  testID="session-progress-count"
                >
                  {progress.doneSets}/{progress.totalSets} {strings.workout.plannedSets}
                </Text>
              </View>
            </View>
          ) : null}
        </View>

        {hasTimer && cursor.timer ? (
          <Enter key={`rest-${cursor.timer.expiresAt}`} className="mt-6 px-4">
            <Card tone="accent" testID="rest-card">
              <View className="flex-row items-center justify-between gap-2">
                <View className="flex-row items-center gap-2">
                  <View
                    testID="rest-state-dot"
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: restPaused ? theme.semantic.warning : theme.semantic.primary }}
                  />
                  <Text className="text-heading uppercase text-accent-ink">{restKind}</Text>
                </View>
                {restPaused ? <Badge label={strings.workout.paused} tone="strong" testID="rest-paused" /> : null}
              </View>
              <Text
                testID="rest-countdown"
                accessible
                accessibilityRole="timer"
                accessibilityLiveRegion="polite"
                accessibilityValue={{ text: restCountdown }}
                accessibilityLabel={`${restKind} ${restCountdown}${restPaused ? `, ${strings.workout.paused}` : ''}`}
                className={`mt-1 font-mono text-metric-xl ${restPaused ? 'text-warning' : 'text-fg'}`}
              >
                {restCountdown}
              </Text>
              <View className="mt-2.5">
                <Progress
                  value={cursor.timer.durationMs > 0 ? Math.max(0, Math.min(1, timerRemainingMs / cursor.timer.durationMs)) : 0}
                  label={`${restKind} ${restCountdown}`}
                  testID="rest-progress"
                />
              </View>
              {restTargetStep ? (
                <View className="mt-3 rounded-lg border border-line bg-bg px-3 py-2">
                  <Text className="text-overline uppercase text-dim" numberOfLines={1}>
                    {strings.workout.nextUp}: {restTargetStep.exerciseName}
                  </Text>
                  <Text className="mt-0.5 font-mono text-body text-fg" numberOfLines={1}>
                    {prescriptionSummary(restTargetStep.prescription)}
                  </Text>
                </View>
              ) : (
                <Text className="mt-3 text-caption text-dim">{strings.workout.next}</Text>
              )}
              <View className="mt-4 flex-row gap-2">
                <Button
                  label={restPaused ? strings.workout.resume : strings.workout.pause}
                  variant="secondary"
                  onPress={onPauseResume}
                  disabled={busy}
                  className="flex-1"
                />
                <Button label={strings.workout.skipRest} variant="secondary" onPress={onSkip} disabled={busy} className="flex-1" />
              </View>
            </Card>
          </Enter>
          ) : currentStep ? (
          <Enter key={posKey} className="mt-6 px-4">
            <Card tone="default" testID="step-card">
              {showInterval && intervalSpec ? (
                <View className="mt-4">
                  {intervalRt.status === 'idle' ? (
                    <IntervalReadyCard
                      spec={intervalSpec}
                      onStart={onStartInterval}
                      disabled={busy}
                    />
                  ) : (
                    <IntervalActiveCard
                      spec={intervalSpec}
                      runtime={intervalRt}
                      now={intervalNow}
                      onCancel={onCancelInterval}
                      onRestart={onRestartInterval}
                      onSkip={onSkipIntervalPhase}
                      onFinishWork={onFinishIntervalWork}
                      onComplete={() => void apply({ type: 'SKIP_STEP', now: Date.now() })}
                      busy={busy}
                    />
                  )}
                </View>
              ) : null}

              {!showInterval ? (
                <>
              <View className="-mt-4">
                <SectionHeader title={strings.workout.target} />
              </View>
              <View className="flex-row flex-wrap gap-2">
                {currentStep.prescription.targetSets !== null ? (
                  <TargetTile
                    label={strings.routines.prescription.sets}
                    value={String(currentStep.prescription.targetSets)}
                  />
                ) : null}
                {currentStep.prescription.targetRepsMin !== null ? (
                  <TargetTile
                    label={strings.routines.prescription.reps}
                    value={`${currentStep.prescription.targetRepsMin}${
                      currentStep.prescription.targetRepsMax !== null ? `–${currentStep.prescription.targetRepsMax}` : ''
                    }`}
                  />
                ) : null}
                {currentStep.prescription.targetWeightGrams !== null ? (
                  <TargetTile
                    label={strings.exercises.metricWeight}
                    value={formatKg(currentStep.prescription.targetWeightGrams)}
                    unit={strings.workout.weight}
                  />
                ) : null}
                {currentStep.prescription.targetDurationMs !== null ? (
                  <TargetTile
                    label={strings.exercises.metricDuration}
                    value={String(Math.round(currentStep.prescription.targetDurationMs / 1000))}
                    unit={strings.units.seconds}
                  />
                ) : null}
                {currentStep.prescription.targetRir !== null ? (
                  <TargetTile label={strings.workout.rir} value={String(currentStep.prescription.targetRir)} />
                ) : null}
                <TargetTile label={strings.workout.tempo} value={formatTempo(currentStep.prescription.tempo)} />
              </View>

              {currentStep.prescription.targetRir !== null ? (
                <Pressable
                  testID="autoreg-switch"
                  accessibilityRole="switch"
                  accessibilityState={{ checked: autoregEnabled }}
                  accessibilityLabel={strings.autoreg.title}
                  accessibilityHint={strings.autoreg.hint}
                  onPress={() => setAutoregEnabled((v) => !v)}
                  style={({ pressed }) => (pressed ? { opacity: 0.8 } : undefined)}
                  className="mt-3 min-h-12 flex-row items-center justify-between rounded-lg border border-line bg-surface-2 px-3 py-2"
                >
                  <Text className="flex-1 pr-3 text-sm text-dim">{strings.autoreg.title}</Text>
                  <View
                    className={`h-6 w-11 flex-row items-center rounded-full border px-0.5 ${
                      autoregEnabled ? 'justify-end border-accent bg-accent/20' : 'justify-start border-line bg-surface'
                    }`}
                  >
                    <View
                      className="h-5 w-5 rounded-full"
                      style={{ backgroundColor: autoregEnabled ? theme.semantic.primary : theme.semantic.elevated }}
                    />
                  </View>
                </Pressable>
              ) : null}

              {autoregEnabled && autoregSuggestion ? (
                <View className="mt-2 rounded-lg border border-accent/40 bg-accent/5 px-3 py-2">
                  <Text className="text-xs font-semibold uppercase tracking-wider text-accent-ink">
                    {strings.autoreg.recommendation}
                  </Text>
                  <Text className="mt-0.5 text-sm text-fg">
                    {autoregSuggestion.direction === 'increase'
                      ? strings.autoreg.increase
                      : autoregSuggestion.direction === 'decrease'
                        ? strings.autoreg.decrease
                        : strings.autoreg.hold}
                    {autoregSuggestion.deltaGrams !== 0
                      ? ` · ${Math.abs(autoregSuggestion.deltaGrams) / 1000} ${strings.workout.weight}`
                      : ''}
                    {autoregSuggestion.recommendedWeightGrams > 0
                      ? ` → ${gramsToKg(autoregSuggestion.recommendedWeightGrams)} ${strings.workout.weight}`
                      : ''}
                  </Text>
                </View>
              ) : null}

              {showTempo ? (
                <View className="mt-4">
                  {tempo.status === 'idle' ? (
                    <TempoReadyCard
                      tempo={currentStep.prescription.tempo}
                      onStart={onStartTempo}
                      disabled={busy}
                    />
                  ) : (
                    <TempoActiveCard
                      tempo={currentStep.prescription.tempo}
                      runtime={tempo}
                      now={tempoNow}
                      onCancel={onCancelTempo}
                      onRestart={onRestartTempo}
                      busy={busy}
                    />
                  )}
                </View>
              ) : null}

              <SectionHeader
                title={strings.workout.actual}
                right={
                  <Text
                    testID="target-summary"
                    numberOfLines={1}
                    className="flex-1 pl-2 text-right text-caption text-dim"
                  >
                    {prescriptionSummary(currentStep.prescription)}
                  </Text>
                }
              />
              <View className="flex-row gap-3">
                <NumpadField
                  testID="field-weight"
                  label={strings.routines.prescription.weight}
                  display={weightKg}
                  suffix={strings.workout.weight}
                  active={activeField === 'weight'}
                  onPress={() => setActiveField('weight')}
                />
                <NumpadField
                  testID="field-reps"
                  label={strings.routines.prescription.reps}
                  display={reps}
                  active={activeField === 'reps'}
                  onPress={() => setActiveField('reps')}
                />
              </View>
              <View className="mt-3 flex-row gap-3">
                <NumpadField
                  testID="field-duration"
                  label={strings.routines.prescription.duration}
                  display={durationS}
                  suffix={strings.units.seconds}
                  active={activeField === 'duration'}
                  onPress={() => setActiveField('duration')}
                />
                <NumpadField
                  testID="field-rir"
                  label={strings.workout.rir}
                  display={rir}
                  active={activeField === 'rir'}
                  onPress={() => setActiveField('rir')}
                />
              </View>

              {step && inputsDiffer ? (
                <View className="mt-3" testID="override-reasons">
                  <Text className="text-xs font-semibold uppercase tracking-wider text-dim">
                    {strings.workout.reasonLabel}
                  </Text>
                  <View className="mt-2 flex-row flex-wrap gap-2">
                    {OVERRIDE_REASONS.map((reason) => {
                      const selected = overrideReason === reason;
                      return (
                        <Pressable
                          key={reason}
                          testID={`reason-${reason}`}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: selected }}
                          accessibilityLabel={overrideReasonLabel(reason)}
                          onPress={() => setOverrideReason((prev) => (prev === reason ? null : reason))}
                          disabled={busy}
                          className={`min-h-11 items-center justify-center rounded-lg border px-3 ${
                            selected ? 'border-accent bg-accent/20' : 'border-line bg-surface'
                          }`}
                        >
                          <Text className={`text-sm ${selected ? 'font-semibold text-accent-ink' : 'text-dim'}`}>
                            {overrideReasonLabel(reason)}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ) : null}

              <View className="mt-5">
                <Button label={strings.workout.completeSet} onPress={onComplete} disabled={busy || !inputsValid} />
              </View>
              <View className="mt-3">
                <Button label={strings.workout.skip} variant="secondary" onPress={onSkip} disabled={busy} />
              </View>
              <View className="mt-3 flex-row gap-2">
                <Button
                  label={strings.workout.skipSet}
                  variant="ghost"
                  onPress={onSkipSet}
                  disabled={busy}
                  className="flex-1"
                />
                <Button
                  label={strings.workout.extraSet}
                  variant="ghost"
                  onPress={() => onExtraSet('extra')}
                  disabled={busy || !inputsValid}
                  className="flex-1"
                />
                <Button
                  label={strings.workout.dropSet}
                  variant="ghost"
                  onPress={() => onExtraSet('drop')}
                  disabled={busy || !inputsValid}
                  className="flex-1"
                />
              </View>
                </>
              ) : null}
            </Card>
          </Enter>
        ) : (
          <View className="mt-6 px-4">
            <EmptyState message={strings.workout.emptyRoutine} />
          </View>
        )}

        <View className="mt-5 px-4">
          <Divider />
        </View>
        <View className="mt-4 px-4">
          <Button label={strings.workout.finish} variant="secondary" onPress={onFinish} disabled={busy} />
        </View>
        <View className="mt-2 px-4">
          <Button label={strings.workout.undo} variant="ghost" onPress={onUndo} disabled={busy || !canUndo} />
        </View>
        {error ? (
          <View className="mt-4 px-4">
            <Text className="text-sm text-danger">{error}</Text>
          </View>
        ) : null}
        </ScrollView>
        {showNumpad ? (
          <Numpad
            field={activeField}
            onKey={onNumpadKey}
            onModifier={onNumpadModifier}
            onClear={onNumpadClear}
            disabled={busy}
          />
        ) : null}
      </View>
    </Screen>
  );
}
