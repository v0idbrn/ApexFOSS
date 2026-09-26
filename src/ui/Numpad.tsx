import { Pressable, Text, View } from 'react-native';
import type { NumpadField, NumpadKey, NumpadModifier } from './numpadInput';
import { compatibleModifiers } from './numpadInput';
import { strings } from '../constants/strings';

/**
 * Bottom athlete numpad panel. AMOLED, high contrast, ≥48dp targets, no animation.
 * Pure presentation — all value mutation stays in WorkoutScreen via numpad.ts.
 */

const MODIFIER_LABELS: Record<NumpadModifier, string> = {
  'kg+1.25': '+1.25',
  'kg+2.5': '+2.5',
  'kg+5': '+5',
  'reps+1': '+1',
  'reps-1': '−1',
};

function KeyCap({
  label,
  onPress,
  muted,
  testID,
}: {
  label: string;
  onPress: () => void;
  muted?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      onPress={onPress}
      className={`min-h-12 flex-1 items-center justify-center rounded-lg border ${
        muted ? 'border-line bg-surface' : 'border-line bg-surface-2'
      }`}
      style={{ minWidth: 48, minHeight: 48 }}
    >
      <Text className={`text-xl font-semibold ${muted ? 'text-dim' : 'text-fg'}`}>{label}</Text>
    </Pressable>
  );
}

export function Numpad({
  field,
  onKey,
  onModifier,
  onClear,
  disabled,
}: {
  field: NumpadField | null;
  onKey: (key: NumpadKey) => void;
  onModifier: (mod: NumpadModifier) => void;
  onClear: () => void;
  disabled?: boolean;
}) {
  const mods = field ? compatibleModifiers(field) : [];
  const rows: NumpadKey[][] = [
    ['7', '8', '9'],
    ['4', '5', '6'],
    ['1', '2', '3'],
    ['.', '0', 'backspace'],
  ];

  return (
    <View
      className="border-t border-line bg-bg px-3 pb-3 pt-2"
      testID="athlete-numpad"
      accessibilityLabel={strings.numpad.title}
    >
      {mods.length > 0 ? (
        <View className="mb-2 flex-row flex-wrap gap-2">
          {mods.map((m) => (
            <Pressable
              key={m}
              accessibilityRole="button"
              accessibilityLabel={`${strings.numpad.modifierPrefix} ${MODIFIER_LABELS[m]}`}
              testID={`mod-${m}`}
              disabled={disabled}
              onPress={() => onModifier(m)}
              className={`min-h-12 flex-row items-center justify-center rounded-lg border border-line bg-surface px-3 ${
                disabled ? 'opacity-50' : ''
              }`}
              style={{ minHeight: 48 }}
            >
              <Text className="text-sm font-semibold text-accent-ink">
                {MODIFIER_LABELS[m]}
                {m.startsWith('kg') ? ` ${strings.workout.weight}` : ` ${strings.workout.reps}`}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View className="gap-2">
        {rows.map((row, ri) => (
          <View key={ri} className="flex-row gap-2">
            {row.map((k) => (
              <KeyCap
                key={k}
                testID={`key-${k}`}
                label={k === 'backspace' ? strings.numpad.backspace : k}
                muted={k === '.' || k === 'backspace'}
                onPress={() => {
                  if (!disabled) onKey(k);
                }}
              />
            ))}
          </View>
        ))}
        <View className="flex-row gap-2">
          <KeyCap
            testID="key-clear"
            label={strings.numpad.clear}
            muted
            onPress={() => {
              if (!disabled) onClear();
            }}
          />
        </View>
      </View>
      <Text className="mt-2 text-center text-xs text-dim">
        {field
          ? `${strings.numpad.active}: ${fieldLabel(field)}`
          : strings.numpad.tapField}
      </Text>
    </View>
  );
}

function fieldLabel(field: NumpadField): string {
  switch (field) {
    case 'weight':
      return strings.routines.prescription.weight;
    case 'reps':
      return strings.routines.prescription.reps;
    case 'duration':
      return strings.routines.prescription.duration;
    case 'rir':
      return strings.workout.rir;
  }
}

/** Display-only workout numeric field — opens the athlete numpad, not the system keyboard. */
export function NumpadField({
  label,
  display,
  suffix,
  active,
  onPress,
  testID,
}: {
  label: string;
  display: string;
  suffix?: string;
  active: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <View className="flex-1">
      <Text className={`mb-1 text-sm ${active ? 'text-accent-ink' : 'text-dim'}`}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        accessibilityLabel={label}
        testID={testID}
        onPress={onPress}
        className={`min-h-12 flex-row items-center rounded-lg border px-3 ${
          active ? 'border-accent bg-accent/10' : 'border-line bg-surface-2'
        }`}
        style={{ minHeight: 48 }}
      >
        <Text
          numberOfLines={1}
          className={`flex-1 font-mono text-metric ${display === '' ? 'text-dim' : 'text-fg'}`}
        >
          {display === '' ? '—' : display}
        </Text>
        {suffix ? <Text className="ml-1 text-sm text-dim">{suffix}</Text> : null}
      </Pressable>
    </View>
  );
}
