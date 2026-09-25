import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { strings } from '../../constants/strings';
import { database } from '../../data';
import { loadEquipmentItems, replaceEquipmentItems, type EquipmentItemInput } from '../../data/equipment';
import { solveLoadInventory, type InventorySolveResult, type LoadItem } from '../../analytics/inventory';
import { kgToGrams, gramsToKg } from '../../utils/units';
import { useNav } from '../navigation';
import { AppHeader, Button, Card, Screen, SectionHeader, TextField } from '../components';
import { Enter } from '../motion';

interface DraftItem {
  id: string | null;
  name: string;
  weightKg: string;
  quantity: string;
  perSide: boolean;
}

const emptyDraft = (): DraftItem => ({ id: null, name: '', weightKg: '', quantity: '1', perSide: false });

function toDraft(item: { id: string; name: string; weightGrams: number; quantity: number; perSide: boolean }): DraftItem {
  return {
    id: item.id,
    name: item.name,
    weightKg: String(gramsToKg(item.weightGrams)),
    quantity: String(item.quantity),
    perSide: item.perSide,
  };
}

function parseItems(drafts: DraftItem[]): LoadItem[] {
  const out: LoadItem[] = [];
  for (const d of drafts) {
    const w = Number(d.weightKg);
    const q = Number(d.quantity);
    if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(q) || q <= 0) continue;
    out.push({
      name: d.name.trim() || `${w}kg`,
      weightGrams: kgToGrams(w),
      quantity: Math.floor(q),
      perSide: d.perSide,
    });
  }
  return out;
}

function toInputs(drafts: DraftItem[]): EquipmentItemInput[] {
  return drafts.map((d) => ({
    id: d.id,
    name: d.name,
    weightGrams: kgToGrams(Number(d.weightKg)),
    quantity: Number(d.quantity),
    perSide: d.perSide,
  }));
}

