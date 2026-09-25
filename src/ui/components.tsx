import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Pressable,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { strings } from '../constants/strings';
import { theme } from '../theme';
import { useReducedMotion } from './motion';

/** Shared AMOLED UI primitives. 8dp spacing base, 48dp minimum touch targets. */

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const buttonStyles: Record<Variant, string> = {
  primary: 'bg-accent',
  secondary: 'bg-surface border border-line',
  danger: 'bg-danger/15 border border-danger',
  ghost: 'bg-transparent',
};

const buttonTextStyles: Record<Variant, string> = {
  primary: 'text-fg font-semibold',
  secondary: 'text-fg',
  danger: 'text-danger font-semibold',
  ghost: 'text-accent-ink',
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  className = '',
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => (pressed ? { opacity: 0.85, transform: [{ scale: 0.99 }] } : undefined)}
      className={`h-12 min-h-12 flex-row items-center justify-center rounded-lg px-4 ${
        disabled ? 'opacity-50' : ''
      } ${buttonStyles[variant]} ${className}`}
    >
      <Text className={`text-base ${buttonTextStyles[variant]}`}>{label}</Text>
    </Pressable>
  );
}

export function Screen({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-bg">
      {children}
    </SafeAreaView>
  );
}

export function AppHeader({
  title,
  onBack,
  right,
}: {
  title: string;
  onBack?: () => void;
  right?: ReactNode;
}) {
  return (
    <View className="h-14 min-h-14 flex-row items-center border-b border-line bg-bg px-1">
      {onBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={strings.common.back}
          onPress={onBack}
          className="h-12 w-12 items-center justify-center"
        >
          <Text className="text-2xl text-accent-ink">‹</Text>
        </Pressable>
      ) : (
        <View className="w-4" />
      )}
      <Text numberOfLines={1} className="flex-1 px-1 text-lg font-semibold text-fg">
        {title}
      </Text>
      {right ?? <View className="w-4" />}
    </View>
  );
}

export function HeaderButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className="h-12 w-12 items-center justify-center"
    >
      <Text className="text-2xl text-accent-ink">+</Text>
    </Pressable>
  );
}

export function FieldLabel({ text }: { text: string }) {
  return <Text className="mb-1 text-sm text-dim">{text}</Text>;
}

export function TextField({
  label,
  error,
  ...props
}: TextInputProps & { label?: string; error?: string | null }) {
  const [focused, setFocused] = useState(false);
  return (
    <View>
      {label ? <FieldLabel text={label} /> : null}
      <TextInput
        {...props}
        onFocus={(e) => {
          setFocused(true);
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          props.onBlur?.(e);
        }}
        placeholderTextColor="#a3a3a3"
        className={`h-12 min-h-12 rounded-lg border bg-surface-2 px-3 text-base text-fg ${
          error ? 'border-danger' : focused ? 'border-accent' : 'border-line'
        }`}
      />
      {error ? <Text className="mt-1 text-sm text-danger">{error}</Text> : null}
    </View>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  suffix,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  suffix?: string;
}) {
  return (
    <View className="flex-1">
      <FieldLabel text={label} />
      <View className="h-12 min-h-12 flex-row items-center rounded-lg border border-line bg-surface-2 px-3">
        <TextInput
          keyboardType="numeric"
          value={value === null ? '' : String(value)}
          onChangeText={(t) => {
            const s = t.trim();
            if (!s) return onChange(null);
            const n = Number(s);
            onChange(Number.isFinite(n) ? n : null);
          }}
          placeholder="—"
          placeholderTextColor="#a3a3a3"
          className="h-11 flex-1 text-base text-fg"
        />
        {suffix ? <Text className="ml-1 text-sm text-dim">{suffix}</Text> : null}
      </View>
    </View>
  );
}

export function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      className={`h-12 min-h-12 flex-row items-center justify-center rounded-full border px-4 ${
        active ? 'border-accent bg-accent/10' : 'border-line bg-surface'
      }`}
    >
      <Text className={`text-sm ${active ? 'text-accent-ink' : 'text-dim'}`}>{label}</Text>
    </Pressable>
  );
}

export function ListRow({
  title,
  subtitle,
  onPress,
  right,
}: {
  title: string;
  subtitle?: string;
  onPress: () => void;
  right?: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => (pressed ? { opacity: 0.8 } : undefined)}
      className="min-h-14 flex-row items-center border-b border-line px-4 py-3"
    >
      <View className="flex-1 pr-2">
        <Text numberOfLines={1} className="text-base font-medium text-fg">
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} className="mt-0.5 text-sm text-dim">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ?? <Text className="text-xl text-dim">›</Text>}
    </Pressable>
  );
}

