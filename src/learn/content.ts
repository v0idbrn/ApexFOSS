import type { LessonCounts } from './progress';

/**
 * Learning content registry (D-061): locale-independent lesson ids, grouped
 * topics and evidence predicates. ALL prose lives in the centralized strings
 * (strings.learn) — this module adds no user-visible text, so it needs no
 * locale coupling and no UI-string exemption.
 */

export type LearnLessonId =
  | 'intro'
  | 'library'
  | 'createRoutine'
  | 'blocks'
  | 'prescriptions'
  | 'rir'
  | 'tempo'
  | 'structures'
  | 'runSession'
  | 'recovery'
  | 'history'
  | 'export'
  | 'backup'
  | 'import';

export type LearnGroupId = 'basics' | 'routines' | 'execution' | 'data';

export interface LearnLesson {
  id: LearnLessonId;
  /**
   * When present, the lesson completes automatically (and its "mark" button
   * states why) once the predicate over aggregate counts passes. Read-only
   * lessons have none and require explicit practice confirmation.
   */
  verifies?: (c: LessonCounts) => boolean;
}

export interface LearnGroup {
  id: LearnGroupId;
  lessons: LearnLesson[];
}

/**
 * Lesson screens resolve prose + practice text from strings.learn.lessons[id].
 */
export const LEARN_GROUPS: LearnGroup[] = [
  {
    id: 'basics',
    lessons: [
      { id: 'intro' },
      // Seeded starters do not count: the practice is creating an exercise.
      { id: 'library', verifies: (c) => c.userExercises > 0 },
    ],
  },
  {
    id: 'routines',
    lessons: [
      { id: 'createRoutine', verifies: (c) => c.routines > 0 },
      { id: 'blocks' },
      { id: 'prescriptions' },
      { id: 'rir' },
      { id: 'tempo' },
      { id: 'structures' },
    ],
  },
  {
    id: 'execution',
    lessons: [
      { id: 'runSession', verifies: (c) => c.setLogs > 0 },
      { id: 'recovery' },
    ],
  },
  {
    id: 'data',
    lessons: [
      // A completed session proves training, not that history was reviewed:
      // this conceptual lesson keeps explicit confirmation (D-063).
      { id: 'history' },
      { id: 'export' },
      { id: 'backup' },
      { id: 'import' },
    ],
  },
];

export const LEARN_LESSON_IDS: LearnLessonId[] = LEARN_GROUPS.flatMap((g) => g.lessons.map((l) => l.id));

const ALL_LESSONS: LearnLesson[] = LEARN_GROUPS.flatMap((g) => g.lessons);

export function findLesson(id: string): LearnLesson | null {
  return ALL_LESSONS.find((l) => l.id === id) ?? null;
}

export function isLessonCompleted(id: string, progress: { completed: string[] }): boolean {
  return progress.completed.includes(id);
}
