import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import { schema } from '../data/schema';
import { migrations } from '../data/migrations';
import { modelClasses } from '../data/models';
import { makeDbActions } from '../data/actions';
import { generateReport, type ReportPeriod } from './report';

function makeDb(): Database {
  const adapter = new LokiJSAdapter({
    dbName: `apex-rpt-${Math.random().toString(36).slice(2)}`,
    schema,
    migrations,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
  });
  return new Database({ adapter, modelClasses: modelClasses as any });
}

describe('generateReport', () => {
  let db: Database;
  let actions: ReturnType<typeof makeDbActions>;

  beforeEach(async () => {
    db = makeDb();
    actions = makeDbActions(db);
  });

  it('returns empty report when no sessions exist', async () => {
    const report = await generateReport(db, '28d');
    expect(report.sessions.total).toBe(0);
    expect(report.volume.byExercise).toEqual([]);
    expect(report.prs.count).toBe(0);
    expect(report.adherence.planned).toBe(0);
    expect(report.body).toBeNull();
    expect(report.goals).toEqual([]);
    expect(report.e1rmTrends).toEqual([]);
  });

  it('returns empty report for 7d period when no sessions exist', async () => {
    const report = await generateReport(db, '7d');
    expect(report.sessions.total).toBe(0);
    expect(report.period).toBe('7d');
  });

  it('returns empty report for all period when no sessions exist', async () => {
    const report = await generateReport(db, 'all');
    expect(report.sessions.total).toBe(0);
    expect(report.period).toBe('all');
  });

  it('returns null body when no metrics exist', async () => {
    const report = await generateReport(db, '28d');
    expect(report.body).toBeNull();
  });

  it('returns empty goals when none exist', async () => {
    const report = await generateReport(db, '28d');
    expect(report.goals).toEqual([]);
  });

  it('returns empty trends when no sessions exist', async () => {
    const report = await generateReport(db, '28d');
    expect(report.e1rmTrends).toEqual([]);
  });
});