export function PressableRow({
  label,
  value,
  placeholder,
  onPress,
}: {
  label: string;
  value: string;
  placeholder?: boolean;
  onPress: () => void;
}) {
  return (
    <View>
      <FieldLabel text={label} />
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        className="min-h-12 flex-row items-center justify-between rounded-lg border border-line bg-surface-2 px-3 py-2"
      >
        <Text numberOfLines={1} className={`flex-1 text-base ${placeholder ? 'text-dim' : 'text-fg'}`}>
          {value}
        </Text>
        <Text className="ml-2 text-accent-ink">›</Text>
      </Pressable>
    </View>
  );
}

const cardTones: Record<CardTone, string> = {
  default: 'border-line bg-surface',
  tonal: 'border-line bg-surface-2',
  accent: 'border-accent bg-accent/10',
  inset: 'border-line bg-bg',
};

export type CardTone = 'default' | 'tonal' | 'accent' | 'inset';

export function Card({
  children,
  className = '',
  tone = 'default',
}: {
  children: ReactNode;
  className?: string;
  tone?: CardTone;
}) {
  return <View className={`rounded-xl border p-4 ${cardTones[tone]} ${className}`}>{children}</View>;
}

export function SectionHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <View className="mb-2 mt-6 flex-row items-center justify-between">
      <Text className="text-overline uppercase text-dim">{title}</Text>
      {right}
    </View>
  );
}

