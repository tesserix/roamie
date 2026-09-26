import { useIsFocused } from 'expo-router';
import type { SFSymbol } from 'expo-symbols';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import { File } from 'expo-file-system';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { CommunicationCards } from '@/components/communication-cards';
import { signalFeedback } from '@/lib/feedback';
import { ProfileSettings } from '@/components/profile-settings';
import { RecordButton, type RecordingPhase } from '@/components/record-button';
import { useAccessibility } from '@/lib/accessibility';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CameraTranslate } from '@/components/camera-translate';
import { LanguagePicker } from '@/components/language-picker';
import { type Shown, ShowThem } from '@/components/show-them';
import { TextTranslate } from '@/components/text-translate';
import { Icon, IconButton, Message, Segmented, TAB_CLEARANCE } from '@/components/ui';
import { font, lift, radius, space, useColors } from '@/constants/theme';
import { ApiError, talkTurn, type TurnRequest } from '@/lib/api';
import { countryLanguage, languageName } from '@/lib/languages';
import { useQuietCountry } from '@/lib/location';
import { useStore } from '@/lib/store';
import { speak, stopSpeaking } from '@/lib/voice';

type Phase = RecordingPhase;
type Turn = {
  id: string;
  fromMe: boolean;
  mineText: string;
  mineLang: string;
  theirText: string;
  theirLang: string;
  theirRoman: string;
  same: boolean;
};
type Mode = 'talk' | 'text' | 'camera';
const MODES: { value: Mode; label: string; icon: SFSymbol }[] = [
  { value: 'talk', label: 'Talk', icon: 'mic.fill' },
  { value: 'text', label: 'Text', icon: 'character.cursor.ibeam' },
  { value: 'camera', label: 'Camera', icon: 'camera.fill' },
];

const MIN_HOLD_MS = 400;


