import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';
import type { ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View, type ColorValue, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ProfileSettings } from './profile-settings';
import { font, lift, radius, space, touch, useColors } from '@/constants/theme';
import { playbackVoice, speak, stopSpeaking, useSpeaking } from '@/lib/voice';
import { useAccessibility } from '@/lib/accessibility';

// iOS tabs float over content; Android tabs reserve their own space.
export const TAB_CLEARANCE = Platform.OS === 'ios' ? 96 : space.md;

const MATERIAL_SYMBOLS: Partial<Record<SFSymbol, AndroidSymbol>> = {
  'arrow.left': 'arrow_back',
  'arrow.left.arrow.right': 'swap_horiz',
  'arrow.right': 'arrow_forward',
  'arrow.triangle.turn.up.right.circle.fill': 'directions',
  'arrow.up': 'arrow_upward',
  'arrow.up.arrow.down': 'swap_vert',
  'arrow.up.left.and.arrow.down.right': 'fullscreen',
  'bag.fill': 'shopping_bag',
  'banknote.fill': 'payments',
  'bed.double.fill': 'hotel',
  'bicycle': 'pedal_bike',
  'bubble.left.and.bubble.right.fill': 'forum',
  'calendar': 'calendar_month',
  'camera': 'photo_camera',
  'camera.fill': 'photo_camera',
  'car': 'directions_car',
  'character.bubble.fill': 'translate',
  'character.cursor.ibeam': 'text_fields',
  'checkmark': 'check',
  'chevron.down': 'keyboard_arrow_down',
  'chevron.left': 'chevron_left',
  'chevron.right': 'chevron_right',
  'creditcard': 'credit_card',
  'cross.case.fill': 'local_pharmacy',
  'cross.fill': 'medical_services',
  'doc.text.viewfinder': 'document_scanner',
  'ellipsis': 'more_horiz',
  'exclamationmark.triangle': 'warning',
  'eye': 'visibility',
  'flame.fill': 'local_fire_department',
  'fork.knife': 'restaurant',
  'info.circle.fill': 'info',
  'keyboard': 'keyboard',
  'lightbulb.fill': 'lightbulb',
  'link': 'link',
  'location.fill': 'my_location',
  'location.slash.fill': 'location_off',
  'lock.fill': 'lock',
  'magnifyingglass': 'search',
  'map': 'map',
  'mappin': 'location_on',
  'mappin.and.ellipse': 'location_on',
  'mic.fill': 'mic',
  'person.badge.shield.checkmark.fill': 'support_agent',
  'phone.fill': 'call',
  'photo': 'image',
  'photo.on.rectangle': 'photo_library',
  'plus': 'add',
  'shield.fill': 'shield',
  'slider.horizontal.3': 'tune',
  'sos': 'emergency',
  'speaker.wave.2.fill': 'volume_up',
  'square.and.arrow.up': 'share',
  'square.grid.2x2.fill': 'grid_view',
  'stop.fill': 'stop',
  'sunset': 'wb_twilight',
  'text.viewfinder': 'document_scanner',
  'ticket.fill': 'confirmation_number',
  'tram.fill': 'tram',
  'trash': 'delete',
  'wallet.pass.fill': 'account_balance_wallet',
  'wave.3.right': 'contactless',
  'waveform': 'record_voice_over',
  'wifi.exclamationmark': 'wifi_off',
  'xmark': 'close',
  'xmark.circle.fill': 'cancel',
};

export function Icon({ name, size = 20, color }: { name: SFSymbol; size?: number; color: ColorValue }) {
  const material = MATERIAL_SYMBOLS[name] ?? 'help';
  return <SymbolView name={{ ios: name, android: material, web: material }} size={size} tintColor={color} accessible={false} accessibilityElementsHidden importantForAccessibility="no" resizeMode="scaleAspectFit" style={{ width: size, height: size }} />;
}

export function Screen({
  title,
  subtitle,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top + space.sm }}>
      <View style={styles.header}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[font.largeTitle, { color: c.text }]} accessibilityRole="header">
            {title}
          </Text>
          {subtitle ? (
            <Text style={[font.body, { color: c.muted }]} >
              {subtitle}
            </Text>
          ) : null}
        </View>
        {right}
        <ProfileSettings />
      </View>
      {children}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const c = useColors();
  return <View style={[styles.card, lift, { backgroundColor: c.surface }, style]}>{children}</View>;
}

type ButtonProps = {
  label: string;
  onPress: () => void;
  icon?: SFSymbol;
  kind?: 'primary' | 'secondary' | 'danger';
  busy?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
};

