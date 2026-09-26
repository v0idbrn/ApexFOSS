import React, { useEffect } from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Navigator, useNav, type Route } from '../navigation';
import { Badge, EmptyState } from '../components';
import { RoutinePreviewScreen } from './RoutinePreviewScreen';
import { strings } from '../../constants/strings';
import { emptyDraft, emptyPrescription, type RoutineDraft } from '../../types/draft';

function flatten(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(flatten).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return '';
}

function textsOf(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByType(Text).map((node) => flatten(node.props.children));
}

function workStep(localId: string, exerciseName: string, sets: number): RoutineDraft['blocks'][number]['steps'][number] {
  return {
    localId,
    exerciseId: `ex-${localId}`,
    exerciseName,
    prescription: { ...emptyPrescription(), targetSets: sets },
    transition: { type: 'immediate', delayMs: 0 },
  };
}

function draftWithSteps(): RoutineDraft {
  return {
    id: 'r1',
    name: 'Push day',
    blocks: [
      {
        localId: 'blk-1',
        name: 'Main',
        kind: 'normal',
        rounds: 1,
        steps: [workStep('s1', 'Bench Press', 2), workStep('s2', 'Overhead Press', 1)],
        interval: null,
      },
    ],
  };
}

async function renderPreview(draft: RoutineDraft): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <Navigator>
        {() => <RoutinePreviewScreen draft={draft} />}
      </Navigator>,
    );
  });
  return renderer;
}

/** Mounts the preview on top of a home entry so the empty action can pop back. */
function PreviewLauncher({ launched }: { launched: { value: boolean } }) {
  const { push } = useNav();
  useEffect(() => {
    if (launched.value) return;
    launched.value = true;
    push({ name: 'routinePreview', draft: emptyDraft() });
  }, [launched, push]);
  return <Text testID="home-route" />;
}

describe('RoutinePreviewScreen (Phase 2J §14)', () => {
  it('shows the empty state when no blocks or steps exist', async () => {
    const renderer = await renderPreview(emptyDraft());
    const texts = textsOf(renderer);
    expect(texts).toContain(strings.preview.empty);
    expect(texts).toContain(strings.preview.how);
    expect(texts).not.toContain(strings.preview.byExercise);
  });

  it('summarizes simulated work sets, planned rest and blocks', async () => {
    const renderer = await renderPreview(draftWithSteps());
    const texts = textsOf(renderer);
    expect(texts).toContain(strings.preview.title);
    expect(texts).toContain(strings.preview.workSets);
    expect(texts).toContain('3'); // 2 + 1 sets
    expect(texts).toContain(strings.preview.plannedRest);
    expect(texts).toContain(strings.preview.blocks);
    expect(texts).toContain('1');
    expect(texts).toContain(strings.preview.exercises);
    expect(texts).toContain('2');
  });

  it('lists sets per exercise from the engine simulation', async () => {
    const renderer = await renderPreview(draftWithSteps());
    const joined = textsOf(renderer).join(' ');
    expect(joined).toContain(strings.preview.byExercise);
    expect(joined).toContain('Bench Press');
    expect(joined).toContain('2 sets');
    expect(joined).toContain('Overhead Press');
    expect(joined).toContain('1 sets');
    expect(joined).toContain(strings.preview.how);
  });

  it('does not warn about truncation for a finite routine', async () => {
    const renderer = await renderPreview(draftWithSteps());
    expect(textsOf(renderer)).not.toContain(strings.preview.truncated);
  });

  it('shows a clean routine-checks section for a healthy draft', async () => {
    const renderer = await renderPreview(draftWithSteps());
    const texts = textsOf(renderer);
    expect(texts).toContain(strings.integrity.title);
    expect(texts).toContain(strings.integrity.ok);
    expect(texts).not.toContain(strings.integrity.error);
    expect(texts).not.toContain(strings.integrity.warning);
  });

  it('surfaces integrity issues from the draft conversion', async () => {
    const draft = draftWithSteps();
    draft.blocks[0].steps[1] = {
      ...draft.blocks[0].steps[1],
      prescription: { ...emptyPrescription(), targetSets: null },
    };
    const renderer = await renderPreview(draft);
    const joined = textsOf(renderer).join(' ');
    expect(joined).toContain(strings.integrity.title);
    expect(joined).toContain(strings.integrity.messages.zero_target_sets);
    expect(joined).toContain(strings.integrity.warning);
    expect(joined).toContain('Overhead Press');
    expect(joined).not.toContain(strings.integrity.ok);
  });

  it('flags an empty block inside an otherwise valid draft', async () => {
    const draft = draftWithSteps();
    draft.blocks.push({
      localId: 'blk-2',
      name: 'Assist',
      kind: 'normal',
      rounds: 1,
      steps: [],
      interval: null,
    });
    const renderer = await renderPreview(draft);
    const joined = textsOf(renderer).join(' ');
    expect(joined).toContain(strings.integrity.messages.empty_routine);
    expect(joined).toContain('Assist');
    expect(joined).toContain(strings.integrity.error);
  });
});

