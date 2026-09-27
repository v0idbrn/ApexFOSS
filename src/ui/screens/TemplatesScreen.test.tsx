import React from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Navigator } from '../navigation';
import { TemplatesScreen } from './TemplatesScreen';
import { strings } from '../../constants/strings';
import { instantiateTemplate } from '../../templates/instantiate';

jest.mock('../../data', () => ({ database: {} }));
jest.mock('../../templates/instantiate', () => ({ instantiateTemplate: jest.fn() }));

const mockedInstantiate = instantiateTemplate as jest.MockedFunction<typeof instantiateTemplate>;

function flatten(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(flatten).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return '';
}

function textsOf(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByType(Text).map((node) => flatten(node.props.children));
}

function nodeByTestId(renderer: ReactTestRenderer, testID: string) {
  const node = renderer.root.findAll((n) => n.props?.testID === testID)[0];
  expect(node).toBeDefined();
  return node!;
}

async function renderScreen(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <Navigator>
        {(route) =>
          route.name === 'routineEditor' ? (
            <Text testID={`editor:${route.routineId}`} />
          ) : (
            <TemplatesScreen />
          )
        }
      </Navigator>,
    );
  });
  await act(async () => {});
  return renderer;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('TemplatesScreen (Phase 4F)', () => {
  it('lists all four templates with exercise counts', async () => {
    mockedInstantiate.mockResolvedValue('r1');
    const renderer = await renderScreen();
    const texts = textsOf(renderer);
    expect(texts).toContain(strings.templates.title);
    expect(texts).toContain(strings.templates.fullBody);
    expect(texts).toContain(strings.templates.pushDay);
    expect(texts).toContain(strings.templates.pullDay);
    expect(texts).toContain(strings.templates.legsDay);
    for (const key of ['fullBody', 'pushDay', 'pullDay', 'legsDay'] as const) {
      expect(nodeByTestId(renderer, `template-${key}`).type).toBeDefined();
      expect(texts).toContain(`${3} ${strings.routines.exercises}`);
    }
  });

  it('instantiates the template and opens the routine editor', async () => {
    mockedInstantiate.mockResolvedValue('r42');
    const renderer = await renderScreen();
    await act(async () => {
      nodeByTestId(renderer, 'template-use-pushDay').props.onPress();
    });
    expect(mockedInstantiate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ key: 'pushDay' }), strings.templates.pushDay);
    expect(renderer.root.findAll((n) => n.props?.testID === 'editor:r42').length).toBeGreaterThanOrEqual(1);
  });

  it('surfaces the failure message when instantiation throws', async () => {
    mockedInstantiate.mockRejectedValue(new Error('no template exercises available'));
    const renderer = await renderScreen();
    await act(async () => {
      nodeByTestId(renderer, 'template-use-fullBody').props.onPress();
    });
    expect(textsOf(renderer)).toContain(strings.templates.failed);
  });
});
