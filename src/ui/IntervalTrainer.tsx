import { Text, View } from 'react-native';
import { strings } from '../constants/strings';
import { formatIntervalCountdown, phaseRemainingMs, roundRemainingMs, type IntervalRuntime } from '../interval/intervalEngine';
import type { IntervalSpec } from '../types/engine';
import { Button } from './components';

/**
 * AMOLED interval execution panel. Pure display — timing owned by intervalEngine timestamps.
 * Touch targets ≥48dp; phase/round meaning is label + position, not color-only.
 */

function modeLabel(mode: IntervalSpec['mode']): string {
  return strings.interval.modes[mode];
}

function phaseLabel(phase: IntervalRuntime['phase']): string {
  if (!phase) return strings.interval.phases.work;
  return strings.interval.phases[phase];
}

export function IntervalReadyCard({
  spec,
  onStart,
  disabled,
}: {
  spec: IntervalSpec;
  onStart: () => void;
  disabled?: boolean;
}) {
  const summary =
    spec.mode === 'emom'
      ? `${Math.round((spec.periodMs ?? 60_000) / 1000)}s × ${spec.rounds}`
      : `${Math.round(spec.workMs / 1000)}/${Math.round(spec.restMs / 1000)} × ${spec.rounds}`;

  return (
    <View className="rounded-xl border border-line bg-surface p-4" testID="interval-ready">
      <View className="flex-row items-center justify-between">
        <Text className="text-xs font-semibold uppercase tracking-wider text-accent-ink">
          {strings.interval.title} · {modeLabel(spec.mode)}
        </Text>
        <Text className="font-mono text-sm text-dim">{summary}</Text>
      </View>
      <View className="mt-3">
        <Button label={strings.interval.start} onPress={onStart} disabled={disabled} />
      </View>
    </View>
  );
}

export function IntervalActiveCard({
  spec,
  runtime,
  now,
  onCancel,
  onRestart,
  onSkip,
  onFinishWork,
  onComplete,
  busy,
}: {
  spec: IntervalSpec;
  runtime: IntervalRuntime;
  now: number;
  onCancel: () => void;
  onRestart: () => void;
  onSkip: () => void;
  onFinishWork?: () => void;
  onComplete?: () => void;
  busy?: boolean;
}) {
  const completed = runtime.status === 'completed';
  const remainingMs = phaseRemainingMs(runtime, now);
  const roundRemain = roundRemainingMs(runtime, now);
  const isEmom = spec.mode === 'emom';

  if (completed) {
    return (
      <View className="rounded-xl border border-success/60 bg-surface p-4" testID="interval-complete">
        <Text className="text-xs font-semibold uppercase tracking-wider text-accent-ink">
          {strings.interval.title} · {modeLabel(spec.mode)}
        </Text>
        <Text className="mt-3 text-3xl font-bold text-success" testID="interval-complete-label">
          {strings.interval.complete}
        </Text>
        <View className="mt-4 flex-row gap-2">
          <View className="flex-1">
            <Button label={strings.interval.restart} variant="secondary" onPress={onRestart} disabled={busy} />
          </View>
          <View className="flex-1">
            <Button label={strings.interval.cancel} variant="ghost" onPress={onCancel} disabled={busy} />
          </View>
        </View>
        {onComplete ? (
          <View className="mt-2">
            <Button label={strings.interval.continue} onPress={onComplete} disabled={busy} />
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View className="rounded-xl border border-accent/50 bg-surface p-4" testID="interval-active">
      <View className="flex-row items-center justify-between">
        <Text className="text-xs font-semibold uppercase tracking-wider text-accent-ink">
          {modeLabel(spec.mode)} · {phaseLabel(runtime.phase)}
        </Text>
        <Text className="font-mono text-sm text-dim">
          {strings.interval.round} {runtime.round}/{spec.rounds}
        </Text>
      </View>

      <Text
        className="mt-2 font-mono text-6xl font-bold text-fg"
        testID="interval-countdown"
        accessibilityLabel={formatIntervalCountdown(remainingMs)}
      >
        {formatIntervalCountdown(remainingMs)}
      </Text>

      {isEmom ? (
        <Text className="mt-1 text-sm text-dim" testID="interval-round-window">
          {strings.interval.next}: {formatIntervalCountdown(roundRemain)}
        </Text>
      ) : null}

      {runtime.phase === 'work' && onFinishWork ? (
        <View className="mt-4">
          <Button label={strings.interval.finishRound} variant="secondary" onPress={onFinishWork} disabled={busy} />
        </View>
      ) : null}

      <View className="mt-3 flex-row gap-2">
        <View className="flex-1">
          <Button label={strings.interval.skipPhase} variant="secondary" onPress={onSkip} disabled={busy} />
        </View>
        <View className="flex-1">
          <Button label={strings.interval.restart} variant="ghost" onPress={onRestart} disabled={busy} />
        </View>
      </View>
      <View className="mt-2">
        <Button label={strings.interval.cancel} variant="danger" onPress={onCancel} disabled={busy} />
      </View>
    </View>
  );
}
