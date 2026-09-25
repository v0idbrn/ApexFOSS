import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { database } from '../../data';
import { makeDbActions, newLocalId } from '../../data/actions';
import type { BlockKind, IntervalSpec, TransitionType } from '../../types/engine';
import { emptyDraft, emptyPrescription, defaultIntervalSpec, type RoutineDraft } from '../../types/draft';
import { strings } from '../../constants/strings';
import { gramsToKg, kgToGrams, msToSeconds, secondsToMs, formatTempo } from '../../utils/units';
import { useNav } from '../navigation';
import { ExercisePickerScreen } from './ExercisePickerScreen';
import {
  AppHeader,
  Button,
  Card,
  Chip,
  NumberField,
  PressableRow,
  Screen,
  SectionHeader,
  TextField,
  confirmDestructive,
} from '../components';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const BLOCK_KINDS: BlockKind[] = ['normal', 'superset', 'contrast', 'circuit', 'interval'];
const TRANSITIONS: { type: TransitionType; label: string }[] = [
  { type: 'immediate', label: strings.routines.transition.immediate },
  { type: 'rest', label: strings.routines.transition.rest },
  { type: 'auto_advance', label: strings.routines.transition.auto },
];

export function RoutineEditorScreen({ routineId }: { routineId: string | null }) {
  const { pop, push, setBackInterceptor } = useNav();
  const [draft, setDraft] = useState<RoutineDraft>(() => emptyDraft());
  const [loading, setLoading] = useState(routineId !== null);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pickerFor, setPickerFor] = useState<string | null>(null); // localId of step awaiting exercise
  const baseline = useRef<string>(JSON.stringify(emptyDraft()));
  const dirty = useMemo(() => JSON.stringify(draft) !== baseline.current, [draft]);

  const load = useCallback(async () => {
    if (!routineId) {
      baseline.current = JSON.stringify(emptyDraft());
      setDraft(emptyDraft());
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const d = await makeDbActions(database).loadRoutineDraft(routineId);
      setDraft(d);
      baseline.current = JSON.stringify(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [routineId]);

  useEffect(() => {
    load();
  }, [load]);

  const requestClose = useCallback(() => {
    if (!dirty) {
      pop();
      return;
    }
    Alert.alert(strings.common.discardChanges, undefined, [
      { text: strings.common.keepEditing, style: 'cancel' },
      { text: strings.common.discard, style: 'destructive', onPress: pop },
    ]);
  }, [dirty, pop]);

  useEffect(() => {
    setBackInterceptor(dirty ? () => {
      requestClose();
      return true;
    } : null);
    return () => setBackInterceptor(null);
  }, [dirty, requestClose, setBackInterceptor]);

  const save = async () => {
    const name = draft.name.trim();
    if (!name) {
      setNameError(strings.routines.nameRequired);
      return;
    }
    setNameError(null);
    setSaving(true);
    setError(null);
    try {
      const id = await makeDbActions(database).saveRoutineDraft({ ...draft, name });
      baseline.current = JSON.stringify({ ...draft, name, id });
      setDraft((d) => ({ ...d, name, id }));
      pop();
    } catch (e) {
      setError(e instanceof Error ? `${strings.routines.saveFailed}: ${e.message}` : String(e));
    } finally {
      setSaving(false);
    }
  };

  const update = (fn: (d: RoutineDraft) => RoutineDraft) => setDraft((d) => fn(clone(d)));

  const preview = () => {
    const name = draft.name.trim();
    if (!name) {
      setNameError(strings.routines.nameRequired);
      return;
    }
    push({ name: 'routinePreview', draft: { ...draft, name } });
  };

  const addBlock = () =>
    update((d) => ({
      ...d,
      blocks: [
        ...d.blocks,
        {
          localId: newLocalId('blk'),
          name: `${strings.routines.blockName} ${d.blocks.length + 1}`,
          kind: 'normal',
          rounds: 1,
          steps: [],
          interval: null,
        },
      ],
    }));

  const removeBlock = (blockIdx: number) =>
    confirmDestructive(strings.routines.deleteBlock, () =>
      update((d) => ({ ...d, blocks: d.blocks.filter((_, i) => i !== blockIdx) })),
    );

  const addStep = (blockIdx: number, exerciseId: string, exerciseName: string) =>
    update((d) => {
      const blocks = [...d.blocks];
      const block = { ...blocks[blockIdx] };
      const last = block.steps[block.steps.length - 1];
      block.steps = [
        ...block.steps,
        {
          localId: newLocalId('stp'),
          exerciseId,
          exerciseName,
          prescription: emptyPrescription(),
          transition: last
            ? { ...last.transition }
            : { type: 'rest' as TransitionType, delayMs: 90_000 },
        },
      ];
      blocks[blockIdx] = block;
      return { ...d, blocks };
    });

  const removeStep = (blockIdx: number, stepIdx: number) =>
    confirmDestructive(strings.routines.deleteStep, () =>
      update((d) => {
        const blocks = [...d.blocks];
        const block = { ...blocks[blockIdx] };
        block.steps = block.steps.filter((_, i) => i !== stepIdx);
        blocks[blockIdx] = block;
        return { ...d, blocks };
      }),
    );

  const patchStep = (blockIdx: number, stepIdx: number, fn: (s: RoutineDraft['blocks'][number]['steps'][number]) => void) =>
    update((d) => {
      const blocks = [...d.blocks];
      const block = { ...blocks[blockIdx] };
      const steps = [...block.steps];
      const step = { ...steps[stepIdx], prescription: { ...steps[stepIdx].prescription, tempo: { ...steps[stepIdx].prescription.tempo } }, transition: { ...steps[stepIdx].transition } };
      fn(step);
      steps[stepIdx] = step;
      block.steps = steps;
      blocks[blockIdx] = block;
      return { ...d, blocks };
    });

  const patchBlock = (blockIdx: number, fn: (b: RoutineDraft['blocks'][number]) => void) =>
    update((d) => {
      const blocks = [...d.blocks];
      const block = { ...blocks[blockIdx] };
      fn(block);
      blocks[blockIdx] = block;
      return { ...d, blocks };
    });

  const remove = () => {
    if (!routineId) return;
    confirmDestructive(`${strings.routines.deleteConfirm}\n\n${draft.name}`, async () => {
      try {
        await makeDbActions(database).deleteRoutine(routineId);
        pop();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  if (loading) {
    return (
      <Screen>
        <AppHeader title={strings.routines.editTitle} onBack={pop} />
        <View className="items-center py-8">
          <Text className="text-dim">{strings.common.loading}</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <AppHeader
        title={routineId ? draft.name || strings.routines.editTitle : strings.routines.newRoutine}
        onBack={requestClose}
        right={
          <View className="flex-row items-center">
            <Text
              accessibilityRole="button"
              accessibilityLabel={strings.preview.open}
              onPress={preview}
              className="flex-row items-center px-3 text-base font-semibold text-dim"
              style={{ minHeight: 48 }}
            >
              {strings.preview.open}
            </Text>
            <Text
              accessibilityRole="button"
              accessibilityLabel={strings.common.save}
              onPress={save}
              className="flex-row items-center px-4 text-base font-semibold text-accent-ink"
              style={{ minHeight: 48 }}
            >
              {saving ? strings.common.saving : strings.common.save}
            </Text>
          </View>
        }
      />
      <ScrollView contentContainerClassName="gap-4 p-4 pb-12" keyboardShouldPersistTaps="handled">
        {error ? <Text className="text-sm text-danger">{error}</Text> : null}
        <TextField
          label={strings.routines.name}
          value={draft.name}
          onChangeText={(t) => {
            setDraft((d) => ({ ...d, name: t }));
            if (nameError && t.trim()) setNameError(null);
          }}
          error={nameError}
          placeholder={strings.routines.untitledRoutine}
        />

        {draft.blocks.map((block, bi) => (
          <Card key={block.localId}>
            <View className="mb-3 flex-row items-center justify-between">
              <Text className="text-xs font-semibold uppercase tracking-wider text-dim">
                {strings.routines.blockKind[block.kind]} {bi + 1}
              </Text>
              <Text
                accessibilityRole="button"
                accessibilityLabel={strings.common.delete}
                onPress={() => removeBlock(bi)}
                className="h-12 flex-row items-center px-2 text-sm text-danger"
              >
                {strings.common.delete}
              </Text>
            </View>

            <TextField
              label={strings.routines.blockName}
              value={block.name}
              onChangeText={(t) => patchBlock(bi, (b) => { b.name = t; })}
            />

            <View className="mt-3">
              <Text className="mb-2 text-sm text-dim">{strings.routines.kind}</Text>
              <View className="flex-row flex-wrap gap-2">
                {BLOCK_KINDS.map((k) => (
                  <Chip
                    key={k}
                    label={strings.routines.blockKind[k]}
                    active={block.kind === k}
                    onPress={() =>
                      patchBlock(bi, (b) => {
                        b.kind = k;
                        if (k === 'interval') {
                          b.rounds = 1;
                          if (!b.interval) b.interval = defaultIntervalSpec();
                        }
                      })
                    }
                  />
                ))}
              </View>
            </View>

            <View className="mt-3 max-w-32">
              <NumberField
                label={strings.routines.rounds}
                value={block.rounds}
                onChange={(v) =>
                  patchBlock(bi, (b) => {
                    if (b.kind === 'interval') return;
                    b.rounds = Math.max(1, Math.round(v ?? 1));
                  })
                }
              />
            </View>

            {block.kind === 'interval' ? (
              <View className="mt-3 rounded-lg border border-line bg-surface-2 p-3">
                <SectionHeader title={strings.interval.title} />
                <View className="mb-2 flex-row flex-wrap gap-2">
                  {(['hiit', 'emom', 'glycolytic'] as const).map((m) => (
                    <Chip
                      key={m}
                      label={strings.interval.modes[m]}
                      active={(block.interval?.mode ?? 'hiit') === m}
                      onPress={() =>
                        patchBlock(bi, (b) => {
                          const base = b.interval ?? defaultIntervalSpec();
                          b.interval = {
                            ...base,
                            mode: m,
                            periodMs: m === 'emom' ? base.periodMs ?? 60_000 : null,
                          } satisfies IntervalSpec;
                        })
                      }
                    />
                  ))}
                </View>
                <View className="flex-row flex-wrap gap-2">
                  <View className="w-24">
                    <NumberField
                      label={strings.interval.editor.rounds}
                      value={block.interval?.rounds ?? 8}
                      onChange={(v) =>
                        patchBlock(bi, (b) => {
                          b.interval = {
                            ...(b.interval ?? defaultIntervalSpec()),
                            rounds: Math.max(1, Math.round(v ?? 1)),
                          };
                        })
                      }
                    />
                  </View>
                  <View className="w-24">
                    <NumberField
                      label={strings.interval.editor.work}
                      value={Math.round((block.interval?.workMs ?? 30_000) / 1000)}
                      onChange={(v) =>
                        patchBlock(bi, (b) => {
                          b.interval = {
                            ...(b.interval ?? defaultIntervalSpec()),
                            workMs: Math.max(0, Math.round((v ?? 0) * 1000)),
                          };
                        })
                      }
                    />
                  </View>
                  {block.interval?.mode !== 'emom' ? (
                    <View className="w-24">
                      <NumberField
                        label={strings.interval.editor.rest}
                        value={Math.round((block.interval?.restMs ?? 15_000) / 1000)}
                        onChange={(v) =>
                          patchBlock(bi, (b) => {
                            b.interval = {
                              ...(b.interval ?? defaultIntervalSpec()),
                              restMs: Math.max(0, Math.round((v ?? 0) * 1000)),
                            };
                          })
                        }
                      />
                    </View>
                  ) : (
                    <View className="w-24">
                      <NumberField
                        label={strings.interval.editor.period}
                        value={Math.round((block.interval?.periodMs ?? 60_000) / 1000)}
                        onChange={(v) =>
                          patchBlock(bi, (b) => {
                            b.interval = {
                              ...(b.interval ?? defaultIntervalSpec()),
                              periodMs: Math.max(1, Math.round((v ?? 60) * 1000)),
                            };
                          })
                        }
                      />
                    </View>
                  )}
                  <View className="w-24">
                    <NumberField
                      label={strings.interval.editor.prep}
                      value={Math.round((block.interval?.preparationMs ?? 0) / 1000)}
                      onChange={(v) =>
                        patchBlock(bi, (b) => {
                          b.interval = {
                            ...(b.interval ?? defaultIntervalSpec()),
                            preparationMs: Math.max(0, Math.round((v ?? 0) * 1000)),
                          };
                        })
                      }
                    />
                  </View>
                </View>
                <Text className="mt-2 text-xs text-dim">
                  {block.interval?.mode === 'emom'
                    ? strings.interval.editor.periodHint
                    : `${strings.interval.modes[block.interval?.mode ?? 'hiit']} · ${Math.round((block.interval?.workMs ?? 0) / 1000)}s / ${Math.round((block.interval?.restMs ?? 0) / 1000)}s × ${block.interval?.rounds ?? 1}`}
                </Text>
                {block.interval?.mode === 'emom' ? (
                  <Text className="mt-1 text-xs text-dim">{strings.interval.editor.workHint}</Text>
                ) : null}
              </View>
            ) : null}

            <SectionHeader title={strings.routines.steps} />

            {block.steps.length === 0 ? (
              <Text className="mb-2 text-sm text-dim">{strings.routines.noSteps}</Text>
            ) : (
              block.steps.map((step, si) => (
                <View key={step.localId} className="mb-3 rounded-lg border border-line bg-surface-2 p-3">
                  <View className="mb-3 flex-row items-center justify-between">
                    <Text className="text-sm font-semibold text-dim">
                      {strings.routines.step} {si + 1}
                    </Text>
                    <Text
                      accessibilityRole="button"
                      accessibilityLabel={`${strings.common.delete} ${strings.routines.step} ${si + 1}`}
                      onPress={() => removeStep(bi, si)}
                      className="h-12 flex-row items-center px-2 text-sm text-danger"
                    >
                      {strings.common.delete}
                    </Text>
                  </View>

                  <PressableRow
                    label={strings.routines.exercise}
                    value={step.exerciseName || strings.routines.selectExercise}
                    placeholder={!step.exerciseName}
                    onPress={() => setPickerFor(step.localId)}
                  />

                  <SectionHeader title={strings.routines.prescription.title} />
                  <View className="flex-row flex-wrap gap-2">
                    <View className="w-20">
                      <NumberField
                        label={strings.routines.prescription.sets}
                        value={step.prescription.targetSets}
                        onChange={(v) => patchStep(bi, si, (s) => { s.prescription.targetSets = v === null ? null : Math.max(1, Math.round(v)); })}
                      />
                    </View>
                    <View className="w-20">
                      <NumberField
                        label={strings.routines.prescription.repsMin}
                        value={step.prescription.targetRepsMin}
                        onChange={(v) => patchStep(bi, si, (s) => { s.prescription.targetRepsMin = v === null ? null : Math.max(0, Math.round(v)); })}
                      />
                    </View>
                    <View className="w-20">
                      <NumberField
                        label={strings.routines.prescription.repsMax}
                        value={step.prescription.targetRepsMax}
                        onChange={(v) => patchStep(bi, si, (s) => { s.prescription.targetRepsMax = v === null ? null : Math.max(0, Math.round(v)); })}
                      />
                    </View>
                    <View className="w-24">
                      <NumberField
                        label={strings.routines.prescription.weight}
                        suffix="kg"
                        value={gramsToKg(step.prescription.targetWeightGrams)}
                        onChange={(v) => patchStep(bi, si, (s) => { s.prescription.targetWeightGrams = v === null ? null : kgToGrams(v); })}
                      />
                    </View>
                    <View className="w-24">
                      <NumberField
                        label={strings.routines.prescription.duration}
                        suffix="s"
                        value={msToSeconds(step.prescription.targetDurationMs)}
                        onChange={(v) => patchStep(bi, si, (s) => { s.prescription.targetDurationMs = v === null ? null : secondsToMs(v); })}
                      />
                    </View>
                    <View className="w-20">
                      <NumberField
                        label={strings.routines.prescription.rir}
                        value={step.prescription.targetRir}
                        onChange={(v) => patchStep(bi, si, (s) => { s.prescription.targetRir = v === null ? null : Math.max(0, Math.round(v)); })}
                      />
                    </View>
                  </View>

                  <SectionHeader title={strings.routines.prescription.tempo} />
                  <Text className="mb-2 font-mono text-sm text-accent-ink">
                    {formatTempo(step.prescription.tempo)}
                  </Text>
                  <View className="flex-row flex-wrap gap-2">
                    <View className="w-20">
                      <NumberField
                        label={strings.routines.prescription.tempoEcc}
                        value={msToSeconds(step.prescription.tempo.eccentricMs)}
                        onChange={(v) => patchStep(bi, si, (s) => { s.prescription.tempo.eccentricMs = v === null ? null : secondsToMs(v); })}
                      />
                    </View>
                    <View className="w-20">
                      <NumberField
                        label={strings.routines.prescription.tempoPauseBottom}
                        value={msToSeconds(step.prescription.tempo.pauseBottomMs)}
                        onChange={(v) => patchStep(bi, si, (s) => { s.prescription.tempo.pauseBottomMs = v === null ? null : secondsToMs(v); })}
                      />
                    </View>
                    <View className="w-20">
                      <NumberField
                        label={strings.routines.prescription.tempoCon}
                        value={msToSeconds(step.prescription.tempo.concentricMs)}
                        onChange={(v) => patchStep(bi, si, (s) => { s.prescription.tempo.concentricMs = v === null ? null : secondsToMs(v); })}
                      />
                    </View>
                    <View className="w-20">
                      <NumberField
                        label={strings.routines.prescription.tempoPauseTop}
                        value={msToSeconds(step.prescription.tempo.pauseTopMs)}
                        onChange={(v) => patchStep(bi, si, (s) => { s.prescription.tempo.pauseTopMs = v === null ? null : secondsToMs(v); })}
                      />
                    </View>
                  </View>

                  <SectionHeader title={strings.routines.transition.title} />
                  <View className="flex-row flex-wrap gap-2">
                    {TRANSITIONS.map((t) => (
                      <Chip
                        key={t.type}
                        label={t.label}
                        active={step.transition.type === t.type}
                        onPress={() =>
                          patchStep(bi, si, (s) => {
                            s.transition.type = t.type;
                            if (t.type === 'immediate') s.transition.delayMs = 0;
                            else if (s.transition.delayMs <= 0) s.transition.delayMs = 90_000;
                          })
                        }
                      />
                    ))}
                  </View>
                  {step.transition.type !== 'immediate' ? (
                    <View className="mt-3 max-w-32">
                      <NumberField
                        label={strings.routines.transition.delaySeconds}
                        suffix="s"
                        value={Math.round(msToSeconds(step.transition.delayMs) ?? 0)}
                        onChange={(v) =>
                          patchStep(bi, si, (s) => {
                            s.transition.delayMs = secondsToMs(Math.max(0, v ?? 0));
                          })
                        }
                      />
                    </View>
                  ) : null}
                </View>
              ))
            )}

            <Button
              label={strings.routines.addStep}
              variant="secondary"
              onPress={() => setPickerFor(`__block__${bi}`)}
            />
          </Card>
        ))}

        <Button label={strings.routines.newBlock} variant="secondary" onPress={addBlock} />
        <Button label={saving ? strings.common.saving : strings.common.save} onPress={save} disabled={saving} />
        {routineId ? (
          <View className="mt-6">
            <Button label={strings.common.delete} variant="danger" onPress={remove} />
          </View>
        ) : null}
      </ScrollView>

      {pickerFor ? (
        <ExercisePickerScreen
          onPick={(id, name) => {
            if (pickerFor.startsWith('__block__')) {
              const bi = Number(pickerFor.replace('__block__', ''));
              addStep(bi, id, name);
            } else {
              update((d) => {
                for (const block of d.blocks) {
                  const step = block.steps.find((s) => s.localId === pickerFor);
                  if (step) {
                    step.exerciseId = id;
                    step.exerciseName = name;
                  }
                }
                return d;
              });
            }
            setPickerFor(null);
          }}
          onCancel={() => setPickerFor(null)}
        />
      ) : null}
    </Screen>
  );
}
