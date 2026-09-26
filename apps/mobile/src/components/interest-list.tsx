import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { Icon } from '@/components/ui';
import { font, useColors } from '@/constants/theme';

const MAX_LENGTH = 500;
const split = (text: string) => text.split(',').map(item => item.trim()).filter(Boolean);

export function combineInterests(value: string, draft: string) {
  const next = split(value);
  for (const item of split(draft)) if (!next.some(existing => existing.toLowerCase() === item.toLowerCase())) next.push(item);
  const joined = next.join(', ');
  if (joined.length > MAX_LENGTH) throw new Error('Keep your interests within 500 characters. Shorten an entry or remove one.');
  return joined;
}

export function InterestList({ label, value, draft, changeDraft, change, placeholder }: { label: string; value: string; draft: string; changeDraft: (value: string) => void; change: (value: string) => void; placeholder?: string }) {
  const c = useColors();
  const [error, setError] = useState('');
  const items = split(value);
  function add() {
    try {
      const joined = combineInterests(value, draft);
      changeDraft('');
      setError('');
      if (joined !== value) change(joined);
    } catch (error) { setError(error instanceof Error ? error.message : 'Please shorten your interests.'); }
  }
  return <View style={{ gap: 8 }}>
    <Text style={[font.caption, { color: c.muted }]}>{label}</Text>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
    <TextInput accessibilityLabel={label} accessibilityHint="Press return or tap Add to add it to your list" value={draft} onChangeText={text => { changeDraft(text); setError(''); }} onSubmitEditing={add} onBlur={add} submitBehavior="submit" returnKeyType="done" placeholder={placeholder} placeholderTextColor={c.faint} maxLength={160} style={{ flex: 1, minHeight: 48, borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 12, color: c.text, backgroundColor: c.surface }} />
    <Pressable accessibilityRole="button" accessibilityLabel="Add interest" disabled={!draft.trim()} accessibilityState={{ disabled: !draft.trim() }} onPress={add}
      style={({ pressed }) => ({ minHeight: 48, paddingHorizontal: 16, justifyContent: 'center', borderRadius: 12, backgroundColor: c.accentSoft, opacity: !draft.trim() ? 0.4 : pressed ? 0.7 : 1 })}>
      <Text style={[font.body, { color: c.accent, fontWeight: '600' }]}>Add</Text>
    </Pressable>
    </View>
    {error ? <Text accessibilityRole="alert" style={[font.caption, { color: c.danger }]}>{error}</Text> : null}
    {items.length ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {items.map(item => <Pressable key={item} accessibilityRole="button" accessibilityLabel={`Remove ${item}`} onPress={() => change(items.filter(other => other !== item).join(', '))} hitSlop={6} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 48, paddingLeft: 14, paddingRight: 10, borderRadius: 999, backgroundColor: c.accentSoft, opacity: pressed ? 0.7 : 1 })}>
        <Text style={{ color: c.text, fontSize: 15, fontWeight: '600' }}>{item}</Text>
        <Icon name="xmark" size={12} color={c.muted} />
      </Pressable>)}
    </View> : null}
  </View>;
}
