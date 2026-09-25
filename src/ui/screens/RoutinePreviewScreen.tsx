import { useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { strings } from '../../constants/strings';
import { definitionFromDraft } from '../../data/serialize';
import { checkIntegrity, type IntegrityIssue } from '../../engine/integrity';
import { simulateRoutine, type SimulationResult } from '../../engine/simulator';
import type { RoutineDraft } from '../../types/draft';
import { useNav } from '../navigation';
import { AppHeader, Badge, Card, EmptyState, MetricCard, Screen, SectionHeader } from '../components';

function issueKey(issue: IntegrityIssue, index: number): string {
  return `${issue.code}-${issue.blockId ?? ''}-${issue.stepId ?? ''}-${index}`;
}

function issueContext(issue: IntegrityIssue): string | null {
  const block = issue.blockName ?? null;
  const step = issue.stepName ?? null;
  if (block && step) return `${block} › ${step}`;
  return block;
}

/**
 * Routine preview (Phase 2J §14): converts the editor draft with the same
 * mapping the app persists, then drives the REAL engine step by step.
 * Pure and synchronous — no DB reads, no network, no wall-clock.
 */
export function RoutinePreviewScreen({ draft }: { draft: RoutineDraft }) {
  const { pop } = useNav();

  const definition = useMemo(() => definitionFromDraft(draft), [draft]);
  const simulation = useMemo<SimulationResult>(() => simulateRoutine(definition), [definition]);
  const issues = useMemo(() => checkIntegrity(definition), [definition]);

  const hasSteps = draft.blocks.some((b) => b.steps.length > 0) && draft.blocks.length > 0;
  const restMinutes = Math.round(simulation.totalTimerMs / 60_000);
  const exerciseCount = new Set(
    draft.blocks.flatMap((b) => b.steps.map((s) => s.exerciseName).filter(Boolean)),
  ).size;

  if (!hasSteps) {
    return (
      <Screen>
        <AppHeader title={strings.preview.title} onBack={pop} />
        <View className="flex-1 items-center justify-center px-6">
          <EmptyState title={strings.preview.empty} message={strings.preview.how} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <AppHeader title={strings.preview.title} onBack={pop} />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View className="px-4 pt-4">
          <Text className="text-caption text-dim">{strings.preview.how}</Text>

          <View className="mt-4">
            <SectionHeader title={strings.integrity.title} />
            {issues.length === 0 ? (
              <Card>
                <Text className="text-sm text-dim">{strings.integrity.ok}</Text>
              </Card>
            ) : (
              issues.map((issue, index) => {
                const context = issueContext(issue);
                return (
                  <Card key={issueKey(issue, index)} className="mb-2">
                    <View className="mb-1 flex-row items-center gap-2">
                      <Badge
                        label={
                          issue.severity === 'error'
                            ? strings.integrity.error
                            : strings.integrity.warning
                        }
                        tone={issue.severity === 'error' ? 'danger' : 'neutral'}
                      />
                    </View>
                    <Text className="text-sm text-fg">{strings.integrity.messages[issue.code]}</Text>
                    {context ? <Text className="mt-1 text-caption text-dim">{context}</Text> : null}
                  </Card>
                );
              })
            )}
          </View>

          {simulation.truncated ? (
            <Card tone="tonal" className="mt-3">
              <Text className="text-sm text-danger">{strings.preview.truncated}</Text>
            </Card>
          ) : null}

          <View className="mt-3 flex-row gap-2">
            <MetricCard size="sm" label={strings.preview.workSets} value={String(simulation.workSetCount)} />
            <MetricCard
              size="sm"
              label={strings.preview.plannedRest}
              value={String(restMinutes)}
              unit={strings.preview.minutes}
            />
            <MetricCard size="sm" label={strings.preview.blocks} value={String(draft.blocks.length)} />
          </View>
          <View className="mt-2 flex-row gap-2">
            <MetricCard size="sm" label={strings.preview.exercises} value={String(exerciseCount)} />
          </View>

          <View className="mt-4">
            <SectionHeader title={strings.preview.byExercise} />
            {simulation.setsByExercise.length === 0 ? (
              <Card>
                <Text className="text-sm text-dim">{strings.preview.empty}</Text>
              </Card>
            ) : (
              simulation.setsByExercise.map((entry) => (
                <Card key={entry.exerciseName} className="mb-2">
                  <View className="flex-row items-center justify-between">
                    <Text className="flex-1 text-base text-fg" numberOfLines={1}>
                      {entry.exerciseName || strings.common.none}
                    </Text>
                    <Text className="text-metric font-mono text-fg">
                      {entry.sets} {strings.preview.setsUnit}
                    </Text>
                  </View>
                </Card>
              ))
            )}
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}