export default function Talk() {
  const c = useColors();
  const { fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const focusedRef = useRef(focused);
  useEffect(() => { focusedRef.current = focused; }, [focused]);
  const accessibility = useAccessibility();
  const accessibilityRef = useRef(accessibility);
  useEffect(() => { accessibilityRef.current = accessibility; }, [accessibility]);
  const { profile, partner: saved, setPartner } = useStore();
  const country = useQuietCountry();
  const mine = profile!.language;
  const partner = saved ?? countryLanguage(country) ?? null;

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const startedAt = useRef(0);
  const recording = useRef(false);
  const recordingLock = useRef(false);
  const history = useRef<TurnRequest['history']>([]);
  const list = useRef<FlatList<Turn>>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [typing, setTyping] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const [draft, setDraft] = useState('');
  const [showing, setShowing] = useState<Shown | null>(null);
  const [mode, setMode] = useState<Mode>('talk');

  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboard(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboard(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

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
      const fromMe = res.detected === mine;
      setTurns((t) => [
        ...t,
        {
          id: `${Date.now()}`,
          fromMe,
          mineText: fromMe ? res.transcript : res.translation,
          mineLang: mine,
          theirText: fromMe ? res.translation : res.transcript,
          theirLang: fromMe ? res.target : res.detected,
          theirRoman: fromMe ? res.romanized : '',
          same: res.sameLanguage,
        },
      ]);
      if (focusedRef.current) signalFeedback(accessibilityRef.current.vibration);
      if (res.partner !== partner) setPartner(res.partner);
      if (!res.sameLanguage && !accessibilityRef.current.quiet && !accessibilityRef.current.screenReader) void speak(res.translation, res.target);
      if (accessibilityRef.current.screenReader) AccessibilityInfo.announceForAccessibility('Translation ready.');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setPhase('idle');
    }
  }

  async function startListening() {
    if (!partner) { setPicking(true); return; }
    if (recordingLock.current) return;
    recordingLock.current = true;
    setPhase('starting');
    setError(null);
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!focusedRef.current) { setPhase('idle'); return; }
      if (!permission.granted) throw new Error('Allow microphone access in Settings, or choose Type instead.');
      stopSpeaking();
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      if (!focusedRef.current) { await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }); setPhase('idle'); return; }
      recorder.record();
      recording.current = true;
      startedAt.current = Date.now();
      setPhase('listening');
      if (focusedRef.current) signalFeedback(accessibilityRef.current.vibration);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not open the microphone. Type instead.');
      setPhase('idle');
    } finally { recordingLock.current = false; }
  }

  async function stopListening() {
    if (!recording.current || recordingLock.current) return;
    recordingLock.current = true;
    setPhase('thinking');
    try {
      await recorder.stop();
      recording.current = false;
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      if (Date.now() - startedAt.current < MIN_HOLD_MS || !recorder.uri) throw new Error('No speech recorded. Tap the microphone and try again, or type instead.');
      const data = await new File(recorder.uri).base64();
      await send({ audio: { data, mimeType: 'audio/mp4' } });
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not finish recording. Try again.');
      setPhase('idle');
    } finally { recordingLock.current = false; }
  }

  useEffect(() => {
    if (focused) return;
    stopSpeaking();
    if (recording.current) {
      recording.current = false;
      void recorder.stop().catch(() => {}).then(() => setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true })).catch(() => {}).finally(() => setPhase('idle'));
    }
  }, [focused, recorder]);

  useEffect(() => () => {
    if (recording.current) {
      recording.current = false;
      void recorder.stop().catch(() => {});
    }
    stopSpeaking();
  }, [recorder]);

  function submitDraft() {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    send({ text });
  }

  const status =
    error ??
    (phase === 'listening' ? 'Listening…' : phase === 'thinking' ? 'Translating…' : typing ? null : accessibility.quiet ? 'Quiet mode · both sides stay on screen.' : null);

  useEffect(() => {
    if (accessibility.screenReader && (error || phase !== 'idle')) {
      AccessibilityInfo.announceForAccessibility(error ?? (phase === 'listening' ? 'Recording. Activate Finish and translate when you are done.' : phase === 'starting' ? 'Opening microphone.' : 'Translating.'));
    }
  }, [accessibility.screenReader, error, phase]);

  const header = (
    <>
      <View style={[styles.header, { paddingTop: insets.top + space.sm }]}>
        <Text maxFontSizeMultiplier={2} style={[fontScale > 1.3 ? font.title : font.largeTitle, { color: c.text, flex: 1 }]} accessibilityRole="header">
          Translate
        </Text>
        {mode === 'talk' && turns.length ? (
          <IconButton
            icon="trash"
            label="Clear conversation"
            onPress={() => {
              setTurns([]);
              history.current = [];
            }}
          />
        ) : null}
        <ProfileSettings />
      </View>

      <Segmented disabled={phase !== 'idle'} options={MODES} value={mode} onChange={next => { if (phase === 'idle') setMode(next); }} />
      <View style={{ marginHorizontal: space.md, marginVertical: space.sm }}><CommunicationCards disabled={phase !== 'idle'} /></View>

    </>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.background }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      {mode !== 'talk' ? header : null}

      {mode === 'text' ? (
        <TextTranslate mine={mine} partner={partner} bottom={keyboard ? space.md : TAB_CLEARANCE} />
      ) : mode === 'camera' ? (
        <CameraTranslate mine={mine} bottom={TAB_CLEARANCE} />
      ) : (
      <>
      <FlatList
        key={`conversation-${fontScale}`}
        ref={list}
        data={turns}
        keyExtractor={(t) => t.id}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: space.md, paddingBottom: space.md, gap: space.md, flexGrow: 1 }}
        ListHeaderComponent={
          <View style={{ marginHorizontal: -space.md }}>
            {header}
      <View style={[styles.langBar, lift, { backgroundColor: c.surface }]}>
        <View style={styles.langSide}>
          <Text maxFontSizeMultiplier={2} style={[font.overline, { color: c.muted }]}>You</Text>
          <Text maxFontSizeMultiplier={2} style={[font.headline, { color: c.text }]} >
            {languageName(mine)}
          </Text>
        </View>
        <View style={[styles.swap, { backgroundColor: c.accentSoft }]}>
          <Icon name="arrow.left.arrow.right" size={16} color={c.accent} />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={partner ? `Their language: ${languageName(partner)}. Change` : 'Choose their language'}
          onPress={() => setPicking(true)}
          style={({ pressed }) => [styles.langSide, { minHeight: 48, justifyContent: 'center', alignItems: 'flex-end', opacity: pressed ? 0.6 : 1 }]}>
          <Text maxFontSizeMultiplier={2} style={[font.overline, { color: c.muted }]}>{saved ? 'Them' : 'Them · auto'}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text maxFontSizeMultiplier={2} style={[font.headline, { color: partner ? c.text : c.accent, flexShrink: 1 }]} >
              {partner ? languageName(partner) : 'Choose'}
            </Text>
            <Icon name="chevron.down" size={12} color={c.muted} />
          </View>
        </Pressable>
      </View>

          </View>
        }
        onContentSizeChange={() => { if (turns.length) list.current?.scrollToEnd({ animated: !accessibility.reducedMotion }); }}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <Message
              icon="bubble.left.and.bubble.right.fill"
              title="Talk to anyone"
              body={
                partner
                  ? `Tap the mic, speak, then tap again. Translate between ${languageName(mine)} and ${languageName(partner)}.`
                  : 'Choose their language, then tap the microphone. You can type instead.'
              }
            />
          </View>
        }
        renderItem={({ item }) => (
          <Bubble turn={item} onShow={() => setShowing({ text: item.theirText, lang: item.theirLang, romanized: item.theirRoman })} />
        )}
      />

      <View key={`recording-${fontScale}`} style={[styles.dock, { paddingBottom: keyboard ? space.sm : TAB_CLEARANCE }]}>
        {status ? (
          <Text
            accessibilityLiveRegion="polite"
            accessibilityRole={error ? 'alert' : undefined}
            style={[font.caption, { color: error ? c.danger : c.muted, textAlign: 'center' }]}>
            {status}
          </Text>
        ) : null}
        {typing ? (
          <View style={styles.typeRow}>
            <TextInput
              autoFocus
              accessibilityLabel="Type something to translate"
              autoCorrect={false}
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={submitDraft}
              returnKeyType="send"
              placeholder="Type in any language"
              placeholderTextColor={c.faint}
              style={[styles.input, lift, { color: c.text, backgroundColor: c.surface }]}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Translate"
              disabled={!draft.trim() || phase === 'thinking'}
              onPress={submitDraft}
              style={({ pressed }) => [
                styles.send,
                { backgroundColor: c.accent, opacity: !draft.trim() || phase === 'thinking' ? 0.4 : pressed ? 0.8 : 1 },
              ]}>
              <Icon name="arrow.up" size={20} color={c.onAccent} />
            </Pressable>
            <IconButton icon="xmark" label="Close keyboard" onPress={() => setTyping(false)} />
          </View>
        ) : (
          <View style={styles.micRow}>
            <IconButton icon="keyboard" label="Type instead" tone="soft" onPress={() => setTyping(true)} />
            <RecordButton phase={phase} onPress={() => { void (phase === 'listening' ? stopListening() : startListening()); }} />
            <View style={{ width: 44 }} accessible={false} />
          </View>
        )}
      </View>

      </>
      )}

      <LanguagePicker
        visible={picking}
        title="Their language"
        selected={partner ?? ''}
        onPick={setPartner}
        onClose={() => setPicking(false)}
      />
      <ShowThem shown={showing} onClose={() => setShowing(null)} />
    </KeyboardAvoidingView>
  );
}

