import { Linking, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { Button, Screen } from '@/components/ui';
import { radius, space, useColors } from '@/constants/theme';
import { EMERGENCY, FALLBACK } from '@/data/emergency';
import { useHere } from '@/lib/location';

export default function Sos() {
  const c = useColors();
  const here = useHere();
  const numbers = here.country ? EMERGENCY[here.country] : undefined;

  const lines = numbers
    ? [
        { label: 'Police', number: numbers.police },
        { label: 'Ambulance', number: numbers.ambulance },
        { label: 'Fire', number: numbers.fire },
        ...(numbers.tourist ? [{ label: 'Tourist police', number: numbers.tourist }] : []),
      ]
    : [{ label: 'Emergency', number: FALLBACK }];

  async function shareLocation() {
    if (!here.coords) return;
    const { lat, lng } = here.coords;
    await Share.share({ message: `I need help. I'm here: https://maps.google.com/?q=${lat},${lng}` });
  }

  return (
    <Screen title="SOS">
      <ScrollView contentContainerStyle={{ padding: space.md, gap: space.md }}>
        <Text style={{ color: c.muted, fontSize: 16 }}>
          {numbers ? `You're in ${numbers.name}. Tap to call.` : "We couldn't tell which country you're in. 112 works from most mobile phones."}
        </Text>
        {lines.map((l) => (
          <Pressable
            key={l.label}
            accessibilityRole="button"
            accessibilityLabel={`Call ${l.label}, ${l.number}`}
            onPress={() => Linking.openURL(`tel:${l.number}`)}
            style={({ pressed }) => [styles.call, { backgroundColor: c.danger, opacity: pressed ? 0.8 : 1 }]}>
            <Text style={styles.callLabel}>{l.label}</Text>
            <Text style={styles.callNumber}>{l.number}</Text>
          </Pressable>
        ))}
        <View style={{ gap: space.sm, paddingTop: space.sm }}>
          <Button label="Share my location" kind="secondary" disabled={!here.coords} onPress={shareLocation} />
          {numbers && lines.every((l) => l.number !== FALLBACK) ? (
            <Text style={{ color: c.muted, fontSize: 14, textAlign: 'center' }}>No answer? Try {FALLBACK}.</Text>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  call: {
    borderRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    minHeight: 80,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  callLabel: { color: '#FFFFFF', fontSize: 22, fontWeight: '700' },
  callNumber: { color: '#FFFFFF', fontSize: 30, fontWeight: '800' },
});
