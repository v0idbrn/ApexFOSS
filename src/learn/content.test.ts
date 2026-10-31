import { getStrings, type Locale } from '../constants/strings';
import { LEARN_GROUPS, LEARN_LESSON_IDS, findLesson } from './content';

/**
 * Content registry contract (D-061): ids are locale-independent, unique and
 * every lesson has complete prose in BOTH dictionaries. The i18n parity test
 * already enforces identical key shapes; this proves the registry and the
 * dictionaries actually agree.
 */

const LOCALES: Locale[] = ['en', 'es'];

describe('learn content registry', () => {
  it('has unique lesson ids across every group', () => {
    expect(new Set(LEARN_LESSON_IDS).size).toBe(LEARN_LESSON_IDS.length);
    expect(LEARN_LESSON_IDS.length).toBeGreaterThan(0);
  });

  it('keeps every group non-empty and every lesson findable', () => {
    for (const group of LEARN_GROUPS) {
      expect(group.lessons.length).toBeGreaterThan(0);
      for (const lesson of group.lessons) {
        expect(findLesson(lesson.id)).toBe(lesson);
      }
    }
  });

  it('has complete prose for every lesson in EN and ES', () => {
    const fields = ['title', 'summary', 'what', 'why', 'how', 'example', 'practice'] as const;
    for (const locale of LOCALES) {
      const dict = getStrings(locale);
      for (const id of LEARN_LESSON_IDS) {
        const lesson = dict.learn.lesson[id];
        for (const field of fields) {
          expect({ locale, id, field, value: lesson[field] }).toEqual({
            locale,
            id,
            field,
            value: expect.any(String),
          });
          expect(lesson[field].trim().length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('returns null for an unknown lesson id', () => {
    expect(findLesson('nope')).toBeNull();
  });

  it('verifies lessons only from the aggregate counts they claim', () => {
    const zero = { userExercises: 0, routines: 0, setLogs: 0, completedSessions: 0 };
    expect(findLesson('library')!.verifies!(zero)).toBe(false);
    expect(findLesson('library')!.verifies!({ ...zero, userExercises: 1 })).toBe(true);
    expect(findLesson('createRoutine')!.verifies!({ ...zero, routines: 1 })).toBe(true);
    expect(findLesson('runSession')!.verifies!({ ...zero, setLogs: 1 })).toBe(true);
  });

  it('does not complete history from a completed session alone', () => {
    expect(findLesson('history')!.verifies).toBeUndefined();
  });

  it('leaves conceptual and reading lessons without an evidence predicate', () => {
    for (const id of ['intro', 'prescriptions', 'structures', 'recovery', 'history', 'export'] as const) {
      expect(findLesson(id)!.verifies).toBeUndefined();
    }
  });
});
