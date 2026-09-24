import { Text, View } from 'react-native';
import { strings } from '../constants/strings';
import { formatTempo } from '../utils/units';
import type { TempoSpec } from '../types/engine';
import {
  currentTempoPhase,
  formatPhaseCountdown,
  phaseRemainingMs,
  type TempoRuntime,
} from '../tempo/tempoTrainer';
import { Button } from './components';

/**
 * AMOLED tempo execution panel. Pure display — timing owned by tempoTrainer timestamps.
 * Touch targets ≥48dp; phase meaning is label + position, not color-only.
 */

const PHASE_ORDER = ['eccentric', 'pauseBottom', 'concentric', 'pauseTop'] as const;

function phaseLabel(id: NonNullable<ReturnType<typeof currentTempoPhase>>): string {
  return strings.tempo.phases[id];
}

function phaseDotLabel(id: (typeof PHASE_ORDER)[number]): string {
  return strings.tempo.phaseDots[id];
}

export function TempoReadyCard({
  tempo,
  onStart,
  disabled,
}: {
  tempo: TempoSpec;
  onStart: () => void;
  disabled?: boolean;
}) {
  return (
    <View className="rounded-xl border border-line bg-surface p-4" testID="tempo-ready">
      <View className="flex-row items-center justify-between">
        <Text className="text-xs font-semibold uppercase tracking-wider text-accent">
          {strings.tempo.title}
        </Text>
        <Text className="font-mono text-sm text-dim">{formatTempo(tempo)}</Text>
      </View>
      <View className="mt-3">
        <Button label={strings.tempo.start} onPress={onStart} disabled={disabled} />
      </View>
    </View>
  );
}

export function TempoActiveCard({
  tempo,
  runtime,
  now,
  onCancel,
  onRestart,
  busy,
}: {
  tempo: TempoSpec;
  runtime: TempoRuntime;
  now: number;
  onCancel: () => void;
  onRestart: () => void;
  busy?: boolean;
}) {
  const completed = runtime.status === 'completed';
  const phase = currentTempoPhase(runtime);
  const remainingMs = phaseRemainingMs(runtime, now);
  const activeIndex = runtime.status === 'running' ? runtime.phaseIndex : runtime.phases.length - 1;

  // Map prescription phase id → position among all four (including zero-length) for the strip.
  const prescribedIds = PHASE_ORDER.filter((id) => {
    const map = {
      eccentric: tempo.eccentricMs,
      pauseBottom: tempo.pauseBottomMs,
      concentric: tempo.concentricMs,
      pauseTop: tempo.pauseTopMs,
    } as const;
    return (map[id] ?? 0) > 0;
  });

  return (
    <View
      className={`rounded-xl border p-4 ${completed ? 'border-success/60 bg-surface' : 'border-accent/50 bg-surface'}`}
      testID="tempo-active"
      accessibilityLabel={strings.tempo.title}
    >
      <View className="flex-row items-center justify-between">
        <Text className="text-xs font-semibold uppercase tracking-wider text-accent">
          {strings.tempo.title}
        </Text>
        <Text className="font-mono text-sm text-dim">{formatTempo(tempo)}</Text>
      </View>

      {completed ? (
        <Text className="mt-3 text-3xl font-bold text-success" testID="tempo-complete">
          {strings.tempo.complete}
        </Text>
      ) : (
        <>
          <Text className="mt-3 text-sm text-dim">{strings.tempo.currentPhase}</Text>
          <Text
            className="text-2xl font-bold tracking-wide text-fg"
            testID="tempo-phase-label"
            accessibilityRole="text"
          >
            {phase ? phaseLabel(phase) : strings.tempo.ready}
          </Text>
          <Text
            className="mt-1 font-mono text-6xl font-bold text-fg"
            testID="tempo-countdown"
            accessibilityLabel={formatPhaseCountdown(remainingMs)}
          >
            {formatPhaseCountdown(remainingMs)}
          </Text>
        </>
      )}

      {/* Position strip: active index highlight via accent underline, not color-only meaning */}
      <View className="mt-4 flex-row gap-2" accessibilityRole="progressbar">
        {prescribedIds.map((id, i) => {
          const isCurrent = !completed && runtime.status === 'running' && i === activeIndex && prescribedIds[activeIndex] === id;
          const isPast = completed || (runtime.status === 'running' && i < activeIndex);
          return (
            <View key={id} className="min-h-12 flex-1 items-center justify-center rounded-lg border border-line bg-surface-2 px-1 py-2"
              style={{ minHeight: 48 }}
            >
              <Text className={`text-[10px] leading-tight ${isCurrent ? 'font-semibold text-accent' : isPast ? 'text-dim' : 'text-dim'}`}>
                {phaseDotLabel(id)}
              </Text>
              {isCurrent ? <View className="mt-1 h-0.5 w-full bg-accent" /> : null}
            </View>
          );
        })}
      </View>

      <View className="mt-4 flex-row gap-2">
        <View className="flex-1">
          <Button
            label={completed ? strings.tempo.restart : strings.tempo.cancel}
            variant="secondary"
            onPress={completed ? onRestart : onCancel}
            disabled={busy}
          />
        </View>
        {!completed ? (
          <View className="flex-1">
            <Button label={strings.tempo.restart} variant="ghost" onPress={onRestart} disabled={busy} />
          </View>
        ) : null}
      </View>
    </View>
  );
}
