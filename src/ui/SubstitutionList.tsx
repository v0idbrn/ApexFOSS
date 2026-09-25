import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { strings } from '../constants/strings';
import { rankSubstitutions, type SubstitutionExercise } from '../analytics/substitutions';
import { Badge, Card } from './components';

/**
 * Ranked substitution suggestions (Phase 2J §…). Presentational — the caller
 * supplies the target (usually the exercise being edited) and all candidates
 * with resolved muscle contributions.
 */
export function SubstitutionList({
  target,
  candidates,
  limit = 5,
}: {
  target: SubstitutionExercise;
  candidates: SubstitutionExercise[];
  limit?: number;
}) {
  const ranked = useMemo(() => rankSubstitutions(target, candidates, { limit }), [target, candidates, limit]);

  if (ranked.length === 0) {
    return <Text className="text-sm text-dim">{strings.substitutions.none}</Text>;
  }

  return (
    <View>
      {ranked.map((entry) => (
        <Card key={`${entry.exercise.id ?? ''}|${entry.exercise.name}`} className="mb-2">
          <Text className="text-base text-fg">{entry.exercise.name}</Text>
          <Text className="mt-0.5 text-caption text-dim">
            {[entry.exercise.category, entry.exercise.equipment].filter(Boolean).join(' · ')}
          </Text>
          <View className="mt-2 flex-row flex-wrap gap-1.5">
            {entry.reasons.map((reason) => (
              <Badge key={reason} label={strings.substitutions.reasons[reason]} />
            ))}
          </View>
        </Card>
      ))}
    </View>
  );
}
