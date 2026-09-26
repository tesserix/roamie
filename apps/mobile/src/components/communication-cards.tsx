import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { font, space, useColors } from '@/constants/theme';
import { useAccessibility } from '@/lib/accessibility';
import { speak, stopSpeaking, useSpeaking } from '@/lib/voice';

const cards = [
  { title: 'Please write your reply', text: 'I’m deaf or hard of hearing. Please type or write your reply. Thank you.' },
  { title: 'Help with seeing', text: 'I’m blind or have low vision. Please introduce yourself and describe what is around us. Ask before helping me.' },
  { title: 'A little more time', text: 'Please give me a little more time to communicate. Thank you for your patience.' },
  { title: 'Please speak clearly', text: 'Please face me and speak clearly, one person at a time. You can also type your reply.' },
  { title: 'Help getting there', text: 'Could you help me find my destination? Please ask how you can help before touching me or my mobility aid.' },
];

export function CommunicationCards({ disabled = false }: { disabled?: boolean }) {
  const c = useColors(), insets = useSafeAreaInsets(), { reducedMotion } = useAccessibility();
  const [page, setPage] = useState<'closed' | 'list' | 'edit' | 'show'>('closed');
  const [message, setMessage] = useState('');
  const speaking = useSpeaking('communication-card');
  const valid = message.trim().length > 0;
  function close() { stopSpeaking(); setPage('closed'); setMessage(''); }
  function action(label: string, onPress: () => void, primary = false, disabled = false) {
    return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => ({ minHeight: 48, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: c.border, backgroundColor: primary ? c.accent : c.surface, opacity: disabled ? 0.4 : pressed ? 0.7 : 1, justifyContent: 'center' })}>
      <Text maxFontSizeMultiplier={2} style={[font.headline, { color: primary ? c.onAccent : c.text, textAlign: 'center' }]}>{label}</Text>
    </Pressable>;
  }
  return <>
    {action('Communication cards', () => setPage('list'), false, disabled)}
    <Modal visible={page !== 'closed'} onRequestClose={close} animationType={reducedMotion ? 'none' : 'slide'}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} accessibilityViewIsModal style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top }}>
        <View style={{ flexDirection: 'row', padding: space.md, alignItems: 'center', gap: space.sm }}>
          <Text accessibilityRole="header" style={[font.title, { flex: 1, color: c.text }]}>{page === 'show' ? 'My message' : 'Communication cards'}</Text>
          {action('Close cards', close)}
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, padding: space.lg, paddingBottom: insets.bottom + space.lg, gap: space.md }}>
          {page === 'list' ? <>
            <Text style={[font.body, { color: c.muted }]}>English cards, ready offline. Choose a message, make it yours, then show someone.</Text>
            {cards.map(card => <View key={card.title}>{action(card.title, () => { setMessage(card.text); setPage('edit'); })}</View>)}
            {action('Write my own message', () => { setMessage(''); setPage('edit'); })}
          </> : page === 'edit' ? <>
            <Text style={[font.body, { color: c.muted }]}>Edit in English. Your message is only spoken if you choose Read aloud. Edits clear when you close the cards.</Text>
            <TextInput accessibilityLabel="Card message in English" accessibilityLanguage="en" multiline maxLength={500} value={message} onChangeText={setMessage} placeholder="What would you like someone to know?" placeholderTextColor={c.faint} style={[font.title, { color: c.text, minHeight: 180, textAlignVertical: 'top', padding: 16, backgroundColor: c.surface, borderRadius: 16, borderWidth: 1, borderColor: c.border }]} />
            {action('Show message', () => setPage('show'), true, !valid)}
            {action('Choose another card', () => { stopSpeaking(); setPage('list'); })}
          </> : <>
            <Text selectable accessibilityLanguage="en" style={{ flexGrow: 1, color: c.text, fontSize: 32, lineHeight: 44, fontWeight: '600' }}>{message.trim()}</Text>
            {action(speaking ? 'Stop reading' : 'Read aloud', () => { if (speaking) stopSpeaking(); else void speak(message.trim(), 'en', 'communication-card'); })}
            {action('Edit message', () => { stopSpeaking(); setPage('edit'); })}
          </>}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  </>;
}
