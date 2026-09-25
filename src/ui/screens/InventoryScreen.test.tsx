import React from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Navigator } from '../navigation';
import { InventoryScreen } from './InventoryScreen';
import { strings } from '../../constants/strings';
import { loadEquipmentItems, replaceEquipmentItems } from '../../data/equipment';

jest.mock('../../data', () => ({ database: {} }));
jest.mock('../../data/equipment', () => ({
  loadEquipmentItems: jest.fn(),
  replaceEquipmentItems: jest.fn(),
}));

const mockedLoad = loadEquipmentItems as jest.MockedFunction<typeof loadEquipmentItems>;
const mockedReplace = replaceEquipmentItems as jest.MockedFunction<typeof replaceEquipmentItems>;

function flatten(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(flatten).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return '';
}

function textsOf(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByType(Text).map((node) => flatten(node.props.children));
}

/** Field values live on TextInput props (host Text nodes only carry labels). */
function fieldValues(renderer: ReactTestRenderer): string[] {
  return renderer.root
    .findAll((n) => typeof n.props?.value === 'string' && typeof n.props?.onChangeText === 'function')
    .map((n) => n.props.value as string);
}

function pressableByLabel(renderer: ReactTestRenderer, label: string) {
  const node = renderer.root
    .findAll((n) => n.props?.accessibilityLabel === label && typeof n.props?.onPress === 'function')
    .pop();
  expect(node).toBeDefined();
  return node!;
}

async function renderInventory(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <Navigator>
        {() => <InventoryScreen />}
      </Navigator>,
    );
  });
  await act(async () => {});
  return renderer;
}

const plate = { id: 'eq1', name: 'Plate 20kg', weightGrams: 20_000, quantity: 4, perSide: false };

describe('InventoryScreen persistence (Phase 2J)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads the saved inventory into the item list', async () => {
    mockedLoad.mockResolvedValue([plate]);
    const renderer = await renderInventory();
    const texts = textsOf(renderer);
    expect(mockedLoad).toHaveBeenCalledTimes(1);
    expect(fieldValues(renderer)).toEqual(expect.arrayContaining(['Plate 20kg', '20', '4']));
    expect(texts).not.toContain(strings.inventory.empty);
    expect(texts).not.toContain(strings.inventory.loadFailed);
  });

  it('shows the empty hint when nothing is saved yet', async () => {
    mockedLoad.mockResolvedValue([]);
    const renderer = await renderInventory();
    expect(textsOf(renderer)).toContain(strings.inventory.empty);
  });

  it('surfaces a load failure without blocking the calculator', async () => {
    mockedLoad.mockRejectedValue(new Error('db down'));
    const renderer = await renderInventory();
    const texts = textsOf(renderer);
    expect(texts).toContain(strings.inventory.loadFailed);
    expect(texts).toContain(strings.inventory.target); // calculator fields still render
  });

  it('saves the current items and confirms with a saved message', async () => {
    mockedLoad.mockResolvedValue([plate]);
    mockedReplace.mockResolvedValue([{ ...plate, quantity: 6 }]);
    const renderer = await renderInventory();

    const save = pressableByLabel(renderer, strings.common.save);
    await act(async () => {
      save.props.onPress();
    });

    expect(mockedReplace).toHaveBeenCalledWith(expect.anything(), [
      { id: 'eq1', name: 'Plate 20kg', weightGrams: 20_000, quantity: 4, perSide: false },
    ]);
    const texts = textsOf(renderer);
    expect(texts).toContain(strings.inventory.saved);
    expect(fieldValues(renderer)).toEqual(expect.arrayContaining(['Plate 20kg', '6'])); // persisted quantity reflected
    expect(texts).not.toContain(strings.inventory.saveFailed);
  });

  it('shows a save failure when persistence rejects', async () => {
    mockedLoad.mockResolvedValue([]);
    mockedReplace.mockRejectedValue(new Error('disk full'));
    const renderer = await renderInventory();

    const save = pressableByLabel(renderer, strings.common.save);
    await act(async () => {
      save.props.onPress();
    });

    expect(textsOf(renderer)).toContain(strings.inventory.saveFailed);
    expect(textsOf(renderer)).not.toContain(strings.inventory.saved);
  });
});
