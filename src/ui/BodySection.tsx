import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { database } from '../data';
import { makeDbActions } from '../data/actions';
import { formatBodyDelta, formatBodyEntry, normalizeBodyEntries, summarizeBody } from '../analytics/body';
import { strings } from '../constants/strings';
import { cmToMm, kgToGrams } from '../utils/units';
import {
  BODY_MEASUREMENT_TYPES,
  BODY_STORAGE_UNITS,
  isBilateralMeasurement,
  type BodyMeasurementType,
} from '../types/body';
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
  measurementType: string | null;
  side: string | null;
  value: number | null;
  unit: string | null;
  weightGrams: number | null;
  waistMm: number | null;
}

function measurementTypeLabel(type: string): string {
  const keyMap: Record<string, keyof typeof strings.body> = {
    body_weight: 'bodyWeight',
    waist: 'waistLabel',
    neck: 'neck',
    chest: 'chest',
    shoulders: 'shoulders',
    hip: 'hip',
    upper_arm: 'upperArm',
    forearm: 'forearm',
    thigh: 'thigh',
    calf: 'calf',
  };
  return strings.body[keyMap[type] ?? 'bodyWeight'];
}

function measurementIdentityLabel(type: string, side: string | null): string {
  if (side === 'left') return `${measurementTypeLabel(type)} (${strings.body.left})`;
  if (side === 'right') return `${measurementTypeLabel(type)} (${strings.body.right})`;
  return measurementTypeLabel(type);
}

function dateLabel(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Body measurements use one canonical record per measurement identity; display
 * values remain metric while storage stays in integer grams/millimeters.
 */
export function BodySection() {
  const [rows, setRows] = useState<BodyRow[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [measurementType, setMeasurementType] = useState<string>('body_weight');
  const [side, setSide] = useState<string | null>(null);
  const [displayValue, setDisplayValue] = useState<number | null>(null);
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

  const selectedUnit = useMemo(() => {
    return BODY_STORAGE_UNITS[measurementType as keyof typeof BODY_STORAGE_UNITS] === 'g' ? 'kg' : 'cm';
  }, [measurementType]);

  const showSideSelector = isBilateralMeasurement(measurementType);

  const selectMeasurementType = (next: string) => {
    setMeasurementType(next);
    if (!isBilateralMeasurement(next)) setSide(null);
    setDisplayValue(null);
    setError(null);
  };

  const save = async () => {
    if (displayValue == null || !Number.isFinite(displayValue) || displayValue <= 0) {
      setError(strings.body.atLeastOne);
      return;
    }
    const value = measurementType === 'body_weight' ? kgToGrams(displayValue) : cmToMm(displayValue);
    setBusy(true);
    setError(null);
    try {
      await makeDbActions(database).logBodyMetrics({
        measuredAt: Date.now(),
        measurementType,
        side: side || null,
        value,
        unit: BODY_STORAGE_UNITS[measurementType as keyof typeof BODY_STORAGE_UNITS],
      });
      setAdding(false);
      setMeasurementType('body_weight');
      setSide(null);
      setDisplayValue(null);
      setError(null);
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
  const summary = summarizeBody(
    rows.map((row) => ({
      timestampMs: row.measuredAt,
      measurementType: row.measurementType,
      side: row.side,
      value: row.value,
      unit: row.unit,
      weightGrams: row.weightGrams,
      waistMm: row.waistMm,
    })),
  );

  return (
    <View className="flex-1">
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
          <Text className="text-caption text-dim mb-1">{strings.body.measurementType}</Text>
          <View className="flex-row flex-wrap gap-2">
            {BODY_MEASUREMENT_TYPES.map((option: BodyMeasurementType) => (
              <Pressable
                key={option}
                accessibilityRole="button"
                accessibilityLabel={measurementTypeLabel(option)}
                accessibilityState={{ selected: measurementType === option }}
                onPress={() => selectMeasurementType(option)}
                testID={`body-type-${option}`}
                className={`rounded-lg border px-3 py-2 ${
                  measurementType === option ? 'border-accent bg-accent/10' : 'border-line bg-surface'
                }`}
              >
                <Text className={`text-sm ${measurementType === option ? 'text-accent-ink' : 'text-dim'}`}>
                  {measurementTypeLabel(option)}
                </Text>
              </Pressable>
            ))}
          </View>

          {showSideSelector ? (
            <View className="mt-3">
              <Text className="text-caption text-dim mb-1">{strings.body.side}</Text>
              <View className="flex-row gap-2">
                {(['left', 'right'] as const).map((option) => (
                  <Pressable
                    key={option}
                    accessibilityRole="button"
                    accessibilityLabel={strings.body[option]}
                    accessibilityState={{ selected: side === option }}
                    onPress={() => setSide(option)}
                    testID={`body-side-${option}`}
                    className={`flex-1 items-center rounded-lg border px-3 py-3 ${
                      side === option ? 'border-accent bg-accent/10' : 'border-line bg-surface'
                    }`}
                  >
                    <Text className={`text-sm ${side === option ? 'text-accent-ink' : 'text-dim'}`}>
                      {strings.body[option]}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          <View className="mt-3">
            <NumberField
              label={measurementTypeLabel(measurementType)}
              value={displayValue}
              onChange={setDisplayValue}
              suffix={selectedUnit}
            />
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
                setMeasurementType('body_weight');
                setSide(null);
                setDisplayValue(null);
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
          <View className="mt-1">
            {Object.entries(summary.latestByIdentity).map(([identity, entry]) => (
              <View key={identity} className="mb-2">
                <Text className="text-caption text-dim">
                  {measurementIdentityLabel(entry.measurementType, entry.side)}
                </Text>
                <Text className="text-card-title text-fg">{formatBodyEntry(entry)}</Text>
                {summary.deltas[identity] ? (
                  <Text className="text-caption text-dim">{formatBodyDelta(summary.deltas[identity])}</Text>
                ) : null}
              </View>
            ))}
          </View>
        </Card>
      ) : null}

      <SectionHeader title={strings.body.history} />
      {rows.length === 0 ? (
        <EmptyState message={strings.body.emptyBody} />
      ) : (
        <View className="overflow-hidden rounded-xl border border-line">
          {rows.map((row) => (
            <View
              key={row.id}
              testID={`body-row-${row.id}`}
              className="flex-row items-center border-b border-line px-4 py-3"
            >
              <View className="flex-1 pr-2">
                <Text className="text-base font-medium text-fg">{dateLabel(row.measuredAt)}</Text>
                <Text className="mt-0.5 text-sm text-dim">{formatBodyEntryForRow(row)}</Text>
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

  function formatBodyEntryForRow(row: BodyRow): string {
    const entries = normalizeBodyEntries([
      {
        timestampMs: row.measuredAt,
        measurementType: row.measurementType,
        side: row.side,
        value: row.value,
        unit: row.unit,
        weightGrams: row.weightGrams,
        waistMm: row.waistMm,
      },
    ]);
    if (entries.length === 0) return strings.body.empty;
    return entries
      .map((entry) => `${measurementIdentityLabel(entry.measurementType, entry.side)}: ${formatBodyEntry(entry)}`)
      .join(' · ');
  }
}
