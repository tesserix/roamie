import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { font, useColors } from '@/constants/theme';
import { searchDestinations } from '@/lib/trip-api';
import { Icon } from './ui';
import type { Destination } from '@/lib/trip-contract';

export function DestinationLookup({ selected, onSelect, label = 'Destination' }: {
  label?: string;
  selected: Destination | null; onSelect: (destination: Destination | null) => void;
}) {
  const c = useColors();
  const [query, setQuery] = useState(selected?.label ?? '');
  const [results, setResults] = useState<Destination[]>([]);
  const [status, setStatus] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    if (selected || query.trim().length < 2) return;
    const controller = new AbortController();
    let live = true;
    const timer = setTimeout(() => {
      void searchDestinations(query.trim(), controller.signal).then(items => {
        if (!live) return;
        setResults(items);
        setStatus(items.length ? 'Choose a destination below.' : 'No matches. Try a city and country.');
      }).catch(() => {
        if (live) setStatus('Search unavailable. Check your connection and retry.');
      });
    }, 350);
    return () => { live = false; clearTimeout(timer); controller.abort(); };
  }, [query, selected, retry]);
  return <View style={{ gap: 10 }}>
    <Text style={[font.caption, { color: c.muted }]}>{label}</Text>
    {selected ? <Pressable accessibilityRole="button" accessibilityLabel={`Change ${label}: ${selected.label}`} onPress={() => onSelect(null)}
      style={({ pressed }) => ({ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, opacity: pressed ? 0.6 : 1 })}>
      <Icon name="mappin" color={c.accent} />
      <View style={{ flex: 1, gap: 4 }}><Text style={[font.headline, { color: c.text }]}>{selected.name}</Text><Text style={[font.caption, { color: c.muted }]}>{selected.country}</Text></View>
      <Text style={[font.caption, { color: c.accent }]}>Change</Text>
    </Pressable> : <TextInput accessibilityLabel={label} value={query} maxLength={160} autoCorrect={false}
      onChangeText={text => { setQuery(text); onSelect(null); setResults([]); setStatus(text.trim().length >= 2 ? 'Searching destinations…' : 'Type a city or country.'); }}
      placeholder="Search a city or country" placeholderTextColor={c.muted}
      style={{ minHeight: 52, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, color: c.text }} />}
    {!selected && status ? <Text accessibilityLiveRegion="polite" style={[font.caption, { color: c.muted }]}>{status}</Text> : null}
    {!selected && results.map(item => <Pressable key={item.placeId} accessibilityRole="button" accessibilityLabel={item.label}
      onPress={() => { setQuery(item.label); onSelect(item); setResults([]); setStatus(''); }}
      style={({ pressed }) => ({ minHeight: 56, padding: 14, borderRadius: 12, backgroundColor: pressed ? c.card : c.surface, borderColor: c.border, borderWidth: 1 })}>
      <Text style={[font.headline, { color: c.text }]}>{item.name}</Text>
      <Text style={[font.caption, { color: c.muted }]}>{item.label} · {item.country}</Text>
    </Pressable>)}
    {status.startsWith('Search unavailable') ? <Pressable accessibilityRole="button" onPress={() => { setStatus('Searching destinations…'); setRetry(value => value + 1); }} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={[font.headline, { color: c.accent }]}>Retry destination search</Text></Pressable> : null}
    {!selected && results.length ? <Text style={[font.caption, { color: c.muted }]}>Powered by Google</Text> : null}
  </View>;
}
