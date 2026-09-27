import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { database } from '../../data';
import { strings } from '../../constants/strings';
import { useNav } from '../navigation';
import { AppHeader, Button, Card, Screen, SectionHeader } from '../components';
import { generateReport, type ReportData, type ReportPeriod } from '../../analytics/report';
import { sessionsToCsv } from '../../export/export';
import { collectCompletedDetails } from '../../export/share';
import { Share } from 'react-native';
import { formatKg } from '../../utils/units';

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
      const details = await collectCompletedDetails(database);
      const csv = sessionsToCsv(details);
      await Share.share({ message: csv, title: `ApexFOSS report-${period}.csv` });
    } catch (e) {
      Alert.alert(strings.common.error, e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [period]);

  const periodLabel = (p: ReportPeriod) =>
    p === '7d' ? strings.report.period7d : p === '28d' ? strings.report.period28d : strings.report.periodAll;

  const statusLabel = (status: 'complete' | 'partial' | 'none') =>
    strings.report[`adherence_${status}` as keyof typeof strings.report] as string;

  const trendLabel = (status: string) =>
    strings.report[status as keyof typeof strings.report] as string;

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
          <Text>{strings.report.totalVolume}: {formatKg(report.sessions.totalVolumeKgReps)} kg·reps</Text>
          <Text>{strings.report.avgSetsPerSession}: {report.sessions.averageSetsPerSession}</Text>
        </Card>

        <SectionHeader title={strings.report.volumeByExercise} />
        <Card>
          {report.volume.byExercise.length === 0 ? (
            <Text className="text-dim">{strings.report.noData}</Text>
          ) : (
            report.volume.byExercise.slice(0, 10).map((v, i) => (
              <Text key={i} className="py-1">
                {v.exerciseName}: {formatKg(Math.round(v.gramReps / 1000))} kg·reps · {v.setCount} {strings.report.sets}
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
                {pr.estimated1rmGrams !== null
                  ? ` e1RM ~${formatKg(Math.round(pr.estimated1rmGrams / 1000))}kg`
                  : ''}
                {pr.bestWeightGrams !== null ? ` · best ${formatKg(Math.round(pr.bestWeightGrams / 1000))}kg` : ''}
                {pr.bestReps !== null ? ` · {pr.bestReps} reps` : ''}
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

        {report.body && (
          <>
            <SectionHeader title={strings.report.bodyMetrics} />
            <Card>
              <Text>
                {strings.report.latestWeight}: {report.body.latest && report.body.latest.weightGrams !== null ? formatKg(report.body.latest.weightGrams / 1000) : strings.report.na}
              </Text>
              <Text>
                {strings.report.latestWaist}: {report.body.latest && report.body.latest.waistMm !== null ? (report.body.latest.waistMm / 10).toFixed(1) + 'cm' : strings.report.na}
              </Text>
              <Text>
                {strings.report.weightDelta}: {report.body.weightDeltaGrams !== null ? (report.body.weightDeltaGrams >= 0 ? '+' : '') + formatKg(Math.round(report.body.weightDeltaGrams / 1000)) + 'kg' : strings.report.na}
              </Text>
              <Text>
                {strings.report.waistDelta}: {report.body.waistDeltaMm !== null ? (report.body.waistDeltaMm >= 0 ? '+' : '') + (report.body.waistDeltaMm / 10).toFixed(1) + 'cm' : strings.report.na}
              </Text>
              <Text>{strings.report.entries}: {report.body.entryCount}</Text>
            </Card>
          </>
        )}

        {report.goals.length > 0 && (
          <>
            <SectionHeader title={strings.report.goals} />
            <Card>
              {report.goals.map((g, i) => (
                <Text key={i} className="py-1">
                  {g.exerciseName}: target {formatKg(g.targetGrams / 1000)}kg ·
                  {g.currentBestGrams !== null
                    ? `current ${formatKg(g.currentBestGrams / 1000)}kg ({(g.progress! * 100).toFixed(0)}%)`
                    : strings.report.noData}
                  {g.achieved ? ` · {strings.report.achieved}` : ''}
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
                  {trendLabel(t.status)} ({t.reason})
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