import {
  ActivityIndicator,
  Alert,
  Pressable,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState, type ReactNode } from 'react';
import { strings } from '../constants/strings';
import { theme } from '../theme';

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

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <View className={`rounded-xl border border-line bg-surface p-4 ${className}`}>{children}</View>;
}

export function SectionHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <View className="mb-2 mt-6 flex-row items-center justify-between">
      <Text className="text-xs font-semibold uppercase tracking-wider text-dim">{title}</Text>
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
  message,
  actionLabel,
  onAction,
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View className="items-center px-6 py-10">
      <Text className="mb-6 text-center text-base text-dim">{message}</Text>
      {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} /> : null}
    </View>
  );
}

export function confirmDestructive(message: string, onConfirm: () => void) {
  Alert.alert(strings.common.delete, message, [
    { text: strings.common.cancel, style: 'cancel' },
    { text: strings.common.delete, style: 'destructive', onPress: onConfirm },
  ]);
}
