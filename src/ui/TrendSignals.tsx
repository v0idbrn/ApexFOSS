import { Text, View } from 'react-native';
import { strings } from '../constants/strings';
import type { TrendReason, TrendStatus } from '../analytics/plateau';
import type { TrendOverview } from '../data/progression';
import { Badge, ListRow, SectionHeader, type BadgeTone } from './components';

/**
 * Performance-signal rows (Phase 3D, Progress tab): deterministic trend and
 * plateau evidence per exercise. Only signals that cleared the sample gate
 * render — insufficient evidence never shows as a verdict.
 */

export function signalStateLabel(status: TrendStatus): string {
  const map = strings.signals.state as Record<string, string>;
  return map[status] ?? status;
}

export function signalReasonLabel(reason: TrendReason): string {
  const map = strings.signals.reason as Record<string, string>;
  return map[reason] ?? reason;
}

export function signalTone(status: TrendStatus): BadgeTone {
  if (status === 'improving') return 'strong';
  if (status === 'stable') return 'accent';
  return 'neutral';
}

export function TrendSignalsSection({
  overview,
  onOpenExercise,
}: {
  overview: TrendOverview | null;
  onOpenExercise: (exerciseId: string) => void;
}) {
  if (!overview || overview.signals.length === 0) return null;
  return (
    <View className="px-4">
      <SectionHeader
        title={strings.signals.section}
        right={<Text className="text-xs text-dim">{strings.signals.sub}</Text>}
      />
      <View className="overflow-hidden rounded-xl border border-line bg-surface">
        {overview.signals.map(({ exercise, evidence }) => (
          <ListRow
            key={exercise.id}
            title={exercise.name}
            subtitle={signalReasonLabel(evidence.reason)}
            testID={`signal-row-${exercise.id}`}
            onPress={() => onOpenExercise(exercise.id)}
            right={<Badge label={signalStateLabel(evidence.status)} tone={signalTone(evidence.status)} />}
          />
        ))}
      </View>
    </View>
  );
}
