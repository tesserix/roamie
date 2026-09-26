import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Text, View } from 'react-native';
import { font, useColors } from '@/constants/theme';
import { checkTripReadiness, type DestinationCheck } from '@/lib/trip-readiness';
import type { Trip } from '@/lib/trips';
import { Button, Card } from './ui';

export function TripReadiness({ trip }: { trip: Trip }) {
  const c = useColors();
  const [checks, setChecks] = useState<DestinationCheck[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const task = useRef<AbortController | null>(null);
  useEffect(() => () => { task.current?.abort(); task.current = null; }, []);
  async function check() {
    if (task.current) return;
    const controller = new AbortController(); task.current = controller; setBusy(true); setError(''); setChecks([]);
    try { const result = await checkTripReadiness(trip, controller.signal); if (!controller.signal.aborted) setChecks(result); }
    catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Trip checks are unavailable.'); }
    finally { if (task.current === controller) { task.current = null; setBusy(false); } }
  }
  return <Card>
    <Text accessibilityRole="header" style={[font.headline, { color: c.text }]}>Before you go</Text>
    <Text style={[font.body, { color: c.muted }]}>Check weather for each stop and prepare with official entry guidance. Forecasts cover the next ten days; visa eligibility and fees require official confirmation.</Text>
    {busy ? <View style={{ gap: 12 }}><ActivityIndicator accessibilityLabel="Checking trip conditions" color={c.accent} /><Text accessibilityLiveRegion="polite" style={[font.body, { color: c.text }]}>Checking your destinations…</Text><Button label="Cancel trip check" kind="secondary" onPress={() => { task.current?.abort(); task.current = null; setBusy(false); }} /></View> : <Button label={checks.length ? 'Refresh trip checks' : 'Check weather & entry guidance'} kind="secondary" onPress={() => void check()} />}
    {!!error && <Text accessibilityRole="alert" style={[font.body, { color: c.danger }]}>{error}</Text>}
    {checks.map((check, i) => <View key={i} style={{ gap: 14, paddingTop: 16, borderTopWidth: 1, borderColor: c.border }}>
      <Text accessibilityRole="header" style={[font.headline, { color: c.text }]}>{check.destination}</Text>
      <Text style={[font.caption, { color: c.muted }]}>{check.start} – {check.end}</Text>
      {check.weather?.response.status !== 'ok' && <Text style={[font.body, { color: c.muted }]}>Weather has not been verified for this destination.</Text>}
      {!!check.error && <Text style={[font.body, { color: c.danger }]}>{check.error}</Text>}
      {[check.weather, check.entry].flatMap(response => response?.response.recommendations ?? []).map(fact => <View key={fact.id} style={{ gap: 10 }}>
        <Text style={[font.headline, { color: c.text }]}>{fact.name}</Text>
        {fact.weather?.local_date && <Text style={[font.body, { color: c.text }]}>{fact.weather.minimum_celsius ?? '—'}° – {fact.weather.maximum_celsius ?? '—'}°C · Daytime rain {fact.weather.precipitation_percent ?? '—'}%</Text>}
        {!!fact.weather?.missing_dates.length && <Text style={[font.body, { color: c.muted }]}>No forecast yet for {fact.weather.missing_dates.length} trip day(s). Check again closer to departure.</Text>}
        {[...(fact.weather?.suggestions ?? []), ...(fact.entry?.checklist ?? [])].map((item, index) => <Text key={index} style={[font.body, { color: c.text }]}>{item}</Text>)}
        {!!fact.entry && <Text style={[font.caption, { color: c.muted }]}>Visa eligibility and fees are unverified. Passport country, residency, purpose and transit stops affect the requirements.</Text>}
        {fact.weather && <Text style={[font.caption, { color: c.muted }]}>Checked {new Date(fact.observed_at).toLocaleString()}</Text>}
        <Button label={fact.weather ? 'Weather by Google · Source' : 'Open entry guidance source'} kind="secondary" onPress={() => { if (fact.source_url.startsWith('https://')) void Linking.openURL(fact.source_url).catch(() => setError('Could not open the source. Please try again.')); }} />
      </View>)}
    </View>)}
  </Card>;
}