export function InventoryScreen() {
  const { pop } = useNav();
  const [targetKg, setTargetKg] = useState('100');
  const [barKg, setBarKg] = useState('20');
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [result, setResult] = useState<InventorySolveResult | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    (async () => {
      try {
        const items = await loadEquipmentItems(database);
        if (cancelled) return;
        setDrafts(items.map(toDraft));
        setLoadError(null);
      } catch {
        if (!cancelled) setLoadError(strings.inventory.loadFailed);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      mounted.current = false;
    };
  }, []);

  const items = useMemo(() => parseItems(drafts), [drafts]);

  const solve = () => {
    const target = Number(targetKg);
    const bar = Number(barKg);
    if (!Number.isFinite(target) || target < 0) return;
    setResult(
      solveLoadInventory({
        targetGrams: kgToGrams(target),
        baseGrams: Number.isFinite(bar) && bar >= 0 ? kgToGrams(bar) : 0,
        items,
      }),
    );
  };

  const updateDraft = (idx: number, patch: Partial<DraftItem>) => {
    setSaved(false);
    setSaveError(null);
    setDrafts((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const persisted = await replaceEquipmentItems(database, toInputs(drafts));
      if (!mounted.current) return;
      setDrafts(persisted.map(toDraft));
      setSaved(true);
    } catch {
      if (mounted.current) setSaveError(strings.inventory.saveFailed);
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  const statusLabel = (s: InventorySolveResult['status']) => {
    if (s === 'exact') return strings.inventory.status.exact;
    if (s === 'closest') return strings.inventory.status.closest;
    return strings.inventory.status.impossible;
  };

  return (
    <Screen>
      <AppHeader title={strings.inventory.title} onBack={pop} />
      <Enter className="flex-1">
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View className="px-4 pt-4">
          <Card>
            <View className="flex-row gap-3">
              <View className="flex-1">
                <TextField
                  label={strings.inventory.target}
                  value={targetKg}
                  onChangeText={setTargetKg}
                  keyboardType="numeric"
                />
              </View>
              <View className="flex-1">
                <TextField label={strings.inventory.bar} value={barKg} onChangeText={setBarKg} keyboardType="numeric" />
              </View>
            </View>
            <Button label={strings.inventory.solve} onPress={solve} className="mt-3" />
          </Card>
        </View>

        {result ? (
          <View className="px-4 pt-4">
            <SectionHeader title={strings.inventory.summary} />
            <Card>
              <Text className="text-lg font-semibold text-fg">{statusLabel(result.status)}</Text>
              <Text className="mt-1 text-sm text-dim">
                {strings.inventory.achieved}: {gramsToKg(result.achievedGrams)} kg
              </Text>
              <Text className="mt-0.5 text-sm text-dim">
                {strings.inventory.difference}: {gramsToKg(result.differenceGrams)} kg
              </Text>
              {result.allocations.length === 0 ? (
                <Text className="mt-2 text-sm text-dim">{strings.inventory.noAllocations}</Text>
              ) : (
                result.allocations.map((a) => (
                  <Text key={a.itemIndex} className="mt-1 font-mono text-sm text-fg">
                    {a.quantityUsed}× {a.name} ({gramsToKg(a.contributionGrams)} kg)
                  </Text>
                ))
              )}
            </Card>
          </View>
        ) : null}

        <View className="px-4 pt-4">
          <SectionHeader title={strings.inventory.items} />
          {loading ? <Text className="mb-2 text-sm text-dim">{strings.common.loading}</Text> : null}
          {loadError ? <Text className="mb-2 text-sm text-danger">{loadError}</Text> : null}
          {!loading && items.length === 0 ? (
            <Text className="mb-2 text-sm text-dim">{strings.inventory.empty}</Text>
          ) : null}
          {drafts.map((d, i) => (
            <Card key={`d${i}`} className="mb-2">
              <View className="flex-row gap-2">
                <View className="flex-[2]">
                  <TextField label={strings.inventory.name} value={d.name} onChangeText={(t) => updateDraft(i, { name: t })} />
                </View>
                <View className="flex-1">
                  <TextField
                    label={strings.inventory.weight}
                    value={d.weightKg}
                    onChangeText={(t) => updateDraft(i, { weightKg: t })}
                    keyboardType="numeric"
                  />
                </View>
                <View className="flex-1">
                  <TextField
                    label={strings.inventory.quantity}
                    value={d.quantity}
                    onChangeText={(t) => updateDraft(i, { quantity: t })}
                    keyboardType="numeric"
                  />
                </View>
              </View>
              <View className="mt-2 flex-row items-center gap-3">
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: d.perSide }}
                  onPress={() => updateDraft(i, { perSide: !d.perSide })}
                  className={`min-h-10 flex-row items-center rounded-lg border px-3 ${
                    d.perSide ? 'border-accent bg-accent/10' : 'border-line bg-surface-2'
                  }`}
                >
                  <Text className={`text-sm ${d.perSide ? 'text-accent-ink' : 'text-dim'}`}>
                    {d.perSide ? '✓ ' : ''}
                    {strings.inventory.perSide}
                  </Text>
                </Pressable>
                <Button
                  label={strings.inventory.remove}
                  variant="danger"
                  onPress={() => setDrafts((prev) => prev.filter((_, j) => j !== i))}
                  className="flex-1"
                />
              </View>
            </Card>
          ))}
          <View className="flex-row gap-2">
            <View className="flex-1">
              <Button
                label={strings.inventory.addItem}
                variant="secondary"
                onPress={() => {
                  setSaved(false);
                  setDrafts((p) => [...p, emptyDraft()]);
                }}
              />
            </View>
            <View className="flex-1">
              <Button
                label={saving ? strings.common.saving : strings.common.save}
                onPress={save}
                disabled={saving || loading}
              />
            </View>
          </View>
          {saveError ? <Text className="mt-2 text-sm text-danger">{saveError}</Text> : null}
          {saved && !saveError ? (
            <Text className="mt-2 text-sm text-dim">{strings.inventory.saved}</Text>
          ) : null}
        </View>
      </ScrollView>
      </Enter>
    </Screen>
  );
}

