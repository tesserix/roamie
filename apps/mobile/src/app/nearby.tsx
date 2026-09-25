import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, Chip, Message, Screen } from '@/components/ui';
import { radius, space, useColors } from '@/constants/theme';
import { ApiError, nearby, type Kind, type Place } from '@/lib/api';
import { useHere } from '@/lib/location';
import { useStore } from '@/lib/store';

const KINDS: { value: Kind; label: string }[] = [
  { value: 'food', label: 'Food' },
  { value: 'pharmacy', label: 'Pharmacy' },
  { value: 'atm', label: 'ATM' },
  { value: 'sights', label: 'Sights' },
];

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; places: Place[]; relaxed: string[] };

export default function Nearby() {
  const c = useColors();
  const { profile } = useStore();
  const here = useHere();
  const [kind, setKind] = useState<Kind>('food');
  const [load, setLoad] = useState<Load>({ status: 'loading' });

  const [attempt, setAttempt] = useState(0);
  const lat = here.coords?.lat;
  const lng = here.coords?.lng;
  const diet = kind === 'food' ? profile!.diet : 'none';

  useEffect(() => {
    if (lat === undefined || lng === undefined) return;
    let live = true;
    (async () => {
      try {
        const res = await nearby(lat, lng, kind, diet);
        if (live) setLoad({ status: 'ready', ...res });
      } catch (e) {
        if (live) setLoad({ status: 'error', message: e instanceof ApiError ? e.message : 'Something went wrong.' });
      }
    })();
    return () => {
      live = false;
    };
  }, [lat, lng, kind, diet, attempt]);

  const retry = () => {
    setLoad({ status: 'loading' });
    setAttempt((a) => a + 1);
  };

  let body;
  if (here.status === 'denied') {
    body = (
      <Message
        title="Location is off"
        body="Turn on location for Roamie in Settings to see places around you."
        action={<Button label="Open Settings" onPress={() => Linking.openSettings()} />}
      />
    );
  } else if (here.status === 'error') {
    body = <Message title="Couldn't find where you are" action={<Button label="Try again" onPress={here.refresh} />} />;
  } else if (here.status === 'loading' || load.status === 'loading') {
    body = <ActivityIndicator style={{ marginTop: space.xl }} color={c.accent} />;
  } else if (load.status === 'error') {
    body = <Message title={load.message} action={<Button label="Try again" onPress={retry} />} />;
  } else {
    body = (
      <FlatList
        data={load.places}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: space.md, gap: space.sm }}
        ListHeaderComponent={
          load.relaxed.length ? (
            <Text style={{ color: c.warn, fontSize: 14, paddingBottom: space.sm }}>
              Nothing matched exactly, so we loosened your {load.relaxed.join(' and ')} filter.
            </Text>
          ) : null
        }
        ListEmptyComponent={<Message title="Nothing open nearby" body="Try another category or check again later." />}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="link"
            accessibilityHint="Opens directions in Maps"
            onPress={() => Linking.openURL(item.mapsUri)}
            style={({ pressed }) => [styles.card, { backgroundColor: c.card, opacity: pressed ? 0.7 : 1 }]}>
            <Text style={{ color: c.text, fontSize: 18, fontWeight: '700' }} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={{ color: c.accent, fontSize: 15, fontWeight: '600' }}>{item.why}</Text>
            <Text style={{ color: c.muted, fontSize: 14 }} numberOfLines={1}>
              {item.address}
            </Text>
          </Pressable>
        )}
      />
    );
  }

  return (
    <Screen title="Nearby">
      <View style={styles.chips}>
        {KINDS.map((k) => (
          <Chip key={k.value} label={k.label} selected={kind === k.value} onPress={() => {
              setKind(k.value);
              setLoad({ status: 'loading' });
            }}
          />
        ))}
      </View>
      {body}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.sm },
  card: { borderRadius: radius.lg, padding: space.md, gap: space.xs },
});
