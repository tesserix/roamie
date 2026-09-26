import { useState } from 'react';
import { FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { font, useColors } from '@/constants/theme';

export function SearchPicker({ title, value, options, onChange }: {
  title: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void;
}) {
  const c = useColors(), insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false), [query, setQuery] = useState('');
  const selected = options.find(option => option.value === value)?.label ?? 'Choose';
  const close = () => { setOpen(false); setQuery(''); };
  const results = options.filter(option => (option.label + ' ' + option.value).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <View style={{ gap: 6 }}>
    <Text style={[font.caption, { color: c.muted }]}>{title}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={title + ': ' + selected} accessibilityHint="Opens a searchable list" onPress={() => setOpen(true)}
      style={({ pressed }) => ({ minHeight: 52, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: c.border, backgroundColor: pressed ? c.card : c.surface, flexDirection: 'row', gap: 12 })}>
      <Text style={[font.body, { flex: 1, color: c.text }]}>{selected}</Text><Text accessibilityElementsHidden style={{ color: c.muted }}>⌄</Text>
    </Pressable>
    <Modal visible={open} animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, paddingTop: insets.top + 16, paddingBottom: insets.bottom, paddingHorizontal: 20, backgroundColor: c.background }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Text style={[font.title, { color: c.text, flex: 1 }]}>{title}</Text>
          <Pressable accessibilityRole="button" onPress={close} style={{ minHeight: 48, justifyContent: 'center', padding: 12 }}><Text style={[font.headline, { color: c.accent }]}>Close</Text></Pressable>
        </View>
        <TextInput accessibilityLabel={'Search ' + title} value={query} onChangeText={setQuery} placeholder="Search name or code" placeholderTextColor={c.muted} autoCorrect={false}
          style={{ minHeight: 52, padding: 14, marginVertical: 12, borderRadius: 14, backgroundColor: c.surface, color: c.text, borderColor: c.border, borderWidth: 1 }} />
        <FlatList data={results} keyExtractor={item => item.value} keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<Text style={[font.body, { color: c.muted }]}>No matches. Try another name.</Text>}
          renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={item.label} accessibilityState={{ selected: value === item.value }}
            onPress={() => { onChange(item.value); close(); }}
            style={({ pressed }) => ({ minHeight: 56, paddingVertical: 16, borderBottomWidth: 1, borderColor: c.border, backgroundColor: pressed ? c.card : c.background })}>
            <Text style={[font.body, { color: value === item.value ? c.accent : c.text }]}>{item.label}{value === item.value ? ' ✓' : ''}</Text>
          </Pressable>} />
      </KeyboardAvoidingView>
    </Modal>
  </View>;
}
