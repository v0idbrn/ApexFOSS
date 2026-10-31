import React from 'react';
import { Alert, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Navigator, useNav } from '../navigation';
import { LearnScreen } from './LearnScreen';
import { LessonScreen } from './LessonScreen';
import { WelcomeScreen } from './WelcomeScreen';
import { strings } from '../../constants/strings';
import {
  emptyLearnProgress,
  loadLearnProgress,
  loadLessonCounts,
  saveLearnProgress,
} from '../../learn/progress';

jest.mock('../../data', () => ({ database: {} }));
jest.mock('../../learn/progress', () => {
  const actual = jest.requireActual('../../learn/progress');
  return {
    ...actual,
    loadLearnProgress: jest.fn(),
    loadLessonCounts: jest.fn(),
    saveLearnProgress: jest.fn(() => Promise.resolve()),
  };
});

const mockedProgress = loadLearnProgress as jest.MockedFunction<typeof loadLearnProgress>;
const mockedCounts = loadLessonCounts as jest.MockedFunction<typeof loadLessonCounts>;
const mockedSave = saveLearnProgress as jest.MockedFunction<typeof saveLearnProgress>;

const ZERO_COUNTS = { userExercises: 0, routines: 0, setLogs: 0, completedSessions: 0 };

function flatten(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(flatten).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return '';
}

function textContents(renderer: ReactTestRenderer): string[] {
  return renderer.root
    .findAllByType(Text)
    .map((t) => flatten(t.props.children))
    .filter((s) => s.length > 0);
}

function pressableByTestID(renderer: ReactTestRenderer, testID: string) {
  return renderer.root
    .findAll((node) => node.props?.testID === testID && typeof node.props?.onPress === 'function')
    .find((node) => node.props?.accessibilityRole === 'button');
}

function pressableByLabel(renderer: ReactTestRenderer, label: string) {
  return renderer.root
    .findAll(
      (node) =>
        node.props?.accessibilityRole === 'button' &&
        node.props?.accessibilityLabel === label &&
        typeof node.props?.onPress === 'function',
    )
    .find(Boolean);
}

let nav: ReturnType<typeof useNav>;

function NavProbe() {
  nav = useNav();
  return null;
}

async function renderLearnApp(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <Navigator>
        {(route) => (
          <>
            {route.name === 'learn' ? (
              <LearnScreen />
            ) : route.name === 'lesson' ? (
              <LessonScreen lessonId={route.lessonId} />
            ) : (
              <Text testID="route">{route.name}</Text>
            )}
            <NavProbe />
          </>
        )}
      </Navigator>,
    );
  });
  await act(async () => {
    nav.push({ name: 'learn' });
  });
  await act(async () => {});
  return renderer;
}

async function openLesson(renderer: ReactTestRenderer, id: string): Promise<void> {
  const row = pressableByTestID(renderer, `learn-lesson-${id}`);
  expect(row).toBeDefined();
  await act(async () => {
    row!.props.onPress();
  });
  await act(async () => {});
}

beforeEach(() => {
  mockedProgress.mockReset();
  mockedProgress.mockResolvedValue(emptyLearnProgress());
  mockedCounts.mockReset();
  mockedCounts.mockResolvedValue(ZERO_COUNTS);
  mockedSave.mockReset();
  mockedSave.mockResolvedValue(undefined);
});

