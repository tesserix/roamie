import { useState } from 'react';
import { Keyboard, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { font, useColors } from '@/constants/theme';
import { Button, Icon, IconButton } from './ui';

export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function tripDateLabel(value: string): string {
  return new Date(`${value}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
export function TripDatePicker({ value, minimumDate, onChange }: { value: string; minimumDate: string; onChange: (value: string) => void }) {
  const c = useColors(), insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => new Date(`${value || minimumDate}T12:00:00`));
  const first = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const offset = (first.getDay() + 6) % 7;
  const previousDisabled = localDate(first).slice(0, 7) <= minimumDate.slice(0, 7);
  const weeks = Math.ceil((offset + days) / 7);
  const move = (amount: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + amount, 1, 12));
  return <View style={{ gap: 6 }}>
    <Text style={[font.caption, { color: c.muted }]}>Departure date</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={`Departure date: ${value ? tripDateLabel(value) : 'Choose a date'}`}
      onPress={() => { Keyboard.dismiss(); setMonth(new Date(`${value || minimumDate}T12:00:00`)); setOpen(true); }}
      style={({ pressed }) => ({ minHeight: 52, borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: pressed ? c.card : c.surface, borderWidth: 1, borderColor: c.border })}>
      <Icon name="calendar" color={c.accent} />
      <Text style={[font.body, { flex: 1, color: value ? c.text : c.muted }]}>{value ? tripDateLabel(value) : 'Choose a date'}</Text>
      <Icon name="chevron.down" size={12} color={c.muted} />
    </Pressable>
    <Modal visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
      <ScrollView accessibilityViewIsModal contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 16, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24, gap: 20, backgroundColor: c.background }}>
        <Text accessibilityRole="header" style={[font.title, { color: c.text }]}>Choose your departure</Text>
        <Text style={[font.body, { color: c.muted }]}>Plan ahead. Your other dates will follow.</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Previous month" accessibilityState={{ disabled: previousDisabled }} disabled={previousDisabled} onPress={() => move(-1)} style={({ pressed }) => ({ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', opacity: previousDisabled ? 0.35 : pressed ? 0.6 : 1 })}><Icon name="chevron.left" color={c.text} /></Pressable>
          <Text accessibilityLiveRegion="polite" style={[font.headline, { color: c.text, flex: 1, textAlign: 'center' }]}>{month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</Text>
          <IconButton icon="chevron.right" label="Next month" onPress={() => move(1)} />
        </View>
        <View style={{ gap: 4 }}>
          <View style={{ flexDirection: 'row' }}>{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, i) => <Text key={i} accessible={false} style={[font.caption, { flex: 1, textAlign: 'center', color: c.muted }]}>{day}</Text>)}</View>
          {Array.from({ length: weeks }, (_, week) => <View key={week} style={{ flexDirection: 'row' }}>
            {Array.from({ length: 7 }, (_, col) => {
              const day = week * 7 + col - offset + 1;
              if (day < 1 || day > days) return <View key={col} style={{ flex: 1 }} />;
              const date = new Date(month.getFullYear(), month.getMonth(), day, 12), iso = localDate(date);
              const disabled = iso < minimumDate, selected = iso === value;
              return <Pressable key={col} accessibilityRole="button" accessibilityLabel={date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                accessibilityState={{ disabled, selected }} disabled={disabled} onPress={() => { onChange(iso); setOpen(false); }}
                style={({ pressed }) => ({ flex: 1, minHeight: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? c.accent : pressed ? c.accentSoft : c.surface, opacity: disabled ? 0.35 : 1 })}>
                <Text maxFontSizeMultiplier={1.5} style={[font.body, { color: selected ? c.onAccent : c.text }]}>{day}</Text>
              </Pressable>;
            })}
          </View>)}
        </View>
        <Button label="Next year" kind="secondary" onPress={() => move(12)} />
        <Button label="Cancel date selection" kind="secondary" onPress={() => setOpen(false)} />
      </ScrollView>
    </Modal>
  </View>;
}
