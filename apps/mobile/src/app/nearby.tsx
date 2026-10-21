import type { SFSymbol } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Keyboard, Linking, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text, TextInput } from '@/components/typography';

import { NearbyFilterSheet, NEARBY_SORTS } from '@/components/nearby-filters';
import { Badge, Button, Icon, IconButton, Message, Screen, TAB_CLEARANCE } from '@/components/ui';
import { font, lift, radius, space, useColors } from '@/constants/theme';
import { ApiError, nearby, type Kind, type Place } from '@/lib/api';
import { DIET_OPTIONS } from '@/lib/diets';
import { useHere } from '@/lib/location';
import { DEFAULT_NEARBY_FILTERS, directionsUrl, selectNearbyPlaces, type NearbyFilters } from '@/lib/nearby-places';
import { type Diet, useStore } from '@/lib/store';

const KINDS: { value: Kind; label: string; detail: string; icon: SFSymbol }[] = [
  { value: 'food', label: 'Food & cafés', detail: 'Restaurants & quick bites', icon: 'fork.knife' },
  { value: 'pharmacy', label: 'Pharmacy', detail: 'Medicines & essentials', icon: 'cross.case.fill' },
  { value: 'atm', label: 'ATM', detail: 'Find cash nearby', icon: 'banknote.fill' },
  { value: 'sights', label: 'Explore', detail: 'Sights, museums & parks', icon: 'camera.fill' },
];

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; places: Place[]; relaxed: string[] };

