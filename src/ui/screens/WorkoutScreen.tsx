import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, ScrollView, Text, View } from 'react-native';
import { database } from '../../data';
import { strings } from '../../constants/strings';
import { formatCountdown, formatKg, formatTempo, gramsToKg, kgToGrams, secondsToMs } from '../../utils/units';
import { useTimerStore } from '../../state/timerStore';
import { useActiveSessionStore } from '../../state/activeSessionStore';
import type { EngineEvent, SetPayload, StepDef } from '../../types/engine';
import {
  applyWorkoutEvent,
  discardWorkout,
  isTimerExpired,
  loadActiveWorkout,
  loadWorkoutRuntime,
  reconcileTimerNotification,
  type WorkoutRuntime,
} from '../../workout/runner';
import { useNav } from '../navigation';
import { AppHeader, Button, Card, ErrorState, LoadingState, Screen, SectionHeader, confirmDestructive } from '../components';
import { Numpad, NumpadField } from '../Numpad';
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

export function WorkoutScreen() {
  const { pop, setBackInterceptor } = useNav();
  const [rt, setRt] = useState<WorkoutRuntime | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [completedView, setCompletedView] = useState(false);
  const [inputs, setInputs] = useState<NumpadInput>(emptyInputs);
  const [activeField, setActiveField] = useState<NumpadFieldKey | null>(null);
  const busyRef = useRef(false);
  const rtRef = useRef<WorkoutRuntime | null>(null);
  rtRef.current = rt;

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
      return;
    }
    const p = step.prescription;
    setInputs({
      weightKg: p.targetWeightGrams !== null ? String(gramsToKg(p.targetWeightGrams) ?? '') : '',
      reps: p.targetRepsMin !== null ? String(p.targetRepsMin) : '',
      durationS: p.targetDurationMs !== null ? String(Math.round(p.targetDurationMs / 1000)) : '',
      rir: p.targetRir !== null ? String(p.targetRir) : '',
    });
    setActiveField('weight');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posKey]);

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
    [setSession, timer],
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
    if (!step || !inputsValid) return;
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
  const showNumpad = cursor.status === 'active' && !!currentStep && !hasTimer;

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
