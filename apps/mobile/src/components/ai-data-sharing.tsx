import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/typography';
import { font, useColors } from '@/constants/theme';
import { session } from '@/lib/auth-client';
import { reviewAIConsent, withdrawAIConsent } from '@/lib/ai-consent';

export function AIDataSharing() {
  const c = useColors(), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  async function choose(allow: boolean) {
    const subject = session.current()?.sub;
    if (!subject) return;
    setBusy(true); setMessage('');
    try {
      await (allow ? reviewAIConsent(subject) : withdrawAIConsent(subject));
      setMessage(allow ? 'AI data sharing is on for this account on this device.' : 'AI data sharing is off. Future AI requests are blocked. Previously sent information is covered by our privacy and deletion policy.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save your choice. Please retry.'); }
    finally { setBusy(false); }
  }
  return <View style={{ gap: 8 }}>
    <Text accessibilityRole="header" style={[font.headline, { color: c.text }]}>AI data sharing</Text>
    <Text style={[font.body, { color: c.muted }]}>Choose whether to share content with Google Cloud AI, TypeSafe JEV and our processing services for online translation and trip planning.</Text>
    {([['Review AI data sharing', true], ['Turn off AI sharing', false]] as const).map(([label, allow]) => <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => { void choose(allow); }} style={({ pressed }) => ({ minHeight: 48, justifyContent: 'center', opacity: pressed || busy ? 0.6 : 1 })}>
      <Text style={[font.body, { color: c.accent }]}>{label}</Text>
    </Pressable>)}
    {message ? <Text accessibilityLiveRegion="polite" style={[font.body, { color: c.text }]}>{message}</Text> : null}
  </View>;
}