export default function Nearby() {
  const c = useColors();
  const { fontScale } = useWindowDimensions();
  const { profile } = useStore();
  const here = useHere();
  const [kind, setKind] = useState<Kind>('food');
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<NearbyFilters>({ ...DEFAULT_NEARBY_FILTERS });
  const [foodPreference, setFoodPreference] = useState<Diet>(profile?.diet ?? 'none');
  const [showFilters, setShowFilters] = useState(false);
  const [result, setLoad] = useState<Load & { key: string }>({ status: 'loading', key: '' });
  const [attempt, setAttempt] = useState(0);
  const lat = here.coords?.lat;
  const lng = here.coords?.lng;
  const diet = kind === 'food' ? foodPreference : 'none';
  const requestKey = JSON.stringify([lat, lng, kind, diet, attempt]);
  const load: Load = result.key === requestKey ? result : { status: 'loading' };
  const category = KINDS.find(k => k.value === kind)!;
  const effectiveFilters = { ...filters, maxPrice: kind === 'food' ? filters.maxPrice : null };
  const activeFilters = Number(filters.distanceM !== null) + Number(filters.openNow)
    + Number(filters.minimumRating !== null) + Number(effectiveFilters.maxPrice !== null)
    + Number(diet !== 'none') + Number(filters.sort !== 'recommended');
  const places = here.status === 'ready' && load.status === 'ready'
    ? selectNearbyPlaces(load.places, query, effectiveFilters) : [];
  const clearFilters = () => { setFilters({ ...DEFAULT_NEARBY_FILTERS }); setFoodPreference('none'); };
  const chooseDirections = (place: Place) => {
    const open = (provider: 'google' | 'apple') => {
      void Linking.openURL(directionsUrl(place, provider)).catch(() => Alert.alert('Could not open Maps', 'Try again or search for ' + place.name + ' in your Maps app.'));
    };
    Alert.alert('Get directions', place.name, [
      { text: 'Google Maps', onPress: () => open('google') },
      { text: Platform.OS === 'ios' ? 'Apple Maps' : 'Apple Maps (web)', onPress: () => open('apple') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  useEffect(() => {
    if (lat === undefined || lng === undefined) return;
    let live = true;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await nearby(lat, lng, kind, diet, controller.signal);
        if (live) setLoad({ status: 'ready', ...res, key: requestKey });
      } catch (e) {
        if (live) setLoad({ status: 'error', key: requestKey, message: e instanceof ApiError ? e.message : 'Something went wrong.' });
      }
    })();
    return () => { live = false; controller.abort(); };
  }, [lat, lng, kind, diet, requestKey]);

  let empty;
  if (here.status === 'denied') {
    empty = <Message icon="location.slash.fill" title="Location is off"
      body={here.servicesEnabled === false ? 'Turn on your phone’s Location Services, then return and tap Try again.' : 'Allow location for Roamie to see places around you.'}
      action={<View style={{ gap: space.sm }}>
        <Button label={here.canAskAgain ? 'Allow location' : 'Open Settings'} onPress={here.canAskAgain ? here.refresh : () => { void Linking.openSettings().catch(() => Alert.alert('Open your phone settings', 'Allow location access for Roamie, then return and tap Try again.')); }} />
        <Button label="Try again" kind="secondary" onPress={here.refresh} />
      </View>} />;
  } else if (here.status === 'error') {
    empty = <Message icon="location.fill" title="Couldn't find where you are" body="Check your connection and location settings, then try again."
      action={<Button label="Try again" kind="secondary" onPress={here.refresh} />} />;
  } else if (here.status === 'loading' || load.status === 'loading') {
    empty = <View style={styles.loading} accessibilityRole="progressbar" accessibilityLabel={here.status === 'loading' ? 'Finding your location' : 'Finding nearby places'}>
      <ActivityIndicator color={c.accent} /><Text style={[font.body, { color: c.muted }]}>{here.status === 'loading' ? 'Finding your location…' : 'Finding places around you…'}</Text>
    </View>;
  } else if (load.status === 'error') {
    empty = <Message icon="wifi.exclamationmark" title="Couldn't load nearby places" body={load.message}
      action={<Button label="Try again" kind="secondary" onPress={() => setAttempt(a => a + 1)} />} />;
  } else if (query.trim() || activeFilters) {
    empty = <Message icon="magnifyingglass" title="No places match your choices" body="Try a shorter search, a wider distance or fewer filters."
      action={<View style={{ gap: space.sm }}>
        {query.trim() ? <Button label="Clear search" kind="secondary" onPress={() => setQuery('')} /> : null}
        {activeFilters ? <Button label="Clear filters" kind="secondary" onPress={clearFilters} /> : null}
      </View>} />;
  } else {
    empty = <Message icon={category.icon} title="No places found nearby" body="Try another category or refresh your location."
      action={<Button label="Refresh location" kind="secondary" onPress={here.refresh} />} />;
  }

  // Recreate native text measurements when Dynamic Type changes on this mounted tab.
  return <Screen key={fontScale} title="Nearby" subtitle="Find your next stop, without the guesswork">
    <FlatList
      data={places}
      keyExtractor={p => p.id}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentContainerStyle={styles.list}
      ListHeaderComponent={<View style={{ gap: space.md }}>
        <View style={[styles.location, { backgroundColor: c.card }]}>
          <Icon name="mappin.and.ellipse" size={18} color={c.accent} />
          <Text style={[font.caption, { color: c.text, flex: 1 }]}>{here.status === 'ready' ? 'Near your current location' : 'Use your location to find places'}</Text>
          <IconButton icon="location.fill" label="Refresh location" onPress={here.refresh} />
        </View>
        <Text accessibilityRole="header" style={[font.headline, { color: c.text }]}>What do you need?</Text>
        <View style={{ gap: space.sm }}>
          {[KINDS.slice(0, 2), KINDS.slice(2)].map((row, i) => <View key={i} style={styles.row}>
            {row.map(k => {
              const selected = kind === k.value;
              return <Pressable key={k.value} accessibilityRole="button" accessibilityLabel={k.label} accessibilityState={{ selected }}
                onPress={() => { if (!selected) { setKind(k.value); setQuery(''); } }}
                style={({ pressed }) => [styles.category, { backgroundColor: selected ? c.accent : c.surface, borderColor: selected ? c.accent : c.border, opacity: pressed ? 0.8 : 1 }]}>
                <Icon name={k.icon} size={22} color={selected ? c.onAccent : c.accent} />
                <Text style={[font.headline, { color: selected ? c.onAccent : c.text }]}>{k.label}</Text>
                <Text style={[font.caption, { color: selected ? c.onAccent : c.muted }]}>{k.detail}</Text>
              </Pressable>;
            })}
          </View>)}
        </View>
        <View style={[styles.search, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Icon name="magnifyingglass" size={18} color={c.muted} />
          <TextInput accessibilityLabel="Search these places" placeholder="Search these places by name or street" placeholderTextColor={c.muted}
            value={query} onChangeText={setQuery} maxLength={120} returnKeyType="search" onSubmitEditing={Keyboard.dismiss}
            style={[font.body, { color: c.text, flex: 1, minHeight: 52 }]} />
          {query ? <IconButton icon="xmark" label="Clear search" onPress={() => setQuery('')} /> : null}
        </View>
        <View style={styles.row}>
          <Button label={activeFilters ? `Filters (${activeFilters})` : 'Filters'} icon="slider.horizontal.3" kind="secondary" onPress={() => { Keyboard.dismiss(); setShowFilters(true); }} />
          <View style={{ flex: 1, justifyContent: 'center', gap: space.xs }}>
            <Text style={[font.caption, { color: c.muted, textAlign: 'right' }]}>{NEARBY_SORTS.find(s => s.value === filters.sort)!.label}</Text>
            {diet !== 'none' ? <Text style={[font.caption, { color: c.accent, textAlign: 'right' }]}>{DIET_OPTIONS.find(d => d.value === diet)?.label} preference</Text> : null}
          </View>
        </View>
        {here.status === 'ready' && load.status === 'ready' ? <>
          {load.relaxed.length ? <View style={[styles.notice, { backgroundColor: c.warnSoft }]}>
            <Icon name="info.circle.fill" size={18} color={c.warn} />
            <Text style={[font.caption, { color: c.warn, flex: 1 }]}>No exact match was found for your {load.relaxed.join(' and ')} preference. Broader suggestions are shown; check suitability with the venue.</Text>
          </View> : null}
          <View style={{ gap: space.xs }}>
            <Text accessibilityLiveRegion="polite" style={[font.headline, { color: c.text }]}>{places.length} {places.length === 1 ? 'place' : 'places'}{places.length !== load.places.length ? ` of ${load.places.length} found` : ' nearby'}</Text>
            <Text style={[font.caption, { color: c.muted }]}>Distances are approximate, not walking routes.</Text>
            {kind === 'food' && diet !== 'none' ? <Text style={[font.caption, { color: c.muted }]}>Confirm dietary needs and ingredients with the venue.</Text> : null}
          </View>
        </> : null}
      </View>}
      ListEmptyComponent={empty}
      ListFooterComponent={places.length ? <Text style={[font.caption, styles.attribution, { color: c.muted }]}>Place information from Google Maps. Check opening hours before you go.</Text> : null}
      renderItem={({ item }) => <View style={[styles.card, lift, { backgroundColor: c.surface }]}>
        <View style={styles.row}>
          <Badge icon={category.icon} tint={c.accent} bg={c.accentSoft} size={44} />
          <View style={{ flex: 1, gap: space.xs }}>
            <Text style={[font.headline, { color: c.text }]}>{item.name}</Text>
            <Text style={[font.caption, { color: c.muted }]}>{item.address || 'Address not listed'}</Text>
          </View>
        </View>
        <View style={styles.facts}>
          <Text style={[font.caption, { color: c.accent, fontWeight: '600' }]}>{item.distanceM < 1000 ? `${item.distanceM} m` : `${(item.distanceM / 1000).toFixed(1)} km`} away</Text>
          <Text style={[font.caption, { color: c.text }]}>{item.rating === null ? 'No rating yet' : `${item.rating.toFixed(1)} ★`}</Text>
          {kind === 'food' ? <Text style={[font.caption, { color: c.muted }]}>{item.priceLevel == null ? 'Price not listed' : item.priceLevel === 0 ? 'Free' : '$'.repeat(item.priceLevel)}</Text> : null}
        </View>
        <View style={styles.row}>
          <Text style={[font.caption, { color: item.openNow === true ? c.accent : c.muted, flex: 1 }]}>{item.openNow === true ? 'Open now' : item.openNow === false ? 'Closed now' : 'Hours not listed'}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Directions to ${item.name}`} accessibilityHint="Choose Google Maps or Apple Maps for directions"
            onPress={() => chooseDirections(item)}
            style={({ pressed }) => [styles.directions, { backgroundColor: c.accentSoft, opacity: pressed ? 0.7 : 1 }]}>
            <Icon name="arrow.triangle.turn.up.right.circle.fill" size={18} color={c.accent} />
            <Text style={[font.caption, { color: c.accent, fontWeight: '600' }]}>Directions</Text>
          </Pressable>
        </View>
      </View>}
    />
    {showFilters ? <NearbyFilterSheet filters={filters} diet={foodPreference} food={kind === 'food'} onClose={() => setShowFilters(false)}
      onApply={(next, nextDiet) => { setFilters(next); setFoodPreference(nextDiet); setShowFilters(false); }} /> : null}
  </Screen>;
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: space.md, paddingBottom: TAB_CLEARANCE, gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  location: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderRadius: radius.md, paddingLeft: 12 },
  category: { flex: 1, alignSelf: 'stretch', gap: 6, padding: 12, borderRadius: radius.md, borderWidth: 1, minHeight: 100 },
  search: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderRadius: radius.md, paddingLeft: 12, borderWidth: 1 },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, padding: 12, borderRadius: radius.md },
  card: { gap: 12, borderRadius: radius.lg, padding: space.md },
  facts: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.md, rowGap: space.xs },
  directions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingHorizontal: 14, paddingVertical: 12, minHeight: 48, borderRadius: radius.pill, flexShrink: 1 },
  loading: { alignItems: 'center', gap: space.sm, paddingVertical: space.xl },
  attribution: { textAlign: 'center', paddingVertical: space.md },
});