export function LoadingState({ label }: { label?: string }) {
  return (
    <View className="items-center py-8">
      <ActivityIndicator color={theme.colors.accent} />
      <Text className="mt-2 text-sm text-dim">{label ?? strings.common.loading}</Text>
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View className="items-center px-6 py-8">
      <Text className="mb-4 text-center text-base text-danger">{message}</Text>
      {onRetry ? <Button label={strings.common.retry} variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

export function EmptyState({
  title,
  message,
  description,
  actionLabel,
  onAction,
}: {
  title?: string;
  message: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  if (!title) {
    return (
      <View className="items-center px-6 py-10">
        <Text className="mb-6 text-center text-base text-dim">{message}</Text>
        {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} /> : null}
      </View>
    );
  }
  return (
    <View className="items-center rounded-xl border border-line bg-surface px-6 py-8">
      <Text className="text-center text-heading text-fg">{title}</Text>
      <Text className="mt-2 text-center text-body text-dim">{message}</Text>
      {description ? <Text className="mt-1.5 text-center text-caption text-dim">{description}</Text> : null}
      {actionLabel && onAction ? (
        <View className="mt-5 w-full">
          <Button label={actionLabel} onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}

/** Large mono training number with optional unit (metric typographic role). */
export function Metric({
  value,
  unit,
  size = 'md',
  className = '',
}: {
  value: string;
  unit?: string;
  size?: 'xl' | 'lg' | 'md';
  className?: string;
}) {
  const sizeClass = size === 'xl' ? 'text-metric-xl' : size === 'lg' ? 'text-metric-lg' : 'text-metric';
  return (
    <View className={`flex-row items-baseline ${className}`}>
      <Text className={`font-mono ${sizeClass} text-fg`}>{value}</Text>
      {unit ? <Text className="ml-1 text-caption text-dim">{unit}</Text> : null}
    </View>
  );
}

/** Dashboard metric tile: overline label + big mono value + optional hint. */
export function MetricCard({
  label,
  value,
  unit,
  hint,
  emphasis = false,
  onPress,
  testID,
  className = '',
}: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  emphasis?: boolean;
  onPress?: () => void;
  testID?: string;
  className?: string;
}) {
  const body = (
    <>
      <Text className="text-overline uppercase text-dim">{label}</Text>
      <View className="mt-1 flex-row items-baseline">
        <Text className={`font-mono ${emphasis ? 'text-metric-xl' : 'text-metric-lg'} text-fg`}>{value}</Text>
        {unit ? <Text className="ml-1 text-caption text-dim">{unit}</Text> : null}
      </View>
      {hint ? <Text className="mt-0.5 text-caption text-dim">{hint}</Text> : null}
    </>
  );
  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value}${unit ? ` ${unit}` : ''}`}
        onPress={onPress}
        testID={testID}
        style={({ pressed }) => (pressed ? { opacity: 0.85 } : undefined)}
        className={`min-h-12 flex-1 rounded-xl border border-line bg-surface p-3.5 ${className}`}
      >
        {body}
      </Pressable>
    );
  }
  return (
    <View testID={testID} className={`rounded-xl border border-line bg-surface p-3.5 ${className}`}>
      {body}
    </View>
  );
}

const badgeTones: Record<BadgeTone, string> = {
  neutral: 'border-line bg-surface-2 text-dim',
  accent: 'border-accent/60 bg-accent/10 text-accent-ink',
  strong: 'border-accent bg-accent text-fg',
  danger: 'border-danger/60 bg-danger/10 text-danger',
};

export type BadgeTone = 'neutral' | 'accent' | 'strong' | 'danger';

/** Small status/label chip (non-interactive). Pair with text labels, never color alone. */
export function Badge({ label, tone = 'neutral', testID }: { label: string; tone?: BadgeTone; testID?: string }) {
  const ink = tone === 'strong' ? 'text-fg' : tone === 'danger' ? 'text-danger' : tone === 'accent' ? 'text-accent-ink' : 'text-dim';
  return (
    <View testID={testID} className={`self-start rounded-full border px-2.5 py-1 ${badgeTones[tone]}`}>
      <Text className={`text-overline uppercase ${ink}`}>{label}</Text>
    </View>
  );
}

/**
 * Determinate progress bar (0..1). Animated width for comprehension;
 * static when the system reduce-motion setting is on.
 */
export function Progress({
  value,
  tone = 'accent',
  label,
  testID,
}: {
  value: number;
  tone?: 'accent' | 'dim';
  label?: string;
  testID?: string;
}) {
  const reduced = useReducedMotion();
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const anim = useRef(new Animated.Value(clamped)).current;
  useEffect(() => {
    if (reduced) {
      anim.setValue(clamped);
      return;
    }
    const timing = Animated.timing(anim, {
      toValue: clamped,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    timing.start();
    return () => timing.stop();
  }, [clamped, reduced, anim]);
  const width = anim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100), text: label }}
      className="h-2 min-h-2 w-full overflow-hidden rounded-full bg-surface-2"
    >
      <Animated.View
        className={`h-full rounded-full ${tone === 'accent' ? 'bg-accent' : 'bg-line'}`}
        style={{ width }}
      />
    </View>
  );
}

/** Hairline separator. */
export function Divider({ className = '' }: { className?: string }) {
  return <View className={`h-px min-h-px w-full bg-line ${className}`} />;
}

/** Label/value row with a mono value — for compact stat lists. */
export function StatRow({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View testID={testID} className="flex-row items-center justify-between py-1.5">
      <Text className="text-body text-dim">{label}</Text>
      <Text className="font-mono text-body text-fg">{value}</Text>
    </View>
  );
}

/** Compact navigation tile used in dashboard tool grids (≥48dp target). */
export function ActionTile({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => (pressed ? { opacity: 0.8 } : undefined)}
      className="min-h-12 flex-1 items-center justify-center rounded-xl border border-line bg-surface px-2 py-3"
    >
      <Text numberOfLines={1} className="text-center text-caption text-fg">
        {label}
      </Text>
    </Pressable>
  );
}

/** ≥48dp icon button for header/inline actions. Glyph is a text character (no icon dependency). */
export function IconButton({
  label,
  glyph,
  onPress,
  variant = 'ghost',
  disabled,
  testID,
}: {
  label: string;
  glyph: string;
  onPress: () => void;
  variant?: 'ghost' | 'tonal' | 'danger';
  disabled?: boolean;
  testID?: string;
}) {
  const tones = {
    ghost: 'border-transparent bg-transparent',
    tonal: 'border-line bg-surface',
    danger: 'border-danger/60 bg-danger/10',
  } as const;
  const ink = variant === 'danger' ? 'text-danger' : variant === 'tonal' ? 'text-fg' : 'text-accent-ink';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      style={({ pressed }) => (pressed ? { opacity: 0.75 } : undefined)}
      className={`h-12 min-h-12 w-12 items-center justify-center rounded-lg border ${tones[variant]} ${disabled ? 'opacity-50' : ''}`}
    >
      <Text className={`text-lg ${ink}`}>{glyph}</Text>
    </Pressable>
  );
}

export function confirmDestructive(message: string, onConfirm: () => void) {
  Alert.alert(strings.common.delete, message, [
    { text: strings.common.cancel, style: 'cancel' },
    { text: strings.common.delete, style: 'destructive', onPress: onConfirm },
  ]);
}
