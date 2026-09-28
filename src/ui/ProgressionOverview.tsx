import { Text, View } from 'react-native';
import { strings } from '../constants/strings';
import { Badge, EmptyState, ListRow, SectionHeader, type BadgeTone } from './components';
import type { ProgressionOverview as Overview } from '../data/progression';
import {
  progressionReasonLabel,
  progressionStateLabel,
  progressionStateTone,
} from './ProgressionCard';

/**
 * Progress-overview section (Phase 3B, Progress tab). Consumes the pure
 * classification from summarizeProgression(): three transparent groups —
 * progressing, maintaining, not-enough-data — each row carrying the engine's
 * own reason, so every verdict is explainable in one line.
 */
export function ProgressionOverviewSection({
  overview,
  onOpenExercise,
}: {
  overview: Overview | null;
  onOpenExercise: (exerciseId: string) => void;
}) {
  if (!overview || overview.analyzedCount === 0) {
    return (
      <View className="px-4">
        <SectionHeader title={strings.progression.section} />
        <EmptyState
          title={strings.progression.emptyTitle}
          message={strings.progression.emptyBody}
          description={strings.progression.insufficientHint}
        />
      </View>
    );
  }

  const groups: Array<{ entries: Overview['progress']; tone: BadgeTone }> = [
    { entries: overview.progress, tone: 'strong' },
    { entries: overview.maintain, tone: 'accent' },
    { entries: overview.insufficient, tone: 'neutral' },
  ];

  return (
    <View className="px-4">
      <SectionHeader
        title={strings.progression.section}
        right={<Text className="text-xs text-dim">{strings.progression.overviewSub}</Text>}
      />
      {groups.map((group, gi) =>
        group.entries.length === 0 ? null : (
          <View key={gi} className="mb-2 overflow-hidden rounded-xl border border-line bg-surface">
            {group.entries.map(({ exercise, evidence }) => (
              <ListRow
                key={exercise.id}
                title={exercise.name}
                subtitle={progressionReasonLabel(evidence.reason)}
                testID={`progression-row-${exercise.id}`}
                onPress={() => onOpenExercise(exercise.id)}
                right={
                  <Badge label={progressionStateLabel(evidence.state)} tone={progressionStateTone(evidence.state)} />
                }
              />
            ))}
          </View>
        ),
      )}
    </View>
  );
}
