import React from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Numpad } from './Numpad';
import type { NumpadField } from './numpadInput';
import { strings } from '../constants/strings';

function flatten(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(flatten).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return '';
}

async function renderNumpad(field: NumpadField): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <Numpad field={field} onKey={jest.fn()} onModifier={jest.fn()} onClear={jest.fn()} />,
    );
  });
  return renderer;
}

function textNodes(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByType(Text).map((t) => flatten(t.props.children));
}

describe('Numpad field label footer (Phase 2K V3b)', () => {
  it('labels weight as "Weight (kg)" exactly once', async () => {
    const renderer = await renderNumpad('weight');
    const texts = textNodes(renderer);
    const footers = texts.filter((t) => t.startsWith(`${strings.numpad.active}:`));
    expect(footers).toEqual([`${strings.numpad.active}: ${strings.routines.prescription.weight}`]);
    expect(footers[0]).toBe('Editing: Weight (kg)');
    expect(texts.some((t) => t.includes('(kg) (kg)'))).toBe(false);
  });

  it('labels duration as "Duration (s)" exactly once', async () => {
    const renderer = await renderNumpad('duration');
    const texts = textNodes(renderer);
    const footers = texts.filter((t) => t.startsWith(`${strings.numpad.active}:`));
    expect(footers).toEqual([`${strings.numpad.active}: ${strings.routines.prescription.duration}`]);
    expect(footers[0]).toBe('Editing: Duration (s)');
    expect(texts.some((t) => t.includes('(s) (s)'))).toBe(false);
  });

  it('labels reps without a duplicated suffix', async () => {
    const renderer = await renderNumpad('reps');
    const texts = textNodes(renderer);
    const footers = texts.filter((t) => t.startsWith(`${strings.numpad.active}:`));
    expect(footers).toEqual([`${strings.numpad.active}: ${strings.routines.prescription.reps}`]);
    expect(texts.some((t) => t.includes('(reps) (reps)'))).toBe(false);
  });

  it('labels rir from the canonical workout string', async () => {
    const renderer = await renderNumpad('rir');
    const texts = textNodes(renderer);
    const footers = texts.filter((t) => t.startsWith(`${strings.numpad.active}:`));
    expect(footers).toEqual([`${strings.numpad.active}: ${strings.workout.rir}`]);
    expect(texts.some((t) => /\(\w+\)\s*\(\w+\)/.test(t))).toBe(false);
  });

  it('falls back to the tap hint when no field is active', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<Numpad field={null} onKey={jest.fn()} onModifier={jest.fn()} onClear={jest.fn()} />);
    });
    expect(textNodes(renderer)).toContain(strings.numpad.tapField);
  });
});
