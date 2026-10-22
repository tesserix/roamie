import { useState, useSyncExternalStore } from 'react';
import { Modal, Pressable, ScrollView, Switch, View } from 'react-native';
import { Text } from '@/components/typography';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useAccessibility } from '@/lib/accessibility';
import { font, space, useColors } from '@/constants/theme';
import { CommunicationCards } from './communication-cards';
import { signalFeedback } from '@/lib/feedback';
import { stopSpeaking } from '@/lib/voice';
import { session } from '@/lib/auth-client';
import { PrivacyLinks } from './privacy-links';
import { DisplaySettings } from './display-settings';
import { signOut } from '@/lib/sign-out';
import { OfflineTools } from './offline-tools';
import { Button } from './ui';

export function ProfileSettings({ mine, partner, onOpenChange }: { mine?: string; partner?: string | null; onOpenChange?: (open: boolean) => void } = {}) {
  const [open, setOpen] = useState(false);
  const [offline, setOffline] = useState(false);
  const customer = useSyncExternalStore(session.subscribe, session.current);
  const settings = useAccessibility(), c = useColors(), insets = useSafeAreaInsets();
  const close = () => { setOpen(false); onOpenChange?.(false); };
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel="Profile settings" onPress={() => { setOffline(false); setOpen(true); onOpenChange?.(true); }} style={({ pressed }) => ({ minWidth: 48, minHeight: 48, borderRadius: 24, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}>
      <FontAwesome name="user-circle-o" size={24} color={c.text} accessible={false} />
    </Pressable>
    <Modal visible={open} animationType={settings.reducedMotion ? 'none' : 'slide'} onRequestClose={() => offline ? setOffline(false) : close()}>
      {open && (offline ? <OfflineTools mine={mine} partner={partner} signedIn={!!customer} onClose={() => setOffline(false)} /> : <View accessibilityViewIsModal style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.md }}>
          <Text accessibilityRole="header" maxFontSizeMultiplier={1.35} style={[font.title, { color: c.text, flex: 1 }]}>Profile & settings</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Done" onPress={close} style={{ minHeight: 48, minWidth: 60, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: c.accent }}>
            <Text maxFontSizeMultiplier={1.35} style={[font.headline, { color: c.onAccent }]}>Done</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: space.lg, paddingTop: space.sm, paddingBottom: insets.bottom + space.lg, gap: space.lg }}>
          {customer && <View style={{ padding: space.md, gap: space.sm, borderRadius: 20, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }}>
            <Text accessibilityRole="header" style={[font.headline, { color: c.text }]}>Account</Text>
            <Text style={[font.body, { color: c.muted }]}>{customer.email}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Sign out" onPress={() => { close(); void signOut(); }} style={({ pressed }) => ({ minHeight: 48, paddingHorizontal: space.md, borderRadius: 14, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}>
              <Text style={[font.headline, { color: c.danger }]}>Sign out</Text>
            </Pressable>
          </View>}
          <View style={{ gap: space.sm }}>
            <Text accessibilityRole="header" style={[font.headline, { color: c.text }]}>Translation</Text>
            <Button label="Offline languages" icon="wifi.exclamationmark" kind="secondary" onPress={() => setOffline(true)} />
            <Text style={[font.body, { color: c.muted }]}>Download language packs and speech models before you travel. Manage offline translation here.</Text>
          </View>
          <DisplaySettings />
          <Text accessibilityRole="header" style={[font.headline, { color: c.text }]}>Sound & feedback</Text>
          <View style={{ borderRadius: 20, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, overflow: 'hidden' }}>
            {([
              ['quiet', 'Quiet translation', 'Read replies. Play audio when you choose.'],
              ['vibration', 'Vibration feedback', 'A brief pulse when recording starts or a reply is ready, where supported.'],
            ] as const).map(([key, title, description], index) => <View key={key} style={{ padding: space.md, gap: 6, borderTopWidth: index ? 1 : 0, borderTopColor: c.border }}>
              <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
                <Text style={[font.headline, { color: c.text, flex: 1 }]}>{title}</Text>
                <Switch accessibilityLabel={title} accessibilityHint={description} value={settings[key]} disabled={!settings.ready} trackColor={{ false: c.faint, true: c.accent }} onValueChange={value => { settings.update({ [key]: value }); if (key === 'quiet' && value) stopSpeaking(); if (key === 'vibration') signalFeedback(value); }} />
              </View>
              <Text style={[font.body, { color: c.muted }]}>{description}</Text>
            </View>)}
          </View>
          <Text accessibilityRole="header" style={[font.headline, { color: c.text }]}>Translation voice</Text>
          <View accessibilityRole="radiogroup" style={{ borderRadius: 20, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, overflow: 'hidden' }}>
            {([
              ['match', 'Match speaker', 'A female voice when the speaker sounds higher, a male voice when lower.'],
              ['female', 'Female', 'Always a calm female voice.'],
              ['male', 'Male', 'Always a calm male voice.'],
            ] as const).map(([value, title, description], index) => {
              const checked = settings.voice === value;
              return <Pressable key={value} accessibilityRole="radio" accessibilityLabel={title} accessibilityHint={description} accessibilityState={{ checked, disabled: !settings.ready }} disabled={!settings.ready} onPress={() => settings.update({ voice: value })} style={({ pressed }) => ({ minHeight: 48, padding: space.md, flexDirection: 'row', gap: space.md, alignItems: 'center', borderTopWidth: index ? 1 : 0, borderTopColor: c.border, opacity: pressed ? 0.7 : 1 })}>
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={[font.headline, { color: c.text }]}>{title}</Text>
                  <Text style={[font.body, { color: c.muted }]}>{description}</Text>
                </View>
                {checked ? <FontAwesome name="check" size={18} color={c.accent} /> : null}
              </Pressable>;
            })}
          </View>
          <View style={{ gap: space.sm }}>
            <Text accessibilityRole="header" style={[font.headline, { color: c.text }]}>Accessibility</Text>
            <Text style={[font.body, { color: c.muted }]}>Screen reader and reduced motion follow your phone’s settings. Choose Phone settings above to follow your phone’s text size too.</Text>
            <Text style={[font.body, { color: c.muted }]}>In Translate, you can type, read replies or show a large message. With a screen reader, double-tap to start recording and again to finish.</Text>
          </View>
          <CommunicationCards />
          {customer && <PrivacyLinks key={customer.sub} />}
          {settings.error ? <Text accessibilityRole="alert" style={{ color: c.danger }}>{settings.error}</Text> : null}
        </ScrollView>
      </View>)}
    </Modal>
  </>;
}
