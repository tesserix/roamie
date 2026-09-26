import { useState } from 'react';
import type { SFSymbol } from 'expo-symbols';
import { Alert, Linking, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { Badge, Button, Icon, Screen, SectionLabel, TAB_CLEARANCE } from '@/components/ui';
import { font, lift, radius, space, useColors } from '@/constants/theme';
import { EMERGENCY } from '@/data/emergency';
import { SearchPicker } from '@/components/search-picker';
import { useHere } from '@/lib/location';

export default function Sos() {
  const c = useColors();
  const here = useHere();
  const [manualCountry, setManualCountry] = useState('');
  const country = manualCountry || here.country;
  const numbers = country ? EMERGENCY[country] : undefined;
  const options = Object.entries(EMERGENCY).map(([value, entry]) => ({ value, label: entry.name })).sort((a, b) => a.label.localeCompare(b.label));
  const status = manualCountry ? 'Country selected by you'
    : here.status === 'loading' ? 'Finding your current country…'
    : here.status === 'denied' ? 'Location permission is off. Choose your country below.'
    : here.status === 'error' ? 'Location unavailable. Retry or choose your country.'
    : numbers ? 'Detected from your phone location'
    : 'No emergency listing available for this location. Choose a country if needed.';
  async function call(number: string) {
    try { await Linking.openURL('tel:' + number); }
    catch { Alert.alert('Could not open the phone app', 'Dial ' + number + ' using your phone.'); }
  }

  const lines: { label: string; number: string; icon: SFSymbol }[] = numbers
    ? [
        { label: 'Police', number: numbers.police, icon: 'shield.fill' },
        { label: 'Ambulance', number: numbers.ambulance, icon: 'cross.fill' },
        { label: 'Fire', number: numbers.fire, icon: 'flame.fill' },
        ...(numbers.tourist ? [{ label: 'Tourist police', number: numbers.tourist, icon: 'person.badge.shield.checkmark.fill' as SFSymbol }] : []),
      ]
    : [];

  async function shareLocation() {
    if (!here.coords) return;
    const { lat, lng } = here.coords;
    try { await Share.share({ message: `I need help. My location was checked at ${here.checkedAt ? new Date(here.checkedAt).toLocaleTimeString() : 'an unknown time'}: https://maps.google.com/?q=${lat},${lng}` }); }
    catch { Alert.alert('Could not share your location', 'Please try again.'); }
  }

  return (
    <Screen title="SOS" subtitle={numbers ? numbers.name : 'Local emergency help'}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: space.md, paddingBottom: TAB_CLEARANCE, gap: space.md }}>
        <View style={[styles.notice, { backgroundColor: c.surface }]}>
          <Icon name="location.fill" size={18} color={c.accent} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text accessibilityLiveRegion="polite" style={[font.body, { color: c.text }]}>{status}</Text>
            {!manualCountry && here.checkedAt ? <Text style={[font.caption, { color: c.muted }]}>Location checked {new Date(here.checkedAt).toLocaleTimeString()}</Text> : null}
          </View>
        </View>
        {numbers ? <SectionLabel>Tap to open your phone dialler</SectionLabel> : <Text style={[font.body, { color: c.text }]}>Use your phone’s Emergency Call screen if you need urgent help. Roamie cannot identify a local number yet.</Text>}
        <View style={{ gap: space.sm }}>
          {lines.map((l) => (
            <Pressable
              key={l.label}
              accessibilityRole="button"
              accessibilityLabel={`Call ${l.label}, ${l.number}`}
              onPress={() => { void call(l.number); }}
              style={({ pressed }) => [styles.call, lift, { backgroundColor: c.surface, opacity: pressed ? 0.75 : 1 }]}>
              <Badge icon={l.icon} tint={c.danger} bg={c.dangerSoft} size={48} />
              <Text style={[font.headline, { color: c.text, flex: 1 }]}>{l.label}</Text>
              <Text selectable style={{ color: c.danger, fontSize: 28, fontWeight: '800', letterSpacing: -0.5 }}>{l.number}</Text>
              <View style={[styles.phone, { backgroundColor: c.danger }]}>
                <Icon name="phone.fill" size={18} color="#FFFFFF" />
              </View>
            </Pressable>
          ))}
        </View>

        <View style={{ gap: space.sm, paddingTop: space.sm }}>
          <Button label="Share my location" icon="location.fill" kind="secondary" disabled={!here.coords} onPress={shareLocation} />
        <SearchPicker title="Country or region" value={country ?? ''} options={options} onChange={setManualCountry} />
        <Button label={manualCountry ? 'Use my current location' : 'Refresh my location'} kind="secondary" busy={here.status === 'loading'} onPress={() => { setManualCountry(''); here.refresh(); }} />
        {here.status === 'denied' ? <Button label="Open location settings" kind="secondary" onPress={() => { void Linking.openSettings().catch(() => Alert.alert('Open your phone settings', 'Allow location access for Roamie.')); }} /> : null}
          <Text style={[font.caption, { color: c.muted }]}>Numbers are stored on your phone, not fetched live. Availability can vary by region and network.</Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  notice: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: 12, borderRadius: radius.md },
  call: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: radius.lg, padding: 14, minHeight: 76 },
  phone: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
