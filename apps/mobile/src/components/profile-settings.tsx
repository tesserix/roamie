import { useState } from 'react';
import { Modal, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useAccessibility } from '@/lib/accessibility';
import { font, space, useColors } from '@/constants/theme';
import { CommunicationCards } from './communication-cards';
import { signalFeedback } from '@/lib/feedback';
import { stopSpeaking } from '@/lib/voice';

export function ProfileSettings() {
  const [open, setOpen] = useState(false);
  const settings = useAccessibility(), c = useColors(), insets = useSafeAreaInsets();
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel="Profile settings" onPress={() => setOpen(true)} style={({ pressed }) => ({ minWidth: 48, minHeight: 48, borderRadius: 24, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}>
      <FontAwesome name="user-circle-o" size={24} color={c.text} accessible={false} />
    </Pressable>
    <Modal visible={open} animationType={settings.reducedMotion ? 'none' : 'slide'} onRequestClose={() => setOpen(false)}>
      <View accessibilityViewIsModal style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.md }}>
          <Text accessibilityRole="header" style={[font.title, { color: c.text, flex: 1 }]}>Profile & settings</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Done" onPress={() => setOpen(false)} style={{ minHeight: 48, minWidth: 60, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: c.accent }}>
            <Text style={[font.headline, { color: c.onAccent }]}>Done</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: space.lg, paddingTop: space.sm, paddingBottom: insets.bottom + space.lg, gap: space.lg }}>
          <View style={{ padding: space.md, borderRadius: 20, backgroundColor: c.accentSoft, gap: 6 }}>
            <Text style={[font.headline, { color: c.text }]}>Your travel companion, your way.</Text>
            <Text style={[font.body, { color: c.text }]}>A few small choices for a more comfortable trip.</Text>
          </View>
          <Text accessibilityRole="header" style={[font.headline, { color: c.text }]}>Display & sound</Text>
          <View style={{ borderRadius: 20, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, overflow: 'hidden' }}>
            {([
              ['quiet', 'Quiet translation', 'Read replies. Play audio when you choose.'],
              ['highContrast', 'High contrast', 'Stronger text and clearer borders.'],
              ['vibration', 'Vibration feedback', 'A brief pulse when recording starts or a reply is ready, where supported.'],
            ] as const).map(([key, title, description], index) => <View key={key} style={{ padding: space.md, gap: 6, borderTopWidth: index ? 1 : 0, borderTopColor: c.border }}>
              <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
                <Text style={[font.headline, { color: c.text, flex: 1 }]}>{title}</Text>
                <Switch accessibilityLabel={title} accessibilityHint={description} value={settings[key]} disabled={!settings.ready} trackColor={{ false: c.faint, true: c.accent }} onValueChange={value => { settings.update({ [key]: value }); if (key === 'quiet' && value) stopSpeaking(); if (key === 'vibration') signalFeedback(value); }} />
              </View>
              <Text style={[font.body, { color: c.muted }]}>{description}</Text>
            </View>)}
          </View>
          <View style={{ gap: space.sm }}>
            <Text accessibilityRole="header" style={[font.headline, { color: c.text }]}>Accessibility</Text>
            <Text style={[font.body, { color: c.muted }]}>Text size, screen reader and reduced motion follow your phone’s settings.</Text>
            <Text style={[font.body, { color: c.muted }]}>In Translate, you can type, read replies or show a large message. With a screen reader, double-tap to start recording and again to finish.</Text>
          </View>
          <CommunicationCards />
          {settings.error ? <Text accessibilityRole="alert" style={{ color: c.danger }}>{settings.error}</Text> : null}
        </ScrollView>
      </View>
    </Modal>
  </>;
}
