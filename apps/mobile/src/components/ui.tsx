import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radius, space, touch, useColors } from '@/constants/theme';

export function Screen({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top + space.sm }}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: c.text }]} accessibilityRole="header">
          {title}
        </Text>
        {right}
      </View>
      {children}
    </View>
  );
}

type ButtonProps = {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger';
  busy?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
};

export function Button({ label, onPress, kind = 'primary', busy, disabled, style }: ButtonProps) {
  const c = useColors();
  const bg = kind === 'primary' ? c.accent : kind === 'danger' ? c.danger : c.card;
  const fg = kind === 'secondary' ? c.text : c.onAccent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.8 : 1 },
        style,
      ]}>
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[styles.buttonText, { color: fg }]}>{label}</Text>}
    </Pressable>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? c.accent : c.card,
          borderColor: selected ? c.accent : c.border,
          opacity: pressed ? 0.8 : 1,
        },
      ]}>
      <Text style={{ color: selected ? c.onAccent : c.text, fontSize: 15, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export function Message({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  const c = useColors();
  return (
    <View style={styles.message}>
      <Text style={{ color: c.text, fontSize: 18, fontWeight: '600', textAlign: 'center' }}>{title}</Text>
      {body ? <Text style={{ color: c.muted, fontSize: 15, textAlign: 'center' }}>{body}</Text> : null}
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.md,
    paddingBottom: space.sm,
  },
  title: { fontSize: 32, fontWeight: '800' },
  button: {
    minHeight: touch + 8,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
  },
  buttonText: { fontSize: 17, fontWeight: '700' },
  chip: {
    minHeight: touch - 8,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    justifyContent: 'center',
  },
  message: { alignItems: 'center', gap: space.sm, padding: space.xl },
});
