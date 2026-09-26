import { useState } from 'react';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Sos from '@/app/sos';
import { Button } from '@/components/ui';
import { font, space, useColors } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { providersFor } from '@/lib/auth-client';

export default function SignIn() {
  const c = useColors(); const insets = useSafeAreaInsets(); const auth = useAuth();
  const [emergency, setEmergency] = useState(false);
  if (emergency) return <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top }}><Button label="Back to sign-in" kind="secondary" onPress={() => setEmergency(false)} /><Sos /></View>;
  const providers = providersFor(Platform.OS);
  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: space.lg, paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.lg, gap: space.lg }} style={{ backgroundColor: c.background }}>
      <View style={{ gap: space.sm }}>
        <Text accessibilityRole="header" style={[font.largeTitle, { color: c.text }]}>Your travel mate.</Text>
        <Text style={[font.body, { color: c.muted }]}>Sign in to Roamie with an account you already trust.</Text>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: space.lg }}>
        {providers.map(provider => {
          const label = provider[0].toUpperCase() + provider.slice(1);
          const disabled = auth.busy || !auth.config?.providers[provider];
          return (
            <Pressable
              key={provider}
              accessibilityRole="button"
              accessibilityLabel={`Continue with ${label}`}
              accessibilityState={{ disabled }}
              disabled={disabled}
              onPress={() => { void auth.signIn(provider); }}
              style={({ pressed }) => ({ alignItems: 'center', gap: space.sm, opacity: disabled ? 0.4 : pressed ? 0.65 : 1 })}
            >
              <View style={{ width: 64, height: 64, borderRadius: 32, borderWidth: 1, borderColor: c.muted, alignItems: 'center', justifyContent: 'center' }}>
                <FontAwesome name={provider} size={28} color={provider === 'facebook' ? '#1877F2' : c.text} />
              </View>
              <Text style={[font.caption, { color: c.text }]}>{label}</Text>
            </Pressable>
          );
        })}
        {!providers.length && <Text style={[font.body, { color: c.muted }]}>Sign-in is available in the iOS and Android app.</Text>}
      </View>
      {auth.config && providers.some(provider => !auth.config?.providers[provider]) && <Text style={[font.caption, { color: c.muted }]}>{providers.filter(provider => !auth.config?.providers[provider]).map(provider => provider[0].toUpperCase() + provider.slice(1)).join(', ')} sign-in is not available yet. Choose another provider.</Text>}
      {auth.error && <View style={{ gap: space.sm }}><Text accessibilityRole="alert" style={[font.body, { color: c.danger }]}>{auth.error}</Text><Button label="Try again" busy={auth.busy} onPress={() => { void auth.retry(); }} /></View>}
      <Text style={[font.caption, { color: c.muted }]}>Your trip stays on this phone. Emergency help is always available.</Text>
      <Button label="Emergency help" kind="secondary" onPress={() => setEmergency(true)} />
    </ScrollView>
  );
}
