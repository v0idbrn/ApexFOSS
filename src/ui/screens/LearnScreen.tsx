import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { database } from '../../data';
import { strings } from '../../constants/strings';
import { LEARN_GROUPS, type LearnGroupId } from '../../learn/content';
import {
  emptyLearnProgress,
  loadLearnProgress,
  loadLessonCounts,
  saveLearnProgress,
  type LearnProgress,
  type LessonCounts,
} from '../../learn/progress';
import { useNav } from '../navigation';
import { AppHeader, Badge, Button, ListRow, Progress, Screen, SectionHeader } from '../components';

/**
 * Learning center (D-061): lists every lesson by group with its completion
 * state. Completion is the persisted marker OR evidence the data already
 * proves — the same rule the lesson screen applies, so the two surfaces can
 * never disagree. Read-only for training data.
 */

const EMPTY_COUNTS: LessonCounts = { userExercises: 0, routines: 0, setLogs: 0, completedSessions: 0 };

function groupTitle(id: LearnGroupId): string {
  switch (id) {
    case 'basics':
      return strings.learn.groupBasics;
    case 'routines':
      return strings.learn.groupRoutines;
    case 'execution':
      return strings.learn.groupExecution;
    case 'data':
      return strings.learn.groupData;
  }
}

export function LearnScreen() {
  const { push, pop } = useNav();
  const [progress, setProgress] = useState<LearnProgress>(emptyLearnProgress);
  const [counts, setCounts] = useState<LessonCounts>(EMPTY_COUNTS);
  const [resetDone, setResetDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      loadLearnProgress(database).catch(() => emptyLearnProgress()),
      loadLessonCounts(database).catch(() => EMPTY_COUNTS),
    ]).then(([p, c]) => {
      if (cancelled) return;
      setProgress(p);
      setCounts(c);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const isComplete = useCallback(
    (id: string, verifies?: (c: LessonCounts) => boolean): boolean =>
      progress.completed.includes(id) || (verifies ? verifies(counts) : false),
    [progress, counts],
  );

  const total = LEARN_GROUPS.reduce((n, g) => n + g.lessons.length, 0);
  const done = LEARN_GROUPS.reduce(
    (n, g) => n + g.lessons.filter((l) => isComplete(l.id, l.verifies)).length,
    0,
  );

  const onReset = useCallback(() => {
    Alert.alert(strings.learn.practice.reset, strings.learn.practice.resetConfirm, [
      { text: strings.common.cancel, style: 'cancel' },
      {
        text: strings.learn.practice.reset,
        style: 'destructive',
        onPress: () => {
          const next: LearnProgress = { ...emptyLearnProgress(), welcomeDone: progress.welcomeDone };
          setProgress(next);
          setResetDone(true);
          void saveLearnProgress(database, next).catch(() => {});
        },
      },
    ]);
  }, [progress.welcomeDone]);

  return (
    <Screen>
      <AppHeader title={strings.learn.title} onBack={pop} />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} className="flex-1 px-4" testID="learn-center">
        <Text className="mt-4 text-body text-dim">{strings.learn.centerSub}</Text>

        <View className="mt-4" testID="learn-progress">
          <Progress value={total === 0 ? 0 : done / total} testID="learn-progress-bar" />
          <Text className="mt-1.5 text-caption text-dim">
            {`${done} / ${total} ${strings.learn.lessonsComplete}`}
          </Text>
        </View>

        {LEARN_GROUPS.map((group) => (
          <View key={group.id}>
            <SectionHeader title={groupTitle(group.id)} />
            <View className="overflow-hidden rounded-xl border border-line bg-surface">
              {group.lessons.map((lesson) => {
                const complete = isComplete(lesson.id, lesson.verifies);
                return (
                  <ListRow
                    key={lesson.id}
                    title={strings.learn.lesson[lesson.id].title}
                    subtitle={strings.learn.lesson[lesson.id].summary}
                    testID={`learn-lesson-${lesson.id}`}
                    right={complete ? <Badge label={strings.learn.practice.done} tone="accent" /> : undefined}
                    onPress={() => push({ name: 'lesson', lessonId: lesson.id })}
                  />
                );
              })}
            </View>
          </View>
        ))}

        {progress.completed.length > 0 ? (
          <View className="mt-8">
            <Button
              label={strings.learn.practice.reset}
              variant="secondary"
              onPress={onReset}
              testID="learn-reset"
            />
          </View>
        ) : null}
        {resetDone ? (
          <Text accessibilityLiveRegion="polite" className="mt-2 text-sm text-accent-ink" testID="learn-reset-status">
            {strings.learn.resetDone}
          </Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