export function Button({ label, onPress, icon, kind = 'primary', busy, disabled, style }: ButtonProps) {
  const c = useColors();
  const bg = kind === 'primary' ? c.accent : kind === 'danger' ? c.danger : c.surface;
  const fg = kind === 'secondary' ? c.text : c.onAccent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        kind === 'secondary' && { borderWidth: 1, borderColor: c.border },
        { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.85 : 1 },
        style,
      ]}>
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={18} color={fg} /> : null}
          <Text style={[font.headline, { color: fg, flexShrink: 1, textAlign: 'center' }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({
  icon,
  label,
  onPress,
  tone = 'plain',
}: {
  icon: SFSymbol;
  label: string;
  onPress: () => void;
  tone?: 'plain' | 'soft';
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [
        styles.iconButton,
        { backgroundColor: tone === 'soft' ? c.surface : 'transparent', opacity: pressed ? 0.6 : 1 },
        tone === 'soft' && lift,
      ]}>
      <Icon name={icon} size={20} color={c.text} />
    </Pressable>
  );
}

export function Chip({
  label,
  icon,
  selected,
  onPress,
}: {
  label: string;
  icon?: SFSymbol;
  selected?: boolean;
  onPress: () => void;
}) {
  const c = useColors();
  const fg = selected ? c.onAccent : c.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? c.accent : c.surface,
          borderColor: selected ? c.accent : c.border,
          opacity: pressed ? 0.8 : 1,
        },
      ]}>
      {icon ? <Icon name={icon} size={15} color={fg} /> : null}
      <Text style={{ color: fg, fontSize: 15, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export function Badge({ icon, tint, bg, size = 40 }: { icon: SFSymbol; tint: ColorValue; bg: ColorValue; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={icon} size={size * 0.45} color={tint} />
    </View>
  );
}

export function Message({ icon, title, body, action }: { icon?: SFSymbol; title: string; body?: string; action?: ReactNode }) {
  const c = useColors();
  return (
    <View style={styles.message}>
      {icon ? <Badge icon={icon} tint={c.accent} bg={c.accentSoft} size={64} /> : null}
      <Text maxFontSizeMultiplier={2} style={[font.headline, { color: c.text, textAlign: 'center', fontSize: 19 }]}>{title}</Text>
      {body ? <Text maxFontSizeMultiplier={2} style={[font.body, { color: c.muted, textAlign: 'center' }]}>{body}</Text> : null}
      {action ? <View style={{ paddingTop: space.sm, alignSelf: 'stretch' }}>{action}</View> : null}
    </View>
  );
}

export function SectionLabel({ children }: { children: string }) {
  const c = useColors();
  return <Text style={[font.overline, { color: c.muted, paddingHorizontal: space.xs }]}>{children}</Text>;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
}: {
  disabled?: boolean;
  options: { value: T; label: string; icon: SFSymbol }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const c = useColors();
  return (
    <View accessibilityRole="tablist" style={[styles.segmented, { backgroundColor: c.card }]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityLabel={o.label}
            disabled={disabled}
            accessibilityState={{ selected: on, disabled }}
            onPress={() => onChange(o.value)}
            style={[styles.segment, on && [lift, { backgroundColor: c.surface }]]}>
            <Icon name={o.icon} size={15} color={on ? c.accent : c.muted} />
            <Text maxFontSizeMultiplier={2} style={{ color: on ? c.text : c.muted, fontSize: 14, fontWeight: '600', flexShrink: 1, textAlign: 'center' }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Play/stop toggle for one piece of text; `id` keeps two identical texts independent. */
export function SpeakButton({ text, lang, id, tone = 'soft', offlineOnly = false }: { text: string; lang: string; id?: string; tone?: 'soft' | 'plain'; offlineOnly?: boolean }) {
  const c = useColors();
  const key = id ?? `${lang}:${text}`;
  const speaking = useSpeaking(key);
  const { voice } = useAccessibility();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={speaking ? 'Stop reading' : 'Read aloud'}
      hitSlop={8}
      onPress={() => (speaking ? stopSpeaking() : speak(text, lang, key, playbackVoice(voice), offlineOnly))}
      style={({ pressed }) => [
        styles.iconButton,
        { backgroundColor: tone === 'soft' ? c.accentSoft : 'transparent', opacity: pressed ? 0.6 : 1 },
      ]}>
      <Icon name={speaking ? 'stop.fill' : 'speaker.wave.2.fill'} size={18} color={c.accent} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
  },
  card: { borderRadius: 24, padding: 20, gap: 14 },
  button: {
    flexShrink: 1,
    minWidth: 48,
    minHeight: touch + 4,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: 12,
  },
  iconButton: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  chip: {
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  segmented: { flexDirection: 'row', borderRadius: radius.md, padding: 3, marginHorizontal: space.md },
  segment: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', minHeight: 48, paddingVertical: 8, borderRadius: radius.md - 3 },
  message: { alignItems: 'center', gap: space.sm, paddingHorizontal: space.xl, paddingVertical: space.xl },
});
