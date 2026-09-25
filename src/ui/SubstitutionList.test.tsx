import React from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { SubstitutionList } from './SubstitutionList';
import { strings } from '../constants/strings';
import type { SubstitutionExercise } from '../analytics/substitutions';
import type { Contributions, MuscleId } from '../analytics/muscles';

const contributions = (...entries: Array<[MuscleId, number]>): Contributions => entries as Contributions;

const ex = (
  id: string | null,
  name: string,
  category: string,
  equipment: string,
  contrib: Contributions | null = null,
): SubstitutionExercise => ({ id, name, category, equipment, metricFlags: 3, contributions: contrib });

const quads = contributions(['quads', 6000], ['glutes', 3000], ['adductors', 1000]);
const chest = contributions(['chest', 7000], ['triceps', 3000]);

const target = ex('seed_back_squat', 'Back Squat', 'legs', 'barbell', quads);
const frontSquat = ex('seed_front_squat', 'Front Squat', 'legs', 'barbell', quads);
const goblet = ex('seed_goblet', 'Goblet Squat', 'legs', 'dumbbell', quads);
const bench = ex('seed_bench', 'Bench Press', 'push', 'barbell', chest);

async function renderList(
  listTarget: SubstitutionExercise,
  candidates: SubstitutionExercise[],
): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<SubstitutionList target={listTarget} candidates={candidates} />);
  });
  return renderer;
}

function textsOf(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByType(Text).map((node) => {
    const children = node.props.children;
    if (Array.isArray(children)) return children.map((c) => (typeof c === 'string' ? c : '')).join('');
    return typeof children === 'string' ? children : '';
  });
}

describe('SubstitutionList (Phase 2J)', () => {
  it('renders ranked candidates closest match first', async () => {
    const renderer = await renderList(target, [bench, goblet, frontSquat]);
    const joined = textsOf(renderer).join(' | ');
    expect(joined).toContain('Front Squat');
    expect(joined).toContain('Goblet Squat');
    expect(joined).toContain('Bench Press');
    expect(joined.indexOf('Front Squat')).toBeLessThan(joined.indexOf('Goblet Squat'));
    expect(joined.indexOf('Goblet Squat')).toBeLessThan(joined.indexOf('Bench Press'));
  });

  it('shows the equipment-only match with only its matched reasons', async () => {
    const renderer = await renderList(target, [bench]);
    const joined = textsOf(renderer).join(' | ');
    expect(joined).toContain('Bench Press');
    expect(joined).toContain(strings.substitutions.reasons.equipment);
    expect(joined).not.toContain(strings.substitutions.reasons.pattern);
    expect(joined).not.toContain(strings.substitutions.reasons.muscles);
    expect(joined).not.toContain(strings.substitutions.reasons.category);
  });

  it('shows pattern, muscles and category reasons when equipment differs', async () => {
    const renderer = await renderList(target, [goblet]);
    const joined = textsOf(renderer).join(' | ');
    expect(joined).toContain('Goblet Squat');
    expect(joined).toContain(strings.substitutions.reasons.pattern);
    expect(joined).toContain(strings.substitutions.reasons.muscles);
    expect(joined).toContain(strings.substitutions.reasons.category);
    expect(joined).not.toContain(strings.substitutions.reasons.equipment);
  });

  it('shows the empty state when nothing matches', async () => {
    const renderer = await renderList(target, [ex('run', 'Treadmill Run', 'cardio', 'machine')]);
    expect(textsOf(renderer)).toContain(strings.substitutions.none);
  });

  it('shows the empty state for no candidates', async () => {
    const renderer = await renderList(target, []);
    expect(textsOf(renderer)).toContain(strings.substitutions.none);
  });

  it('shows candidate meta (category · equipment)', async () => {
    const renderer = await renderList(target, [goblet]);
    const joined = textsOf(renderer).join(' | ');
    expect(joined).toContain('legs · dumbbell');
  });
});
