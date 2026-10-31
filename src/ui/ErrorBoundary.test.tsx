import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ErrorBoundary } from './ErrorBoundary';
import { strings } from '../constants/strings';

/**
 * Crash boundary: a render crash shows the localized fallback instead of
 * exiting to the launcher, and "retry" remounts the tree (full reset so a
 * deterministic screen crash cannot loop forever on the same route).
 */

let explode = false;

function Bomb({ onDefuse }: { onDefuse?: () => void }) {
  if (explode) throw new Error('render bomb');
  return (
    <View>
      <Text>alive</Text>
      {onDefuse ? (
        <TouchableOpacity onPress={onDefuse}>
          <Text>defuse</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

beforeEach(() => {
  explode = true;
});

afterEach(() => {
  explode = false;
});

async function renderBoundary(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
  });
  return renderer;
}

function textOf(node: { props: { children?: unknown } }): string {
  const c = node.props.children;
  return String(Array.isArray(c) ? c.join('') : c ?? '');
}

const allText = (r: ReactTestRenderer) => r.root.findAllByType(Text).map(textOf);

describe('ErrorBoundary', () => {
  it('catches a render crash and shows the localized fallback', async () => {
    const renderer = await renderBoundary();
    // The crashed subtree is gone; the fallback must be the only visible content.
    expect(allText(renderer)).toEqual([`${strings.crash.title}\n\n${strings.crash.body}`, strings.common.retry]);
  });

  it('remounts the whole tree after retry (looping crash cannot re-lock the UI)', async () => {
    const renderer = await renderBoundary();
    expect(allText(renderer)).toEqual([`${strings.crash.title}\n\n${strings.crash.body}`, strings.common.retry]);
    // Defuse: the next mount does not throw. If retry merely re-rendered the
    // same crashed children, the crash would loop and stay on the fallback.
    explode = false;
    const retry = renderer.root.find(
      (n) => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === 'Retry',
    );
    await act(async () => {
      retry.props.onPress();
    });
    expect(allText(renderer)).toEqual(['alive']);
  });

  it('renders children normally when nothing throws', async () => {
    explode = false;
    const renderer = await renderBoundary();
    expect(allText(renderer)).toEqual(['alive']);
  });
});
