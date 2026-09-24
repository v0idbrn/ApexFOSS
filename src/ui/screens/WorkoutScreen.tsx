import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Pressable, ScrollView, Text, View } from 'react-native';
import { database } from '../../data';
import { strings } from '../../constants/strings';
import { formatCountdown, formatKg, formatTempo, gramsToKg, kgToGrams, secondsToMs } from '../../utils/units';
import { useTimerStore } from '../../state/timerStore';
import { useActiveSessionStore } from '../../state/activeSessionStore';
import type { BlockDef, EngineEvent, IntervalSpec, PersistedInterval, SetPayload, StepDef } from '../../types/engine';
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
import { AppHeader, Button, Card, ErrorState, LoadingState, Screen, SectionHeader, confirmDestructive } from '../components';
import { Numpad, NumpadField } from '../Numpad';
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

const toPayload = (step: StepDef, input: NumpadInput): SetPayload => {
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
  };
};

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
  useEffect(() => {
    const c = rt?.cursor;
    if (!c || c.status !== 'active') return;
    void reconcileTimerNotification(rt.sessionId, c.timer, Date.now());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rt?.sessionId, rt?.cursor.timer?.expiresAt, rt?.cursor.status]);

  // Reset actual inputs whenever the target set/step changes.
  const step = rt && rt.cursor.status === 'active' ? rt.definition.blocks[rt.cursor.blockIndex]?.steps[rt.cursor.stepIndex] : undefined;
  const posKey = rt ? `${rt.cursor.blockIndex}:${rt.cursor.stepIndex}:${rt.cursor.round}:${rt.cursor.setIndex}` : '';
  useEffect(() => {
    if (!step) {
      setInputs(emptyInputs());
      setActiveField(null);
      setAutoregSuggestion(null);
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

  // Unmount: never leak keep-awake or leave a running tempo/interval reference.
  useEffect(() => {
    return () => {
      releaseTempoKeepAwake();
      releaseIntervalKeepAwake();
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
  const applyRef = useRef<(event: EngineEvent) => Promise<void>>(async () => {});
  useEffect(() => {
    const c = rt?.cursor;
    if (!c || c.status !== 'active' || !c.timer) {
      timer.clear();
      return;
    }
    timer.setFromCursor(c.timer);
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
  }, [rt?.cursor.timer?.expiresAt, rt?.cursor.timer?.kind, rt?.cursor.status]);

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
    void apply({ type: 'COMPLETE_SET', now: Date.now(), set: toPayload(step, inputs) });
  };

  const onSkip = () => {
    if (!rt) return;
    if (rt.cursor.timer) void apply({ type: 'SKIP_TIMER', now: Date.now() });
    else void apply({ type: 'SKIP_STEP', now: Date.now() });
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

  if (completedView || cursor.status === 'completed') {
    return (
      <Screen>
        <AppHeader title={definition.name} />
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-2xl font-bold text-fg">{strings.workout.sessionSaved}</Text>
          <Text className="mt-2 text-sm text-dim">{definition.name}</Text>
          <View className="mt-8 w-full max-w-sm">
            <Button
              label={strings.common.done}
              onPress={() => {
                setSession(null, null);
                pop();
              }}
            />
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <AppHeader
        title={definition.name}
        onBack={pop}
        right={
          <Button label={strings.workout.discard} variant="danger" onPress={onDiscard} className="mr-1 h-10 px-2" />
        }
      />
      <View className="flex-1">
        <ScrollView contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        <View className="px-4 pt-4">
          <View className="flex-row items-center justify-between">
            <Text className="text-sm text-dim">
              {strings.workout.block} {cursor.blockIndex + 1}/{definition.blocks.length}
              {block ? ` · ${block.name}` : ''}
            </Text>
            <Text className="text-sm text-dim">
              {strings.workout.round} {cursor.round}/{block?.rounds ?? 1}
            </Text>
          </View>
          <Text className="mt-1 text-sm text-dim">
            {strings.workout.set} {Math.min(cursor.setIndex, targetSets)} {strings.workout.of} {targetSets}
          </Text>
        </View>

        {hasTimer && cursor.timer ? (
          <View className="mt-6 px-4">
            <Card>
              <Text className="text-xs font-semibold uppercase tracking-wider text-accent">
                {cursor.timer.kind === 'rest' ? strings.timer.rest : strings.timer.autoAdvance}
              </Text>
              <Text className="mt-2 font-mono text-5xl font-bold text-fg">
                {formatCountdown(timer.remainingMs || Math.max(0, cursor.timer.expiresAt - Date.now()))}
              </Text>
              <Text className="mt-2 text-sm text-dim">
                {(() => {
                  const t = definition.blocks[cursor.timer.target.blockIndex]?.steps[cursor.timer.target.stepIndex];
                  return t ? `${strings.workout.next}: ${t.exerciseName}` : strings.workout.next;
                })()}
              </Text>
              <View className="mt-4">
                <Button label={strings.workout.skipRest} variant="secondary" onPress={onSkip} disabled={busy} />
              </View>
            </Card>
          </View>
        ) : currentStep ? (
          <View className="mt-6 px-4">
            <Card>
              <Text className="text-2xl font-bold text-fg">{currentStep.exerciseName || strings.common.none}</Text>
              <Text className="mt-1 text-sm text-dim">{block?.name}</Text>

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
              <SectionHeader title={strings.workout.target} />
              <View className="flex-row flex-wrap gap-2">
                {currentStep.prescription.targetSets !== null ? (
                  <Text className="text-sm text-dim">
                    {strings.routines.prescription.sets}: {currentStep.prescription.targetSets}
                  </Text>
                ) : null}
                {currentStep.prescription.targetRepsMin !== null ? (
                  <Text className="text-sm text-dim">
                    {strings.routines.prescription.reps}: {currentStep.prescription.targetRepsMin}
                    {currentStep.prescription.targetRepsMax !== null ? `–${currentStep.prescription.targetRepsMax}` : ''}
                  </Text>
                ) : null}
                {currentStep.prescription.targetWeightGrams !== null ? (
                  <Text className="text-sm text-dim">
                    {strings.routines.prescription.weight}: {formatKg(currentStep.prescription.targetWeightGrams)}
                  </Text>
                ) : null}
                {currentStep.prescription.targetDurationMs !== null ? (
                  <Text className="text-sm text-dim">
                    {strings.routines.prescription.duration}: {Math.round(currentStep.prescription.targetDurationMs / 1000)}s
                  </Text>
                ) : null}
                {currentStep.prescription.targetRir !== null ? (
                  <Text className="text-sm text-dim">
                    {strings.workout.rir}: {currentStep.prescription.targetRir}
                  </Text>
                ) : null}
                <Text className="text-sm text-dim">
                  {strings.workout.tempo}: {formatTempo(currentStep.prescription.tempo)}
                </Text>
              </View>

              {currentStep.prescription.targetRir !== null ? (
                <View className="mt-3 flex-row items-center justify-between rounded-lg border border-line bg-surface-2 px-3 py-2">
                  <Text className="text-sm text-dim">{strings.autoreg.title}</Text>
                  <Pressable
                    accessibilityRole="switch"
                    accessibilityState={{ checked: autoregEnabled }}
                    onPress={() => setAutoregEnabled((v) => !v)}
                    className={`min-h-8 rounded-full border px-3 ${
                      autoregEnabled ? 'border-accent bg-accent/20' : 'border-line bg-surface'
                    }`}
                  >
                    <Text className={`text-xs font-semibold ${autoregEnabled ? 'text-accent' : 'text-dim'}`}>
                      {autoregEnabled ? 'ON' : 'OFF'}
                    </Text>
                  </Pressable>
                </View>
              ) : null}

              {autoregEnabled && autoregSuggestion ? (
                <View className="mt-2 rounded-lg border border-accent/40 bg-accent/5 px-3 py-2">
                  <Text className="text-xs font-semibold uppercase tracking-wider text-accent">
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

              <SectionHeader title={strings.workout.actual} />
              <View className="flex-row gap-3">
                <NumpadField
                  testID="field-weight"
                  label={`${strings.routines.prescription.weight} (${strings.workout.weight})`}
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
                  label={`${strings.routines.prescription.duration} (${strings.units.seconds})`}
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

              <View className="mt-5">
                <Button label={strings.workout.completeSet} onPress={onComplete} disabled={busy || !inputsValid} />
              </View>
              <View className="mt-3">
                <Button label={strings.workout.skip} variant="secondary" onPress={onSkip} disabled={busy} />
              </View>
                </>
              ) : null}
            </Card>
          </View>
        ) : (
          <View className="mt-6 px-4">
            <Card>
              <Text className="text-base text-dim">{strings.workout.emptyRoutine}</Text>
            </Card>
          </View>
        )}

        <View className="mt-4 px-4">
          <Button label={strings.workout.undo} variant="ghost" onPress={onUndo} disabled={busy || !canUndo} />
        </View>
        <View className="mt-2 px-4">
          <Button label={strings.workout.finish} variant="secondary" onPress={onFinish} disabled={busy} />
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
