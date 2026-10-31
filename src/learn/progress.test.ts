import {
  emptyLearnProgress,
  markLessonCompleted,
  parseLearnProgress,
  serializeLearnProgress,
  type LearnProgress,
} from './progress';

/**
 * Learning progress document (D-061): device-local, versioned and parsed
 * defensively — corrupt or hostile JSON degrades to empty, never throws.
 */

describe('parseLearnProgress', () => {
  it('returns empty progress when no document exists', () => {
    expect(parseLearnProgress(null)).toEqual(emptyLearnProgress());
  });

  it('returns empty progress for malformed or non-object documents', () => {
    for (const raw of ['not json', '[]', '42', 'null', '"text"', '{}x']) {
      expect(parseLearnProgress(raw)).toEqual(emptyLearnProgress());
    }
  });

  it('keeps only unique string lesson ids and ignores a non-boolean welcome flag', () => {
    const parsed = parseLearnProgress(
      JSON.stringify({ welcomeDone: 'yes', completed: ['intro', 7, null, 'intro', 'export'] }),
    );
    expect(parsed.welcomeDone).toBe(false);
    expect(parsed.completed).toEqual(['intro', 'export']);
  });

  it('caps the completed list so a hostile document cannot grow unbounded', () => {
    const ids = Array.from({ length: 200 }, (_, i) => `lesson-${i}`);
    const parsed = parseLearnProgress(JSON.stringify({ welcomeDone: true, completed: ids }));
    expect(parsed.completed).toHaveLength(64);
    expect(parsed.completed[0]).toBe('lesson-0');
  });

  it('round-trips through serialize', () => {
    const progress: LearnProgress = { version: 1, welcomeDone: true, completed: ['library'] };
    expect(parseLearnProgress(serializeLearnProgress(progress))).toEqual(progress);
  });
});

describe('markLessonCompleted', () => {
  it('adds a new id and freezes welcome state', () => {
    const before: LearnProgress = { version: 1, welcomeDone: true, completed: ['intro'] };
    const after = markLessonCompleted(before, 'library');
    expect(after.completed).toEqual(['intro', 'library']);
    expect(after.welcomeDone).toBe(true);
    expect(before.completed).toEqual(['intro']);
  });

  it('is idempotent for an already completed lesson', () => {
    const before: LearnProgress = { version: 1, welcomeDone: false, completed: ['intro'] };
    expect(markLessonCompleted(before, 'intro')).toBe(before);
  });

  it('never exceeds the persisted cap', () => {
    const before: LearnProgress = {
      version: 1,
      welcomeDone: true,
      completed: Array.from({ length: 64 }, (_, i) => `l${i}`),
    };
    const after = markLessonCompleted(before, 'extra');
    expect(after.completed).toHaveLength(64);
    expect(after.completed).not.toContain('extra');
  });
});
