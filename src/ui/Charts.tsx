import { Text, View } from 'react-native';

/**
 * Minimal deterministic bar chart (Phase 2J §22). No chart dependency —
 * plain Views, static heights (no per-frame animation), accessible summary.
 * Answers one question per instance; never decorative.
 */

export interface BarDatum {
  key: string;
  value: number;
  /** Short axis caption (e.g. day-of-week letter). */
  caption?: string;
}

export function BarChart({
  data,
  label,
  heightClass = 'h-14',
  format = (v) => String(v),
  emptyHint,
}: {
  data: BarDatum[];
  /** Accessible + visible chart question, e.g. "Daily volume". */
  label: string;
  heightClass?: string;
  format?: (v: number) => string;
  emptyHint?: string;
}) {
  const total = data.reduce((sum, d) => sum + (Number.isFinite(d.value) ? d.value : 0), 0);
  const peak = data.reduce((max, d) => (d.value > max ? d.value : max), 0);
  const summary = `${label}: ${data.map((d) => `${d.caption ?? d.key} ${format(d.value)}`).join(', ')}`;

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={summary}>
      <View className={`flex-row gap-1 ${heightClass}`}>
        {data.map((d) => {
          const ratio = peak > 0 && d.value > 0 ? d.value / peak : 0;
          return (
            <View key={d.key} className="flex-1 justify-end overflow-hidden rounded-sm bg-surface-2">
              <View
                className={`w-full rounded-sm ${d.value > 0 ? 'bg-accent' : 'bg-transparent'}`}
                style={{ height: ratio > 0 ? `${Math.max(4, Math.round(ratio * 100))}%` : 0 }}
              />
            </View>
          );
        })}
      </View>
      {data.some((d) => d.caption) ? (
        <View className="mt-1 flex-row gap-1">
          {data.map((d) => (
            <Text key={`c-${d.key}`} numberOfLines={1} className="flex-1 text-center text-overline text-dim">
              {d.caption ?? ''}
            </Text>
          ))}
        </View>
      ) : null}
      {total === 0 && emptyHint ? <Text className="mt-2 text-caption text-dim">{emptyHint}</Text> : null}
    </View>
  );
}