describe('LearnScreen center', () => {
  it('lists every lesson with its group and progress summary', async () => {
    const renderer = await renderLearnApp();
    const texts = textContents(renderer);
    expect(texts).toContain(strings.learn.centerSub);
    expect(texts).toContain(strings.learn.groupBasics);
    expect(texts).toContain(strings.learn.groupData);
    expect(texts).toContain(strings.learn.lesson.intro.title);
    expect(texts).toContain(strings.learn.lesson.export.summary);
    expect(texts).toContain(`0 / 14 ${strings.learn.lessonsComplete}`);
  });

  it('marks persisted and evidence-verified lessons as complete', async () => {
    mockedProgress.mockResolvedValue({ version: 1, welcomeDone: true, completed: ['intro'] });
    mockedCounts.mockResolvedValue({ ...ZERO_COUNTS, userExercises: 1 });
    const renderer = await renderLearnApp();
    const introRow = renderer.root
      .findAll((n) => n.props?.testID === 'learn-lesson-intro' && typeof n.props?.onPress === 'function')[0];
    const libraryRow = renderer.root
      .findAll((n) => n.props?.testID === 'learn-lesson-library' && typeof n.props?.onPress === 'function')[0];
    expect(textContents(renderer)).toContain(`2 / 14 ${strings.learn.lessonsComplete}`);
    expect(flatten(introRow.findAllByType(Text).map((t) => t.props.children))).toContain(
      strings.learn.practice.done,
    );
    expect(flatten(libraryRow.findAllByType(Text).map((t) => t.props.children))).toContain(
      strings.learn.practice.done,
    );
  });

  it('opens a lesson from its row', async () => {
    const renderer = await renderLearnApp();
    await openLesson(renderer, 'intro');
    expect(renderer.root.findAllByProps({ testID: 'lesson-screen' }).length).toBeGreaterThanOrEqual(1);
    expect(textContents(renderer)).toContain(strings.learn.lesson.intro.what);
  });

  it('returns from a lesson to the center with the system back affordance', async () => {
    const renderer = await renderLearnApp();
    await openLesson(renderer, 'intro');
    const back = pressableByLabel(renderer, strings.common.back);
    expect(back).toBeDefined();
    await act(async () => {
      back!.props.onPress();
    });
    expect(renderer.root.findAllByProps({ testID: 'learn-center' }).length).toBeGreaterThanOrEqual(1);
    expect(textContents(renderer)).toContain(strings.learn.lesson.export.title);
  });

  it('resets only Learn markers and preserves the welcome flag', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockedProgress.mockResolvedValue({ version: 1, welcomeDone: true, completed: ['intro'] });
    const renderer = await renderLearnApp();

    const reset = pressableByTestID(renderer, 'learn-reset');
    expect(reset).toBeDefined();
    await act(async () => {
      reset!.props.onPress();
    });
    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    const confirm = buttons.find((b) => b.text === strings.learn.practice.reset);
    expect(confirm?.onPress).toBeDefined();
    await act(async () => {
      confirm!.onPress!();
    });

    expect(mockedSave).toHaveBeenCalledTimes(1);
    expect(mockedSave).toHaveBeenCalledWith(
      {},
      { version: 1, welcomeDone: true, completed: [] },
    );
    expect(textContents(renderer)).toContain(strings.learn.resetDone);
    expect(textContents(renderer)).toContain(`0 / 14 ${strings.learn.lessonsComplete}`);
    alert.mockRestore();
  });
});

describe('LessonScreen completion', () => {
  it('requires explicit confirmation for practice the data cannot observe', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const renderer = await renderLearnApp();
    await openLesson(renderer, 'intro');

    const verify = pressableByTestID(renderer, 'lesson-verify');
    expect(verify).toBeDefined();
    await act(async () => {
      verify!.props.onPress();
    });
    expect(alert).toHaveBeenCalledWith(
      strings.learn.practice.confirmTitle,
      strings.learn.practice.confirmBody,
      expect.any(Array),
    );

    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    const confirm = buttons.find((b) => b.text === strings.learn.practice.verify);
    expect(confirm?.onPress).toBeDefined();
    await act(async () => {
      confirm!.onPress!();
    });

    expect(mockedSave).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ completed: ['intro'] }),
    );
    expect(textContents(renderer)).toContain(strings.learn.practice.done);
    alert.mockRestore();
  });

  it('completes an evidence lesson automatically once the counts prove it', async () => {
    mockedCounts.mockResolvedValue({ ...ZERO_COUNTS, routines: 2 });
    const renderer = await renderLearnApp();
    await openLesson(renderer, 'createRoutine');

    expect(textContents(renderer)).toContain(strings.learn.practice.verified);
    expect(mockedSave).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ completed: ['createRoutine'] }),
    );
  });

  it('shows the evidence hint and no button while the data does not prove it', async () => {
    const renderer = await renderLearnApp();
    await openLesson(renderer, 'runSession');

    expect(pressableByTestID(renderer, 'lesson-verify')).toBeUndefined();
    expect(textContents(renderer)).toContain(strings.learn.practice.verifiedHint);
    expect(mockedSave).not.toHaveBeenCalled();
  });

  it('shows a safe fallback for an unknown lesson id', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <Navigator>
          {(route) => (route.name === 'lesson' ? <LessonScreen lessonId={route.lessonId} /> : <NavProbe />)}
        </Navigator>,
      );
    });
    await act(async () => {
      nav.push({ name: 'lesson', lessonId: 'gone' });
    });
    await act(async () => {});
    expect(textContents(renderer)).toContain(strings.learn.lessonMissing);
  });
});

describe('WelcomeScreen', () => {
  it('offers both non-blocking paths and explains where lessons live', async () => {
    const onLearn = jest.fn();
    const onKnown = jest.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<WelcomeScreen onLearn={onLearn} onKnown={onKnown} />);
    });

    const texts = textContents(renderer);
    expect(texts).toContain(strings.learn.welcome.title);
    expect(texts).toContain(strings.learn.welcome.principles);
    expect(texts).toContain(strings.learn.welcome.doneBody);

    await act(async () => {
      pressableByTestID(renderer, 'welcome-learn')!.props.onPress();
    });
    expect(onLearn).toHaveBeenCalledTimes(1);
    expect(onKnown).not.toHaveBeenCalled();

    await act(async () => {
      pressableByTestID(renderer, 'welcome-known')!.props.onPress();
    });
    expect(onKnown).toHaveBeenCalledTimes(1);
  });
});
