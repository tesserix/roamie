import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import { File } from 'expo-file-system';
import * as Speech from 'expo-speech';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LanguagePicker } from '@/components/language-picker';
import { radius, space, touch, useColors } from '@/constants/theme';
import { ApiError, talkTurn, type TurnRequest, type TurnResponse } from '@/lib/api';
import { countryLanguage, languageName } from '@/lib/languages';
import { useQuietCountry } from '@/lib/location';
import { useStore } from '@/lib/store';

type Phase = 'idle' | 'listening' | 'thinking';
const MIN_HOLD_MS = 400;

export default function Talk() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { profile, partner: saved, setPartner } = useStore();
  const country = useQuietCountry();
  const mine = profile!.language;
  const partner = saved ?? countryLanguage(country) ?? null;

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const startedAt = useRef(0);
  const history = useRef<TurnRequest['history']>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [last, setLast] = useState<TurnResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');

  async function send(input: Pick<TurnRequest, 'audio' | 'text'>) {
    if (!partner) {
      setPicking(true);
      return;
    }
    setPhase('thinking');
    setError(null);
    try {
      const res = await talkTurn({ mine, partner, history: history.current, ...input });
      history.current = [...history.current, { original: res.transcript, translation: res.translation }].slice(-6);
      setLast(res);
      if (res.partner !== partner) setPartner(res.partner);
      if (!res.sameLanguage) Speech.speak(res.translation, { language: res.target });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setPhase('idle');
    }
  }

  async function startListening() {
    setError(null);
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) {
      setError('Roamie needs the microphone to translate. Turn it on in Settings, or tap Type.');
      return;
    }
    Speech.stop();
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    startedAt.current = Date.now();
    setPhase('listening');
  }

  async function stopListening() {
    if (phase !== 'listening') return;
    await recorder.stop();
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    if (Date.now() - startedAt.current < MIN_HOLD_MS || !recorder.uri) {
      setPhase('idle');
      setError('Hold the button while you speak.');
      return;
    }
    const data = await new File(recorder.uri).base64();
    await send({ audio: { data, mimeType: 'audio/mp4' } });
  }

  function submitDraft() {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    setTyping(false);
    send({ text });
  }

  const iSpoke = last ? last.detected === mine : false;
  const theirLine = last ? (iSpoke ? last.translation : last.transcript) : null;
  const myLine = last ? (iSpoke ? last.transcript : last.translation) : null;
  const micLabel = phase === 'listening' ? 'Listening…' : phase === 'thinking' ? 'Translating…' : 'Hold to talk';

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.background }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={[styles.half, styles.flipped, { backgroundColor: c.card, paddingBottom: insets.top + space.md }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={partner ? `Their language: ${languageName(partner)}. Change` : 'Choose their language'}
          onPress={() => setPicking(true)}
          style={({ pressed }) => [styles.langChip, { borderColor: c.border, opacity: pressed ? 0.7 : 1 }]}>
          <Text style={{ color: c.text, fontSize: 15, fontWeight: '600' }}>
            {partner ? `${languageName(partner)} ▾` : 'Choose their language ▾'}
          </Text>
        </Pressable>
        <ScrollView style={styles.lineBox} contentContainerStyle={styles.line}>
          <Text style={[styles.big, { color: c.text }]}>
            {theirLine ?? (partner ? 'Hold the button and speak. Roamie works out who is talking.' : 'Tap above to choose their language.')}
          </Text>
        </ScrollView>
      </View>

      <View style={[styles.middle, { borderColor: c.border }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={micLabel}
          accessibilityHint="Hold while either of you speaks, then let go"
          disabled={phase === 'thinking'}
          onPressIn={startListening}
          onPressOut={stopListening}
          style={({ pressed }) => [
            styles.mic,
            {
              backgroundColor: phase === 'listening' ? c.danger : c.accent,
              transform: [{ scale: pressed ? 1.08 : 1 }],
              opacity: phase === 'thinking' ? 0.6 : 1,
            },
          ]}>
          <Text style={{ color: c.onAccent, fontSize: 17, fontWeight: '800' }}>{micLabel}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => setTyping((t) => !t)} hitSlop={12} style={styles.typeButton}>
          <Text style={{ color: c.accent, fontSize: 15, fontWeight: '600' }}>{typing ? 'Close' : 'Type'}</Text>
        </Pressable>
      </View>

      <View style={[styles.half, { paddingBottom: space.md }]}>
        {error ? (
          <Text accessibilityRole="alert" style={{ color: c.danger, fontSize: 16, textAlign: 'center' }}>
            {error}
          </Text>
        ) : null}
        <ScrollView style={styles.lineBox} contentContainerStyle={styles.line}>
          <Text style={[styles.big, { color: c.text }]}>{myLine ?? `You'll see everything in ${languageName(mine)}.`}</Text>
        </ScrollView>
        {last && !iSpoke && !last.sameLanguage ? (
          <Text style={{ color: c.muted, fontSize: 15, textAlign: 'center' }}>
            Heard {languageName(last.detected)}: “{last.transcript}”
          </Text>
        ) : null}
        {typing ? (
          <View style={{ flexDirection: 'row', gap: space.sm, alignSelf: 'stretch' }}>
            <TextInput
              autoFocus
              accessibilityLabel="Type something to translate"
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={submitDraft}
              returnKeyType="send"
              placeholder="Type in any language"
              placeholderTextColor={c.muted}
              style={[styles.input, { color: c.text, backgroundColor: c.card, borderColor: c.border }]}
            />
          </View>
        ) : null}
      </View>

      <LanguagePicker
        visible={picking}
        title="Their language"
        selected={partner ?? ''}
        onPick={setPartner}
        onClose={() => setPicking(false)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  half: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, paddingHorizontal: space.lg },
  flipped: { transform: [{ rotate: '180deg' }] },
  lineBox: { flexGrow: 0, flexShrink: 1, alignSelf: 'stretch' },
  line: { flexGrow: 1, justifyContent: 'center' },
  big: { fontSize: 28, fontWeight: '600', textAlign: 'center' },
  middle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  mic: { width: 200, height: 72, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  typeButton: { position: 'absolute', right: space.lg, minHeight: touch, justifyContent: 'center' },
  langChip: { minHeight: touch - 8, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, justifyContent: 'center' },
  input: { flex: 1, minHeight: touch + 4, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: space.md, fontSize: 17 },
});
