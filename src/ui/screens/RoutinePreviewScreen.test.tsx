import React from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Navigator } from '../navigation';
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
});