function Bubble({ turn, onShow }: { turn: Turn; onShow: () => void }) {
  const c = useColors();
  const mine = turn.fromMe;
  return (
    <View style={{ alignItems: mine ? 'flex-end' : 'flex-start', gap: 4 }}>
      <Text style={[font.caption, { color: c.faint, paddingHorizontal: space.xs }]}>
        {mine ? 'You' : `Them · ${languageName(turn.theirLang)}`}
      </Text>
      <View
        style={[
          styles.bubble,
          mine ? { backgroundColor: c.accent, borderBottomRightRadius: 6 } : [lift, { backgroundColor: c.surface, borderBottomLeftRadius: 6 }],
        ]}>
        <Text style={{ color: mine ? c.onAccent : c.text, fontSize: 18, lineHeight: 25, fontWeight: '500' }}>{turn.mineText}</Text>
        {turn.same ? null : (
          <Text style={{ color: mine ? c.onAccent : c.muted, opacity: mine ? 0.8 : 1, fontSize: 15, lineHeight: 21 }}>
            {turn.theirText}
          </Text>
        )}
        {turn.theirRoman ? (
          <Text style={{ color: mine ? c.onAccent : c.muted, opacity: 0.7, fontSize: 14, fontStyle: 'italic' }}>{turn.theirRoman}</Text>
        ) : null}
      </View>
      {turn.same ? null : (
        <View style={{ flexDirection: 'row', gap: space.md, paddingHorizontal: space.xs }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Read translation aloud"
            hitSlop={10}
            onPress={() => (mine ? speak(turn.theirText, turn.theirLang) : speak(turn.mineText, turn.mineLang))}
            style={styles.action}>
            <Icon name="speaker.wave.2.fill" size={14} color={c.accent} />
            <Text style={[font.caption, { color: c.accent, fontWeight: '600' }]}>Play</Text>
          </Pressable>
          {mine ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Show them" hitSlop={10} onPress={onShow} style={styles.action}>
              <Icon name="arrow.up.left.and.arrow.down.right" size={14} color={c.accent} />
              <Text style={[font.caption, { color: c.accent, fontWeight: '600' }]}>Show them</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingBottom: space.md },
  langBar: {
    marginHorizontal: space.md,
    borderRadius: radius.lg,
    paddingVertical: 12,
    paddingHorizontal: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  langSide: { flex: 1, gap: 2 },
  swap: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  bubble: { maxWidth: '86%', borderRadius: radius.lg, paddingHorizontal: space.md, paddingVertical: 12, gap: 6 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 48 },
  dock: { paddingHorizontal: space.md, paddingTop: space.sm, gap: space.sm },
  micRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  typeRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  input: { flex: 1, minHeight: 48, borderRadius: radius.pill, paddingHorizontal: space.md + 2, fontSize: 17 },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
