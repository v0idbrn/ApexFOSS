import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { database } from '../../data';
import { strings } from '../../constants/strings';
import { useNav } from '../navigation';
import { AppHeader, Button, Card, Screen, SectionHeader } from '../components';
import { formatBodyDelta, formatBodyEntry } from '../../analytics/body';
import { generateReport, type ReportData, type ReportPeriod } from '../../data/report';
import { sessionsToCsv } from '../../export/export';
import { collectCompletedDetailsInRange } from '../../export/share';
import { Share } from 'react-native';
import { dateRange } from '../../analytics/load';
import { formatCount, formatKg } from '../../utils/units';
import { signalReasonLabel, signalStateLabel } from '../TrendSignals';

export function ReportScreen() {
  const { pop } = useNav();
  const [period, setPeriod] = useState<ReportPeriod>('28d');
  const [report, setReport] = useState<ReportData | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const data = await generateReport(database, period);
      setReport(data);
    } catch (e) {
      Alert.alert(strings.common.error, e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [period]);

  useEffect(() => {
    load();
  }, [load]);

  const onExport = useCallback(async () => {
    setBusy(true);
    try {
      const details =
        !report || period === 'all'
          ? await collectCompletedDetailsInRange(database, 0, report?.generatedAt ?? Date.now())
          : await collectCompletedDetailsInRange(
              database,
              dateRange(period, report.generatedAt).startMs,
              dateRange(period, report.generatedAt).endMs,
            );
      const csv = sessionsToCsv(details);
      await Share.share({ message: csv, title: `ApexFOSS report-${period}.csv` });
    } catch (e) {
      Alert.alert(strings.common.error, e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [period, report]);

  const periodLabel = (p: ReportPeriod) =>
    p === '7d' ? strings.report.period7d : p === '28d' ? strings.report.period28d : strings.report.periodAll;

  const statusLabel = (status: 'complete' | 'partial' | 'none') =>
    strings.report[`adherence_${status}` as keyof typeof strings.report] as string;

  if (!report) {
    return (
      <Screen>
        <AppHeader title={strings.report.title} onBack={pop} />
        <View className="flex-1 items-center justify-center">
          <Text className="text-dim">{strings.common.loading}</Text>
        </View>
      </Screen>
    );
  }
  const weightEntry = report.body?.latestByIdentity['body_weight'];
  const waistEntry = report.body?.latestByIdentity['waist'];
  const weightDelta = report.body?.deltas['body_weight'];
  const waistDelta = report.body?.deltas['waist'];

  return (
    <Screen>
      <AppHeader title={strings.report.title} onBack={pop} />
      <ScrollView keyboardShouldPersistTaps="handled" className="flex-1 px-4 pb-8">
        <SectionHeader title={strings.report.period} />
        <View className="flex-row gap-2">
          {(['7d', '28d', 'all'] as ReportPeriod[]).map((p) => (
            <Button
              key={p}
              label={periodLabel(p)}
              variant={period === p ? 'primary' : 'secondary'}
              disabled={busy}
              onPress={() => setPeriod(p)}
              className="flex-1"
            />
          ))}
        </View>

        <SectionHeader title={strings.report.sessions} />
        <Card>
          <Text>{strings.report.sessionsTotal}: {report.sessions.total}</Text>
          <Text>{strings.report.totalVolume}: {formatCount(report.sessions.totalVolumeKgReps)} kg·reps</Text>
          <Text>{strings.report.avgSetsPerSession}: {report.sessions.averageSetsPerSession}</Text>
        </Card>

        <SectionHeader title={strings.report.volumeByExercise} />
        <Card>
          {report.volume.byExercise.length === 0 ? (
            <Text className="text-dim">{strings.report.noData}</Text>
          ) : (
            report.volume.byExercise.slice(0, 10).map((v, i) => (
              <Text key={i} className="py-1">
                {v.exerciseName}: {formatKg(v.gramReps)} kg·reps · {v.setCount} {strings.report.sets}
              </Text>
            ))
          )}
        </Card>

        <SectionHeader title={strings.report.personalRecords} />
        <Card>
          <Text>{strings.report.prCount}: {report.prs.count}</Text>
          {report.prs.byExercise.length === 0 ? (
            <Text className="text-dim">{strings.report.noRecords}</Text>
          ) : (
            report.prs.byExercise.slice(0, 10).map((pr, i) => (
              <Text key={i} className="py-1">
                {pr.exerciseName}:
                {pr.estimated1rmGrams !== null ? ` e1RM ~${formatKg(pr.estimated1rmGrams)}kg` : ''}
                {pr.bestWeightGrams !== null ? ` · best ${formatKg(pr.bestWeightGrams)}kg` : ''}
                {pr.bestReps !== null ? ` · ${pr.bestReps} ${strings.workout.reps}` : ''}
              </Text>
            ))
          )}
        </Card>

        <SectionHeader title={strings.report.adherence} />
        <Card>
          <Text>{strings.report.adherenceStatus}: {statusLabel(report.adherence.status)}</Text>
          <Text>
            {strings.report.planned}: {report.adherence.planned} · {strings.report.performed}:{' '}
            {report.adherence.performed}
          </Text>
          <Text>
            {strings.report.skipped}: {report.adherence.skipped} · {strings.report.modified}:{' '}
            {report.adherence.modified} · {strings.report.extra}: {report.adherence.extra}
          </Text>
        </Card>

        {report.body ? (
          <>
            <SectionHeader title={strings.report.bodyMetrics} />
            <Card>
              <Text>
                {strings.report.latestWeight}: {weightEntry ? formatBodyEntry(weightEntry) : strings.report.na}
              </Text>
              <Text>
                {strings.report.latestWaist}: {waistEntry ? formatBodyEntry(waistEntry) : strings.report.na}
              </Text>
              <Text>
                {strings.report.weightDelta}: {weightDelta ? formatBodyDelta(weightDelta) ?? strings.report.na : strings.report.na}
              </Text>
              <Text>
                {strings.report.waistDelta}: {waistDelta ? formatBodyDelta(waistDelta) ?? strings.report.na : strings.report.na}
              </Text>
              <Text>{strings.report.entries}: {report.body.entryCount}</Text>
            </Card>
          </>
        ) : null}

        {report.goals.length > 0 && (
          <>
            <SectionHeader title={strings.report.goals} />
            <Card>
              {report.goals.map((g, i) => (
                <Text key={i} className="py-1">
                  {g.exerciseName}: target {formatKg(g.targetGrams)}kg ·
                  {g.currentBestGrams !== null
                    ? `current ${formatKg(g.currentBestGrams)}kg (${Math.round((g.progress ?? 0) * 100)}%)`
                    : strings.report.noData}
                  {g.achieved ? ` · ${strings.report.achieved}` : ''}
                </Text>
              ))}
            </Card>
          </>
        )}

        {report.e1rmTrends.length > 0 && (
          <>
            <SectionHeader title={strings.report.trends} />
            <Card>
              {report.e1rmTrends.slice(0, 10).map((t, i) => (
                <Text key={i} className="py-1">
                  {t.exerciseName}: {signalStateLabel(t.evidence.status)} ({signalReasonLabel(t.evidence.reason)})
                </Text>
              ))}
            </Card>
          </>
        )}

        <View className="mt-4 flex-row gap-2">
          <Button
            label={strings.report.exportCsv}
            variant="secondary"
            disabled={busy}
            onPress={onExport}
            className="flex-1"
          />
          <Button label={strings.common.back} variant="ghost" onPress={pop} className="flex-1" />
        </View>
      </ScrollView>
    </Screen>
  );
}