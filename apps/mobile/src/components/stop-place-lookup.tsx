import { useEffect, useState } from 'react';
import * as Location from 'expo-location';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { Text, TextInput } from './typography';
import { Chip, Icon } from './ui';
import { font, radius, space, useColors } from '@/constants/theme';
import { nearby, type Place } from '@/lib/api';
import { resolveDestination } from '@/lib/trip-api';
import type { Destination, TripPlace } from '@/lib/trip-contract';

export function StopPlaceLookup({ destination, destinationLabel, value, onChange, onSelect }: {
  destination?: Destination; destinationLabel: string; value: string;
  onChange: (value: string) => void; onSelect: (place: TripPlace) => void;
}) {
  const c = useColors();
  const [open, setOpen] = useState(false), [query, setQuery] = useState('');
  const [places, setPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [source, setSource] = useState<'trip' | 'here'>('trip');
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let live = true;
    const timer = setTimeout(() => {
      controller.abort();
      if (live) { setError('Place suggestions took too long. Try again or enter your own stop.'); setLoading(false); }
    }, 15000);
    void (async () => {
      let point: { latitude: number; longitude: number };
      if (source === 'here') {
        let permission = await Location.getForegroundPermissionsAsync();
        if (!live || controller.signal.aborted) return;
        if (!permission.granted && permission.canAskAgain) permission = await Location.requestForegroundPermissionsAsync();
        if (!permission.granted) throw new Error('Location access is off. Choose Trip destination or type your own stop.');
        if (!live || controller.signal.aborted) return;
        point = (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })).coords;
      } else {
        if (!destination) throw new Error('Choose a trip destination from search to see suggestions, or enter your own stop.');
        point = await resolveDestination(destination, controller.signal);
      }
      if (!live || controller.signal.aborted) return;
      const result = await nearby(point.latitude, point.longitude, 'sights', 'none', controller.signal);
      if (live && !controller.signal.aborted) setPlaces(result.places.filter(p => typeof p.lat === 'number' && Number.isFinite(p.lat) && Math.abs(p.lat) <= 90 && typeof p.lng === 'number' && Number.isFinite(p.lng) && Math.abs(p.lng) <= 180));
    })().catch(e => {
      if (live && !controller.signal.aborted) setError(e instanceof Error ? e.message : 'Suggestions unavailable. Enter your own stop or retry.');
    }).finally(() => { clearTimeout(timer); if (live) setLoading(false); });
    return () => { live = false; clearTimeout(timer); controller.abort(); };
  }, [open, destination, retry, source]);
  function start() { setPlaces([]); setError(''); setLoading(true); }
  function show() { if (!open) { start(); setOpen(true); } }
  function changeSource(next: 'trip' | 'here') { if (source !== next) { start(); setSource(next); } }
  const visible = places.filter(p => (p.name + ' ' + p.address).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).slice(0, 8);
  return <View style={{ gap: space.sm }}>
    <Text style={[font.caption, { color: c.muted }]}>Place or activity</Text>
    <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: open ? c.accent : c.border, borderRadius: radius.lg, backgroundColor: c.surface }}>
      <View style={{ paddingLeft: space.md }}><Icon name="mappin" color={c.accent} /></View>
      <TextInput accessibilityLabel="Place or activity" value={value} maxLength={120}
        placeholder="Find a sight or add your own stop" placeholderTextColor={c.faint}
        onFocus={show}
        onChangeText={text => { onChange(text); setQuery(text); show(); }}
        style={[font.body, { flex: 1, minHeight: 52, padding: space.sm, color: c.text }]} />
      <Pressable accessibilityRole="button" accessibilityLabel={open ? 'Hide place suggestions' : 'Show place suggestions'}
        accessibilityState={{ expanded: open }} onPress={() => { setQuery(''); if (open) setOpen(false); else show(); }}
        style={({ pressed }) => ({ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
        <Icon name={open ? 'chevron.up' : 'chevron.down'} color={c.muted} />
      </Pressable>
    </View>
    {open ? <View style={{ borderWidth: 1, borderColor: c.border, borderRadius: radius.lg, backgroundColor: c.surface, overflow: 'hidden' }}>
      <View style={{ padding: space.md, gap: space.sm }}>
        <Text accessibilityRole="header" style={[font.headline, { color: c.text }]}>Sights near {source === 'here' ? 'you' : destinationLabel}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          <Chip label="Trip destination" selected={source === 'trip'} onPress={() => changeSource('trip')} />
          <Chip label="Near me" selected={source === 'here'} onPress={() => changeSource('here')} />
        </View>
        <Text style={[font.caption, { color: c.muted }]}>Near me uses your phone’s location to request nearby places.</Text>
        <Text style={[font.caption, { color: c.muted }]}>Sights, museums and parks within about 1.5 km. Type to filter suggestions or enter your own activity.</Text>
      </View>
      {loading ? <View accessibilityRole="progressbar" accessibilityLabel="Finding place suggestions" style={{ padding: space.md }}><ActivityIndicator color={c.accent} /></View> : null}
      {error ? <View style={{ paddingHorizontal: space.md, gap: space.sm }}><Text accessibilityRole="alert" style={[font.caption, { color: c.danger }]}>{error}</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry place suggestions" onPress={() => { start(); setRetry(n => n + 1); }} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={[font.body, { color: c.accent }]}>Try again</Text></Pressable></View> : null}
      {!loading && !error && !visible.length ? <Text style={[font.caption, { color: c.muted, padding: space.md }]}>No matching suggestions. You can still save the place or activity you type.</Text> : null}
      <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={{ maxHeight: 320 }}>
        {visible.map(p => <Pressable key={p.id} accessibilityRole="button" accessibilityLabel={'Choose ' + p.name + ', ' + p.address}
          onPress={() => { onSelect({ id: p.id, name: p.name.slice(0, 120), address: p.address, mapsUri: p.mapsUri, lat: p.lat!, lng: p.lng! }); setOpen(false); setQuery(''); }}
          style={({ pressed }) => ({ minHeight: 72, padding: space.md, borderTopWidth: 1, borderTopColor: c.border, backgroundColor: pressed ? c.accentSoft : c.surface, flexDirection: 'row', alignItems: 'center', gap: space.sm })}>
          <Icon name="mappin" color={c.accent} /><View style={{ flex: 1, gap: 4 }}><Text style={[font.headline, { color: c.text }]}>{p.name}</Text><Text style={[font.caption, { color: c.muted }]}>{p.address}</Text><Text style={[font.caption, { color: c.muted }]}>{Math.round(p.distanceM)} m away{p.rating !== null ? ' · ' + p.rating + ' ★' : ''}</Text></View><Icon name="plus" color={c.accent} />
        </Pressable>)}
      </ScrollView>
      {places.length ? <Text style={[font.caption, { color: c.muted, padding: space.md }]}>Places from Google Maps · Check opening hours and entry costs.</Text> : null}
    </View> : null}
  </View>;
}
