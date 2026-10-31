import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { database } from '../../data';
import { strings } from '../../constants/strings';
import { findLesson } from '../../learn/content';
import {
  emptyLearnProgress,
  loadLearnProgress,
  loadLessonCounts,
  markLessonCompleted,
  saveLearnProgress,
  type LearnProgress,
  type LessonCounts,
} from '../../learn/progress';
import { useNav } from '../navigation';
import { AppHeader, Badge, Button, LoadingState, Screen, SectionHeader } from '../components';

/**
 * One lesson (D-061): prose comes entirely from the dictionary; the practice
 * step completes only on evidence (aggregate counts, D-062) or an explicit
 * confirmation for actions the database cannot observe. Nothing here writes
 * training data or gates app functionality.
 */

const EMPTY_COUNTS: LessonCounts = { userExercises: 0, routines: 0, setLogs: 0, completedSessions: 0 };

function Prose({ title, body }: { title: string; body: string }) {
  return (
    <View className="mb-4">
      <Text accessibilityRole="header" className="mb-1 text-sm font-semibold text-accent-ink">
        {title}
      </Text>
      <Text className="text-sm leading-5 text-dim">{body}</Text>
    </View>
  );
}

export function LessonScreen({ lessonId }: { lessonId: string }) {
  const { pop } = useNav();
  const lesson = findLesson(lessonId);
  const [progress, setProgress] = useState<LearnProgress>(emptyLearnProgress);
  const [counts, setCounts] = useState<LessonCounts>(EMPTY_COUNTS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      loadLearnProgress(database).catch(() => emptyLearnProgress()),
      loadLessonCounts(database).catch(() => EMPTY_COUNTS),
    ]).then(([p, c]) => {
      if (cancelled) return;
      setProgress(p);
      setCounts(c);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const verified = lesson?.verifies?.(counts) ?? false;
  const persisted = progress.completed.includes(lessonId);
  const complete = persisted || verified;

  // Evidence-verified lessons complete automatically (D-061); the persisted
  // marker is written once, so the center stays consistent after a restart.
  useEffect(() => {
    if (!loaded || !lesson || !verified || persisted) return;
    const next = markLessonCompleted(progress, lesson.id);
    setProgress(next);
    void saveLearnProgress(database, next).catch(() => {});
  }, [loaded, lesson, verified, persisted, progress]);

  const mark = useCallback(() => {
    const next = markLessonCompleted(progress, lessonId);
    setProgress(next);
    void saveLearnProgress(database, next).catch(() => {});
  }, [progress, lessonId]);

  const onVerify = useCallback(() => {
    Alert.alert(strings.learn.practice.confirmTitle, strings.learn.practice.confirmBody, [
      { text: strings.common.cancel, style: 'cancel' },
      { text: strings.learn.practice.verify, onPress: mark },
    ]);
  }, [mark]);

  if (!lesson) {
    return (
      <Screen>
        <AppHeader title={strings.learn.title} onBack={pop} />
        <Text className="px-4 py-6 text-base text-dim">{strings.learn.lessonMissing}</Text>
      </Screen>
    );
  }

  const prose = strings.learn.lesson[lesson.id];

  return (
    <Screen>
      <AppHeader title={prose.title} onBack={pop} />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} className="flex-1 px-4" testID="lesson-screen">
        <Text className="mt-4 text-body text-dim">{prose.summary}</Text>

        {loaded ? (
          <View className="mt-5">
            <Prose title={strings.learn.sectionWhat} body={prose.what} />
            <Prose title={strings.learn.sectionWhy} body={prose.why} />
            <Prose title={strings.learn.sectionHow} body={prose.how} />
            <Prose title={strings.learn.sectionExample} body={prose.example} />
          </View>
        ) : (
          <LoadingState />
        )}

        <SectionHeader title={strings.learn.sectionPractice} />
        <View className="rounded-xl border border-line bg-surface p-4" testID="lesson-practice">
          <Text className="text-sm leading-5 text-dim">{prose.practice}</Text>

          <View className="mt-4 flex-row items-center">
            <Badge
              label={complete ? strings.learn.practice.done : strings.learn.practice.notDone}
              tone={complete ? 'accent' : 'neutral'}
              testID="lesson-status"
            />
          </View>

          {!loaded ? null : complete ? (
            <Text className="mt-2 text-sm text-fg">
              {verified ? strings.learn.practice.verified : strings.learn.practice.done}
            </Text>
          ) : lesson.verifies ? (
            <Text className="mt-2 text-sm text-dim">{strings.learn.practice.verifiedHint}</Text>
          ) : (
            <Button
              label={strings.learn.practice.verify}
              onPress={onVerify}
              testID="lesson-verify"
              className="mt-3"
            />
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}
