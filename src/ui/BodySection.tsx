import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { database } from '../data';
import { makeDbActions } from '../data/actions';
import { summarizeBody, type BodySummary } from '../analytics/body';
import { strings } from '../constants/strings';
import { cmToMm, formatCm, formatKg, kgToGrams } from '../utils/units';
import {
  Button,
  Card,
  EmptyState,
  IconButton,
  NumberField,
  SectionHeader,
  confirmDestructive,
} from './components';

interface BodyRow {
  id: string;
  measuredAt: number;
  weightGrams: number | null;
  waistMm: number | null;
}

/**
 * Phase 4E: body measurements (weight / waist) — logging only, integer
 * units; trend math lives in the pure summarizeBody helper.
 */
export function BodySection() {
  const [rows, setRows] = useState<BodyRow[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [kg, setKg] = useState<number | null>(null);
  const [cm, setCm] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      setRows(await makeDbActions(database).listBodyMetrics());
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = async () => {
    if (kg == null && cm == null) {
      setError(strings.body.atLeastOne);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await makeDbActions(database).logBodyMetrics({
        measuredAt: Date.now(),
        weightGrams: kg != null ? kgToGrams(kg) : null,
        waistMm: cm != null ? cmToMm(cm) : null,
      });
      setAdding(false);
      setKg(null);
      setCm(null);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = (row: BodyRow) => {
    confirmDestructive(strings.body.deleteConfirm, () => {
      void makeDbActions(database)
        .deleteBodyMetric(row.id)
        .then(reload);
    });
  };

  if (rows === null) return null;

  const summary: BodySummary = summarizeBody(
    rows.map((r) => ({ timestampMs: r.measuredAt, weightGrams: r.weightGrams, waistMm: r.waistMm })),
  );

  const valuesOf = (weightGrams: number | null, waistMm: number | null): string => {
    const parts: string[] = [];
    if (weightGrams != null) parts.push(`${formatKg(weightGrams)} kg`);
    if (waistMm != null) parts.push(`${formatCm(waistMm)} cm`);
    return parts.join(' · ');
  };

  const deltaOf = (weightDeltaGrams: number | null, waistDeltaMm: number | null): string | null => {
    const parts: string[] = [];
    if (weightDeltaGrams != null && weightDeltaGrams !== 0) parts.push(`${formatKg(weightDeltaGrams)} kg`);
    if (waistDeltaMm != null && waistDeltaMm !== 0) parts.push(`${formatCm(waistDeltaMm)} cm`);
    return parts.length > 0 ? parts.join(' · ') : null;
  };

  const delta = summary.latest ? deltaOf(summary.weightDeltaGrams, summary.waistDeltaMm) : null;
  const dateLabel = (ms: number) =>
    new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  return (
    <View>
      <SectionHeader
        title={strings.body.title}
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={strings.body.add}
            onPress={() => setAdding((v) => !v)}
            testID="body-add"
            hitSlop={8}
          >
            <Text className="text-caption font-semibold text-accent-ink">{strings.body.add}</Text>
          </Pressable>
        }
      />

      {adding ? (
        <Card testID="body-form">
          <NumberField label={strings.body.weight} value={kg} onChange={setKg} suffix="kg" />
          <View className="mt-3">
            <NumberField label={strings.body.waist} value={cm} onChange={setCm} suffix="cm" />
          </View>
          {error ? (
            <Text accessibilityRole="alert" className="mt-2 text-caption text-danger">
              {error}
            </Text>
          ) : null}
          <View className="mt-3 flex-row gap-2">
            <Button
              label={strings.body.add}
              onPress={() => void save()}
              disabled={busy}
              className="flex-1"
            />
            <Button
              label={strings.common.cancel}
              variant="secondary"
              onPress={() => {
                setAdding(false);
                setKg(null);
                setCm(null);
                setError(null);
              }}
              className="flex-1"
            />
          </View>
        </Card>
      ) : null}

      {summary.latest ? (
        <Card testID="body-summary">
          <Text className="text-overline uppercase text-accent-ink">{strings.body.latest}</Text>
          <Text className="mt-1 text-card-title text-fg">
            {valuesOf(summary.latest.weightGrams, summary.latest.waistMm)}
          </Text>
          {delta ? (
            <Text className="mt-0.5 text-caption text-dim">{delta}</Text>
          ) : null}
        </Card>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState message={strings.body.emptyBody} />
      ) : (
        <View className="mt-3 overflow-hidden rounded-xl border border-line">
          {rows.map((row) => (
            <View key={row.id} testID={`body-row-${row.id}`} className="flex-row items-center border-b border-line px-4 py-3">
              <View className="flex-1 pr-2">
                <Text className="text-base font-medium text-fg">{dateLabel(row.measuredAt)}</Text>
                <Text className="mt-0.5 text-sm text-dim">{valuesOf(row.weightGrams, row.waistMm)}</Text>
              </View>
              <IconButton
                label={strings.body.delete}
                glyph="×"
                variant="danger"
                testID={`body-delete-${row.id}`}
                onPress={() => remove(row)}
              />
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