describe('RoutinePreviewScreen accessibility (Phase 2L STAGE H)', () => {
  function buttonsOf(renderer: ReactTestRenderer) {
    return renderer.root.findAll(
      (node) => typeof node.type === 'string' && node.props?.accessibilityRole === 'button',
    );
  }

  function emptyPreview(renderer: ReactTestRenderer) {
    return renderer.root
      .findAllByType(EmptyState)
      .find((node) => node.props.title === strings.preview.empty);
  }

  it('labels the empty preview and both back affordances', async () => {
    const renderer = await renderPreview(emptyDraft());
    const empty = emptyPreview(renderer);
    expect(empty).toBeDefined();
    expect(empty!.props.message).toBe(strings.preview.how);
    expect(empty!.props.actionLabel).toBe(strings.common.back);
    expect(typeof empty!.props.onAction).toBe('function');

    const buttons = buttonsOf(renderer);
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    for (const node of buttons) {
      expect(node.props.accessibilityLabel).toBe(strings.common.back);
      expect(node.props.accessibilityState).toBeDefined();
      expect(typeof node.props.className).toBe('string');
      expect(/\bh-(12|14|16|20|24|32)\b/.test(node.props.className)).toBe(true);
    }
  });

  it('sends the empty-preview action back to the editor stack', async () => {
    const routes: Route[] = [];
    const launched = { value: false };
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <Navigator>
          {(route) => {
            routes.push(route);
            if (route.name === 'routinePreview') return <RoutinePreviewScreen draft={emptyDraft()} />;
            if (route.name === 'home') return <PreviewLauncher launched={launched} />;
            return null;
          }}
        </Navigator>,
      );
    });
    expect(routes[routes.length - 1]).toEqual(expect.objectContaining({ name: 'routinePreview' }));

    const empty = emptyPreview(renderer);
    expect(empty).toBeDefined();
    await act(async () => {
      empty!.props.onAction();
    });

    expect(routes[routes.length - 1]).toEqual(expect.objectContaining({ name: 'home' }));
    expect(renderer.root.findAllByProps({ testID: 'home-route' }).length).toBeGreaterThanOrEqual(1);
  });

  it('announces the routine-checks and per-exercise sections as headings', async () => {
    const renderer = await renderPreview(draftWithSteps());
    const headers = renderer.root
      .findAll((node) => node.props?.accessibilityRole === 'header')
      .map((node) => flatten(node.props.children));
    expect(headers).toContain(strings.integrity.title);
    expect(headers).toContain(strings.preview.byExercise);
  });

  it('labels integrity severity with words instead of colour alone', async () => {
    const warnedDraft = draftWithSteps();
    warnedDraft.blocks[0].steps[1] = {
      ...warnedDraft.blocks[0].steps[1],
      prescription: { ...emptyPrescription(), targetSets: null },
    };
    const warned = await renderPreview(warnedDraft);
    const warningLabels = warned.root.findAllByType(Badge).map((badge) => badge.props.label);
    expect(warningLabels).toContain(strings.integrity.warning);
    expect(warningLabels).not.toContain(strings.integrity.error);

    const errorDraft = draftWithSteps();
    errorDraft.blocks.push({
      localId: 'blk-2',
      name: 'Assist',
      kind: 'normal',
      rounds: 1,
      steps: [],
      interval: null,
    });
    const failed = await renderPreview(errorDraft);
    const errorLabels = failed.root.findAllByType(Badge).map((badge) => badge.props.label);
    expect(errorLabels).toContain(strings.integrity.error);
  });
});
