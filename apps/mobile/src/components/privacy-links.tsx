import { useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { font, useColors } from '@/constants/theme';
import { AccountDeletion } from './account-deletion';
import { AIDataSharing } from './ai-data-sharing';

export function PrivacyLinks() {
  const c = useColors(), [error, setError] = useState('');
  async function open(path: string) {
    setError('');
    try { await Linking.openURL(`https://roamie-api.tesserix.app/${path}`); }
    catch { setError('Could not open the page. Please email sales@tesserix.app for privacy or account-deletion help.'); }
  }
  return <View style={{ gap: 8 }}>
    <Text style={[font.body, { color: c.muted }]}>Your information, your choice.</Text>
    <AIDataSharing />
    {([['privacy', 'Privacy policy'], ['account-deletion', 'Account deletion details']] as const).map(([path, label]) =>
      <Pressable key={path} accessibilityRole="link" accessibilityLabel={label} accessibilityHint="Opens in your browser" onPress={() => { void open(path); }} style={({ pressed }) => ({ minHeight: 48, justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}>
        <Text style={[font.body, { color: c.accent, textDecorationLine: 'underline' }]}>{label}</Text>
      </Pressable>)}
    <AccountDeletion />
    {error ? <Text accessibilityRole="alert" style={[font.body, { color: c.danger }]}>{error}</Text> : null}
  </View>;
}
