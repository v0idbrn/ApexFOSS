import { summarizeAdherence, type AdherenceRow } from './adherence';

const done = (executionType?: AdherenceRow['executionType']): AdherenceRow => ({
  isCompleted: true,
  executionType,
});

describe('summarizeAdherence (Phase 3D)', () => {
  it('reports complete when every planned position was performed plainly', () => {
    const s = summarizeAdherence({
      planned: 3,
      performed: [done('normal'), done('normal'), done('normal')],
      skipped: 0,
    });
    expect(s).toEqual({
      planned: 3,
      plannedPerformed: 3,
      skipped: 0,
      modified: 0,
      extra: 0,
      drop: 0,
      performed: 3,
      status: 'complete',
    });
  });

  it('counts legacy null-type rows as performed plain work', () => {
    const s = summarizeAdherence({ planned: 2, performed: [done(null), done(undefined)], skipped: 0 });
    expect(s.plannedPerformed).toBe(2);
    expect(s.status).toBe('complete');
  });

  it('treats modified rows as planned work performed differently', () => {
    const s = summarizeAdherence({
      planned: 3,
      performed: [done('modified'), done('normal'), done('normal')],
      skipped: 0,
    });
    expect(s.modified).toBe(1);
    expect(s.plannedPerformed).toBe(3);
    expect(s.status).toBe('complete');
  });

  it('reports partial when a prescribed position was skipped', () => {
    const s = summarizeAdherence({ planned: 3, performed: [done('normal'), done('normal')], skipped: 1 });
    expect(s.skipped).toBe(1);
    expect(s.plannedPerformed).toBe(2);
    expect(s.status).toBe('partial');
  });

  it('never lets extra sets mask a skipped prescribed position', () => {
    const s = summarizeAdherence({
      planned: 3,
      performed: [done('normal'), done('normal'), done('extra')],
      skipped: 1,
    });
    expect(s.extra).toBe(1);
    expect(s.plannedPerformed).toBe(2);
    expect(s.status).toBe('partial');
  });

  it('counts additions as performed but not as planned', () => {
    const s = summarizeAdherence({
      planned: 3,
      performed: [done('normal'), done('normal'), done('normal'), done('extra'), done('drop')],
      skipped: 0,
    });
    expect(s.performed).toBe(5);
    expect(s.plannedPerformed).toBe(3);
    expect(s.extra).toBe(1);
    expect(s.drop).toBe(1);
    expect(s.status).toBe('complete');
  });

  it('ignores voided rows (isCompleted false) that are not marked skipped', () => {
    const s = summarizeAdherence({
      planned: 2,
      performed: [{ isCompleted: false, executionType: 'normal' }, done('normal')],
      skipped: 0,
    });
    expect(s.performed).toBe(1);
    expect(s.plannedPerformed).toBe(1);
    expect(s.status).toBe('partial');
  });

  it('never counts a skipped-typed row as performed even if flagged completed', () => {
    const s = summarizeAdherence({ planned: 1, performed: [done('skipped')], skipped: 1 });
    expect(s.performed).toBe(0);
    expect(s.plannedPerformed).toBe(0);
    expect(s.status).toBe('none');
  });

  it('reports none when nothing planned was performed', () => {
    const s = summarizeAdherence({ planned: 3, performed: [], skipped: 0 });
    expect(s.status).toBe('none');
    expect(s.plannedPerformed).toBe(0);
  });

  it('handles a plan with zero sets deterministically', () => {
    expect(summarizeAdherence({ planned: 0, performed: [], skipped: 0 }).status).toBe('none');
    expect(summarizeAdherence({ planned: 0, performed: [done()], skipped: 0 }).status).toBe('complete');
  });

  it('clamps non-finite or negative inputs instead of producing NaN', () => {
    const s = summarizeAdherence({ planned: Number.NaN, performed: [], skipped: -4 });
    expect(s.planned).toBe(0);
    expect(s.skipped).toBe(0);
    expect(s.status).toBe('none');
  });
});
