import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { Icon } from '@/components/ui';
import { font, useColors } from '@/constants/theme';

const MAX_LENGTH = 500;
const split = (text: string) => text.split(',').map(item => item.trim()).filter(Boolean);

export function InterestList({ label, value, change, placeholder }: { label: string; value: string; change: (value: string) => void; placeholder?: string }) {
  const c = useColors();
  const [draft, setDraft] = useState('');
  const items = split(value);
  function add() {
    const next = [...items];
    for (const item of split(draft)) if (!next.some(existing => existing.toLowerCase() === item.toLowerCase())) next.push(item);
    const joined = next.join(', ');
    if (joined.length > MAX_LENGTH) return;
    setDraft('');
    if (next.length !== items.length) change(joined);
  }
  return <View style={{ gap: 8 }}>
    <Text style={[font.caption, { color: c.muted }]}>{label}</Text>
    <TextInput accessibilityLabel={label} accessibilityHint="Press return to add it to your list" value={draft} onChangeText={setDraft} onSubmitEditing={add} onBlur={add} submitBehavior="submit" returnKeyType="done" placeholder={placeholder} placeholderTextColor={c.faint} maxLength={160} style={{ minHeight: 48, borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 12, color: c.text, backgroundColor: c.surface }} />
    {items.length ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {items.map(item => <Pressable key={item} accessibilityRole="button" accessibilityLabel={`Remove ${item}`} onPress={() => change(items.filter(other => other !== item).join(', '))} hitSlop={6} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingLeft: 14, paddingRight: 10, borderRadius: 999, backgroundColor: c.accentSoft, opacity: pressed ? 0.7 : 1 })}>
        <Text style={{ color: c.text, fontSize: 15, fontWeight: '600' }}>{item}</Text>
        <Icon name="xmark" size={12} color={c.muted} />
      </Pressable>)}
    </View> : null}
  </View>;
}
