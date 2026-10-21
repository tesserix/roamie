import { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { Text } from '@/components/typography';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Chip } from './ui';
import { font, radius, space, useColors } from '@/constants/theme';
import { DIET_OPTIONS } from '@/lib/diets';
import { DEFAULT_NEARBY_FILTERS, type NearbyFilters } from '@/lib/nearby-places';
import type { Diet } from '@/lib/store';

export const NEARBY_SORTS: { value: NearbyFilters['sort']; label: string }[] = [
  { value: 'recommended', label: 'Best match' },
  { value: 'distance', label: 'Nearest' },
  { value: 'rating', label: 'Top rated' },
];

function Choices<T extends string | number | null>({ label, options, value, onChange }: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const c = useColors();
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={[font.headline, { color: c.text }]}>{label}</Text>
    <View style={styles.choices}>
      {options.map(option => <Chip key={String(option.value)} label={option.label} selected={value === option.value} onPress={() => onChange(option.value)} />)}
    </View>
  </View>;
}

export function NearbyFilterSheet({ filters, diet, food, onApply, onClose }: {
  filters: NearbyFilters;
  diet: Diet;
  food: boolean;
  onApply: (filters: NearbyFilters, diet: Diet) => void;
  onClose: () => void;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState(filters);
  const [foodPreference, setFoodPreference] = useState(diet);
  return <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top + space.sm }}>
      <View style={styles.heading}>
        <Text accessibilityRole="header" style={[font.title, { color: c.text, flex: 1 }]}>Your nearby choices</Text>
        <Button label="Cancel" kind="secondary" onPress={onClose} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[font.body, { color: c.muted }]}>Refine the places found around you.</Text>
        <Choices label="Sort by" options={NEARBY_SORTS} value={draft.sort} onChange={sort => setDraft({ ...draft, sort })} />
        <Choices<number | null> label="Distance" options={[
          { value: null, label: 'All results' }, { value: 500, label: '500 m' }, { value: 1000, label: '1 km' }, { value: 1500, label: '1.5 km' },
        ]} value={draft.distanceM} onChange={distanceM => setDraft({ ...draft, distanceM })} />
        <Text style={[font.caption, { color: c.muted }]}>Distances are straight-line estimates. Your walking route may be longer.</Text>
        <View style={[styles.toggle, { backgroundColor: c.surface }]}>
          <View style={{ flex: 1, gap: space.xs }}>
            <Text style={[font.headline, { color: c.text }]}>Open now only</Text>
            <Text style={[font.caption, { color: c.muted }]}>Hide places with unknown opening hours.</Text>
          </View>
          <Switch accessibilityLabel="Open now only" value={draft.openNow} onValueChange={openNow => setDraft({ ...draft, openNow })} trackColor={{ true: c.accent }} />
        </View>
        <Choices<number | null> label="Minimum rating" options={[
          { value: null, label: 'Any rating' }, { value: 4, label: '4+ stars' }, { value: 4.5, label: '4.5+ stars' },
        ]} value={draft.minimumRating} onChange={minimumRating => setDraft({ ...draft, minimumRating })} />
        {food ? <>
          <Choices<number | null> label="Price" options={[
            { value: null, label: 'Any price' }, { value: 1, label: '$ · Budget' }, { value: 2, label: '$$ or less' },
          ]} value={draft.maxPrice} onChange={maxPrice => setDraft({ ...draft, maxPrice })} />
          <Text style={[font.caption, { color: c.muted }]}>Price levels are relative to the area. A price filter hides places without a listed price.</Text>
          <Choices label="Food preference" options={DIET_OPTIONS} value={foodPreference} onChange={setFoodPreference} />
          <Text style={[font.caption, { color: c.muted }]}>Food preferences guide the search; they are not a certification. Confirm ingredients and preparation with the venue. Your saved profile stays the same.</Text>
        </> : null}
        <Button label="Reset filters" kind="secondary" onPress={() => { setDraft({ ...DEFAULT_NEARBY_FILTERS }); setFoodPreference('none'); }} />
      </ScrollView>
      <View style={[styles.footer, { borderColor: c.border, paddingBottom: Math.max(insets.bottom, space.md) }]}>
        <Button label="Show places" onPress={() => onApply(draft, foodPreference)} />
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  heading: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.md },
  content: { padding: space.md, gap: space.lg },
  section: { gap: space.sm },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.md },
  footer: { padding: space.md, borderTopWidth: 1 },
});
