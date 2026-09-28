import type { Database } from '@nozbe/watermelondb';
import { buildReport, type ReportData, type ReportPeriod } from '../analytics/report';
import { loadAnalyticsSnapshot } from './analytics';
import { loadGoals } from './goals';
import { makeDbActions } from './actions';

export type { ReportData, ReportPeriod };

/**
 * Report data bridge: one bounded snapshot plus goals and body rows, then the
 * pure report builder. No business logic here beyond data loading.
 */
export async function generateReport(db: Database, period: ReportPeriod, now = Date.now()): Promise<ReportData> {
  const [snapshot, goals, bodyRows] = await Promise.all([
    loadAnalyticsSnapshot(db),
    loadGoals(db),
    makeDbActions(db).listBodyMetrics(),
  ]);
  return buildReport({
    snapshot,
    goals,
    bodyRows: bodyRows.map((row) => ({
      timestampMs: row.measuredAt,
      measurementType: row.measurementType,
      side: row.side,
      value: row.value,
      unit: row.unit,
      weightGrams: row.weightGrams,
      waistMm: row.waistMm,
    })),
    period,
    now,
  });
}
