import { Text, View } from 'react-native';
import { strings } from '../constants/strings';
import { formatKg } from '../utils/units';
import { Badge, Card, Divider, StatRow, type BadgeTone } from './components';
import type {
  ProgressionEvidence,
  ProgressionReason,
  ProgressionState,
} from '../analytics/progression';

/**
 * Shared progression-verdict view (Phase 3B). Consumes ProgressionEvidence —
 * the UI renders the engine's result and never reimplements its rules.
 * States are distinguished by label + badge tone, never by color alone.
 */

export function progressionStateLabel(state: ProgressionState): string {
  if (state === 'progress') return strings.progression.stateProgress;
  if (state === 'maintain') return strings.progression.stateMaintain;
  return strings.progression.stateInsufficient;
}

export function progressionReasonLabel(reason: ProgressionReason): string {
  const map = strings.progression.reason as Record<ProgressionReason, string>;
  return map[reason] ?? reason;
}

export function progressionStateTone(state: ProgressionState): BadgeTone {
  if (state === 'progress') return 'strong';
  if (state === 'maintain') return 'accent';
  return 'neutral';
}

/**
 * Compact card: state badge + reason + the comparison facts that justify it
 * (baseline vs current, rep range, target weight, next achievable load).
 */
export function SessionProgressionSummary({
  evidence,
  testID,
}: {
  evidence: ProgressionEvidence;
  testID?: string;
}) {
  const baseline = evidence.baseline;
  const current = evidence.current;

  const baselineLabel = baseline
    ? `${new Date(baseline.timestampMs).toLocaleDateString()} · ${formatKg(baseline.weightGrams)} kg × ${baseline.reps} ${strings.workout.reps}`
    : '—';
  const currentLabel = current
    ? `${new Date(current.timestampMs).toLocaleDateString()} · ${formatKg(current.weightGrams)} kg × ${current.reps} ${strings.workout.reps}`
    : '—';

  const range =
    evidence.repsVsRange.min != null && evidence.repsVsRange.max != null
      ? `${evidence.repsVsRange.min}–${evidence.repsVsRange.max}`
      : '—';
  const targetWeight = evidence.currentPrescription.targetWeightGrams;

  return (
    <Card tone="tonal" testID={testID}>
      <View className="flex-row items-center justify-between">
        <Text accessibilityRole="header" className="text-xs font-semibold uppercase tracking-wider text-dim">
          {strings.progression.section}
        </Text>
        <Badge
          label={progressionStateLabel(evidence.state)}
          tone={progressionStateTone(evidence.state)}
          testID={testID ? `${testID}-state` : undefined}
        />
      </View>

      <Text className="mt-2 text-body text-fg">{progressionReasonLabel(evidence.reason)}</Text>

      {evidence.state !== 'insufficient_data' && baseline && current ? (
        <>
          <Divider className="my-2.5" />
          <StatRow label={`${strings.progression.comparedAgainst} · ${strings.history.detail}`} value={baselineLabel} />
          <StatRow label={strings.progression.repsAchieved} value={currentLabel} />
          <StatRow label={strings.progression.repRange} value={range} />
          <StatRow
            label={strings.progression.targetWeight}
            value={targetWeight != null ? `${formatKg(targetWeight)} kg` : '—'}
          />
          {evidence.suggestedWeightGrams != null ? (
            <StatRow
              label={strings.progression.nextWeight}
              value={`${formatKg(evidence.suggestedWeightGrams)} kg`}
              testID={testID ? `${testID}-next-weight` : undefined}
            />
          ) : null}
          <Text className="mt-2 text-caption text-dim">
            {strings.progression.sessionsCompared}: {evidence.comparableCount}
          </Text>
        </>
      ) : (
        <Text className="mt-2 text-caption text-dim">{strings.progression.insufficientHint}</Text>
      )}
    </Card>
  );
}
