import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Text, View } from 'react-native';
import { database } from '../../data';
import { listCompletedSessions, type HistoryListItem } from '../../data/history';
import { collectCompletedDetails, reportExportError, shareCsvExport, shareJsonExport } from '../../export/share';
import { strings } from '../../constants/strings';
import { useNav } from '../navigation';
import { AppHeader, Button, EmptyState, ErrorState, ListRow, LoadingState, Screen } from '../components';
import { Enter } from '../motion';

function formatWhen(startedAt: number): string {
  try {
    return new Date(startedAt).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return new Date(startedAt).toISOString();
  }
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function HistoryListScreen() {
  const { push, pop } = useNav();
  const [rows, setRows] = useState<HistoryListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listCompletedSessions(database));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const onExport = useCallback(async (kind: 'csv' | 'json') => {
    if (exporting) return;
    setExporting(true);
    try {
      const details = await collectCompletedDetails(database);
      if (details.length === 0) {
        Alert.alert(strings.export.title, strings.export.nothing);
        return;
      }
      if (kind === 'csv') await shareCsvExport(database);
      else await shareJsonExport(database);
    } catch (e) {
      reportExportError(e);
    } finally {
      setExporting(false);
    }
  }, [exporting]);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <Screen>
      <AppHeader title={strings.history.title} onBack={pop} />
      <Enter className="flex-1">
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : rows.length === 0 ? (
        <EmptyState message={strings.history.emptyDetail} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <ListRow
              title={item.name}
              subtitle={`${formatWhen(item.startedAt)} · ${strings.history.duration} ${formatDuration(item.durationMs)} · ${item.setCount} ${strings.history.sets.toLowerCase()}`}
              onPress={() => push({ name: 'historyDetail', sessionId: item.id })}
            />
          )}
        />
      )}
      </Enter>
      {rows.length > 0 && !loading && !error ? (
        <View className="border-t border-line px-4 py-2">
          <Text className="mb-2 text-xs text-dim">
            {rows.length} {strings.history.completed.toLowerCase()}
          </Text>
          <View className="flex-row gap-2">
            <Button
              label={exporting ? strings.common.loading : strings.export.csv}
              variant="secondary"
              disabled={exporting}
              onPress={() => void onExport('csv')}
              className="flex-1"
            />
            <Button
              label={strings.export.json}
              variant="secondary"
              disabled={exporting}
              onPress={() => void onExport('json')}
              className="flex-1"
            />
          </View>
        </View>
      ) : null}
    </Screen>
  );
}
