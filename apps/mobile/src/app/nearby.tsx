import type { SFSymbol } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Badge, Button, Chip, Icon, Message, Screen, TAB_CLEARANCE } from '@/components/ui';
import { font, lift, radius, space, useColors } from '@/constants/theme';
import { ApiError, nearby, type Kind, type Place } from '@/lib/api';
import { useHere } from '@/lib/location';
import { useStore } from '@/lib/store';

const KINDS: { value: Kind; label: string; icon: SFSymbol }[] = [
  { value: 'food', label: 'Food', icon: 'fork.knife' },
  { value: 'pharmacy', label: 'Pharmacy', icon: 'cross.case.fill' },
  { value: 'atm', label: 'ATM', icon: 'banknote.fill' },
  { value: 'sights', label: 'Sights', icon: 'camera.fill' },
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
  const icon = KINDS.find((k) => k.value === kind)!.icon;

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
        icon="location.slash.fill"
        title="Location is off"
        body="Turn on location for Roamie in Settings to see places around you."
        action={<Button label="Open Settings" onPress={() => Linking.openSettings()} />}
      />
    );
  } else if (here.status === 'error') {
    body = (
      <Message
        icon="location.fill"
        title="Couldn't find where you are"
        action={<Button label="Try again" kind="secondary" onPress={here.refresh} />}
      />
    );
  } else if (here.status === 'loading' || load.status === 'loading') {
    body = <ActivityIndicator style={{ marginTop: space.xl }} color={c.accent} />;
  } else if (load.status === 'error') {
    body = (
      <Message
        icon="wifi.exclamationmark"
        title={load.message}
        action={<Button label="Try again" kind="secondary" onPress={retry} />}
      />
    );
  } else {
    body = (
      <FlatList
        data={load.places}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ paddingHorizontal: space.md, paddingTop: space.xs, paddingBottom: TAB_CLEARANCE, gap: space.sm }}
        ListHeaderComponent={
          load.relaxed.length ? (
            <View style={[styles.notice, { backgroundColor: c.warnSoft }]}>
              <Icon name="info.circle.fill" size={18} color={c.warn} />
              <Text style={[font.caption, { color: c.warn, flex: 1 }]}>
                Nothing matched exactly, so we loosened your {load.relaxed.join(' and ')} filter.
              </Text>
            </View>
          ) : null
        }
        ListEmptyComponent={<Message icon={icon} title="Nothing open nearby" body="Try another category or check again later." />}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="link"
            accessibilityHint="Opens directions in Maps"
            onPress={() => Linking.openURL(item.mapsUri)}
            style={({ pressed }) => [styles.card, lift, { backgroundColor: c.surface, opacity: pressed ? 0.75 : 1 }]}>
            <Badge icon={icon} tint={c.accent} bg={c.accentSoft} size={44} />
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={[font.headline, { color: c.text }]} numberOfLines={1}>
                {item.name}
              </Text>
              {item.why ? (
                <Text style={[font.caption, { color: c.accent, fontWeight: '600' }]} numberOfLines={1}>
                  {item.why}
                </Text>
              ) : null}
              <Text style={[font.caption, { color: c.muted }]} numberOfLines={1}>
                {item.address}
              </Text>
            </View>
            <Icon name="arrow.triangle.turn.up.right.circle.fill" size={28} color={c.accent} />
          </Pressable>
        )}
      />
    );
  }

  return (
    <Screen title="Nearby" subtitle={kind === 'food' && diet !== 'none' ? `Showing ${diet} friendly places` : 'Around you right now'}>
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {KINDS.map((k) => (
            <Chip
              key={k.value}
              label={k.label}
              icon={k.icon}
              selected={kind === k.value}
              onPress={() => {
                if (k.value === kind) return;
                setKind(k.value);
                setLoad({ status: 'loading' });
              }}
            />
          ))}
        </ScrollView>
      </View>
      {body}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.md },
  notice: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: 12, borderRadius: radius.md, marginBottom: space.xs },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: radius.lg, padding: 14 },
});
