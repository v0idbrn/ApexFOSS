import { Alert, Share } from 'react-native';
import { Database } from '@nozbe/watermelondb';
import { listCompletedSessions, loadSessionDetail, type HistoryDetail } from '../data/history';
import { sessionsToCsv, sessionsToJson } from './export';
import { strings } from '../constants/strings';

/**
 * Offline share-sheet export. No cloud, no filesystem writes required —
 * RN Share presents the payload to any installed handler (Drive, email, files…).
 * Never mutates DB state.
 */

export async function collectCompletedDetails(db: Database): Promise<HistoryDetail[]> {
  const list = await listCompletedSessions(db);
  const details: HistoryDetail[] = [];
  for (const item of list) {
    const d = await loadSessionDetail(db, item.id);
    if (d) details.push(d);
  }
  return details;
}

export async function shareCsvExport(db: Database): Promise<boolean> {
  const details = await collectCompletedDetails(db);
  const csv = sessionsToCsv(details);
  await Share.share({ message: csv, title: 'ApexFOSS workouts.csv' });
  return true;
}

export async function shareJsonExport(db: Database): Promise<boolean> {
  const details = await collectCompletedDetails(db);
  const json = sessionsToJson(details);
  await Share.share({ message: json, title: 'ApexFOSS workouts.json' });
  return true;
}

export function reportExportError(e: unknown): void {
  Alert.alert(strings.common.error, e instanceof Error ? e.message : String(e));
}
