import { useIsFocused } from 'expo-router';
import type { SFSymbol } from 'expo-symbols';
import {
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import { File } from 'expo-file-system';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  AppState,
  ActivityIndicator,
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
import { HandsFreeConversation } from '@/lib/hands-free';
import { waitForMicrophoneForeground } from '@/lib/microphone';
import { SPEECH_RECORDING } from '@/lib/recording';
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
import { ApiError, talkTurn, type TurnRequest, type VoiceGender } from '@/lib/api';
import { languageName } from '@/lib/languages';
import { useStore } from '@/lib/store';
import { playbackVoice, speak, stopSpeaking } from '@/lib/voice';

type Phase = RecordingPhase | 'speaking';
type Turn = {
  id: string;
  fromMe: boolean;
  mineText: string;
  mineLang: string;
  theirText: string;
  theirLang: string;
  theirRoman: string;
  translated: Shown;
  same: boolean;
  voice?: VoiceGender;
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
  const { profile, talkPartner: saved, setTalkPartner: savePartner, talkLanguage, setTalkLanguage } = useStore();
  const [mine, setMine] = useState(talkLanguage ?? profile!.language);
  const [autoMine, setAutoMine] = useState(!talkLanguage);
  const [partner, setPartner] = useState(saved);
  const [autoPartner, setAutoPartner] = useState(!saved);
  const languages = useRef({ mine, partner, autoMine, autoPartner });
  languages.current = { mine, partner, autoMine, autoPartner };
  const expectedSpeaker = useRef<TurnRequest['expectedSpeaker']>(undefined);

  const recorder = useAudioRecorder(SPEECH_RECORDING);
  const startedAt = useRef(0);
  const recording = useRef(false);
  const captureRevision = useRef(0);
  const recordingLock = useRef(false);
  const requestingPermission = useRef(false);
  const sending = useRef(false);
  const request = useRef<AbortController | null>(null);
  const automaticRequest = useRef(false);
  const playbackCanceled = useRef(false);
  const playbackRevision = useRef(0);
  const history = useRef<TurnRequest['history']>([]);
  const failedTurns = useRef(0);
  const unclearTurns = useRef(0);
  const list = useRef<FlatList<Turn>>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pick<TurnRequest, 'text'> | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  const [picking, setPicking] = useState<'mine' | 'partner' | null>(null);
  const [typing, setTyping] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const [draft, setDraft] = useState('');
  const [showing, setShowing] = useState<Shown | null>(null);
  const [mode, setMode] = useState<Mode>('talk');
  const [handsFree, setHandsFree] = useState(false);
  const conversation = useRef<HandsFreeConversation | null>(null);
  const sendRef = useRef(send);
  useEffect(() => { sendRef.current = send; });
  useEffect(() => {
    const loop = new HandsFreeConversation(recorder, {
      onActive: active => { setHandsFree(active); if (!active) setRecoveryNotice(null); },
      isForeground: () => focusedRef.current && AppState.currentState === 'active',
      onPhase: setPhase,
      onError: setError,
      onRecovery: setRecoveryNotice,
      onTurn: async (uri, active) => {
        const data = await new File(uri).base64();
        if (active()) await sendRef.current({ audio: { data, mimeType: 'audio/mp4' } }, active);
      },
    });
    conversation.current = loop;
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') {
        loop.onAppBackground();
        if (!requestingPermission.current) captureRevision.current++;
        if (recording.current) {
          recording.current = false;
          recordingLock.current = true;
          void recorder.stop().catch(() => {}).then(() => setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }))
            .catch(() => {}).finally(() => { recordingLock.current = false; setPhase('idle'); });
        }
        if (automaticRequest.current) request.current?.abort();
      }
    });
    return () => { subscription.remove(); loop.stop(); conversation.current = null; };
  }, [recorder]);
  useEffect(() => {
    if (!focused || mode !== 'talk' || typing || showing || picking) {
      conversation.current?.stop();
      if (automaticRequest.current) request.current?.abort();
    }
  }, [focused, mode, typing, showing, picking]);

  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboard(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboard(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  async function send(input: Pick<TurnRequest, 'audio' | 'text'>, automatic?: () => boolean) {
    if (sending.current) return;
    sending.current = true;
    const controller = new AbortController();
    request.current = controller;
    automaticRequest.current = Boolean(automatic);
    setPending({ text: input.text });
    setPhase('thinking');
    setError(null);
    setNotice(null);
    setRecoveryNotice(null);
    try {
      const current = languages.current;
      const res = await talkTurn({ mine: current.mine, partner: current.partner ?? current.mine, autoMine: current.autoMine, partnerLocked: !current.autoPartner, expectedSpeaker: current.autoPartner ? expectedSpeaker.current : 'mine', history: history.current, ...input }, controller.signal, () => setRecoveryNotice('Connection interrupted. Retrying…'));
      if (controller.signal.aborted || (automatic && !automatic())) return;
      const fromMe = !current.autoPartner && current.autoMine ? res.detected !== current.partner : res.fromMe ?? res.detected === current.mine;
      const turnMine = current.autoMine && fromMe ? res.detected : current.mine;
      if (!current.autoPartner && (res.partner !== current.partner || res.target !== (fromMe ? current.partner : turnMine))) {
        throw new ApiError('The translation did not match the chosen languages. Please try again or check the languages above.', 422, 'language_mismatch');
      }
      failedTurns.current = 0; unclearTurns.current = 0;
      setRecoveryNotice(null);
      setPending(null);
      if (!res.reviewRequired) history.current = [...history.current, { original: res.transcript, translation: res.translation }].slice(-6);
      setTurns((t) => [
        ...t,
        {
          id: `${Date.now()}`,
          fromMe,
          mineText: fromMe ? res.transcript : res.translation,
          mineLang: turnMine,
          theirText: fromMe ? res.translation : res.transcript,
          theirLang: fromMe ? res.target : res.detected,
          theirRoman: fromMe ? res.romanized : '',
          translated: { text: res.translation, lang: res.target, romanized: res.romanized },
          same: res.sameLanguage,
          voice: res.voice,
        },
      ]);
      if (res.reviewRequired) {
        conversation.current?.stop();
        setNotice('Check this translation before using it. Clarify the phrase or choose the languages above.');
        return;
      }
      if (focusedRef.current) signalFeedback(accessibilityRef.current.vibration);
      if (current.autoMine && fromMe) { languages.current.mine = turnMine; setMine(turnMine); }
      if (!fromMe && current.autoPartner) { languages.current.partner = res.partner; setPartner(res.partner); }
      expectedSpeaker.current = fromMe ? 'partner' : 'mine';
      if (!current.partner && fromMe) setNotice('Let the other person speak once so we can detect their language, or choose it above.');
      if (focusedRef.current && !res.sameLanguage && !accessibilityRef.current.quiet && (!accessibilityRef.current.screenReader || automatic)) {
        playbackCanceled.current = false;
        setPhase('speaking');
        const playback = speak(res.translation, res.target, undefined, playbackVoice(accessibilityRef.current.voice, res.voice));
        const played = await playback;
        if (!played && automatic?.()) setRecoveryNotice('Translation is on screen. Still listening.');
        if (!played && !automatic && focusedRef.current && !playbackCanceled.current) {
          setNotice('The translation is ready, but speech could not play. Tap Read aloud to retry or use Show them.');
        }
      }
      if (accessibilityRef.current.screenReader && !automatic) AccessibilityInfo.announceForAccessibility('Translation ready.');
    } catch (e) {
      if (controller.signal.aborted) return;
      if (automatic) {
        if (!automatic()) return;
        const unclear = e instanceof ApiError && e.status === 422 && e.code === 'no_speech';
        if (unclear) {
          unclearTurns.current++;
          if (unclearTurns.current >= 3) {
            setRecoveryNotice('Speech wasn’t clear. Please wait a moment…');
            await new Promise<void>(resolve => {
              const finish = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', finish); resolve(); };
              const timer = setTimeout(finish, 3000);
              controller.signal.addEventListener('abort', finish, { once: true });
              if (controller.signal.aborted) finish();
            });
            if (!automatic()) return;
          }
          setRecoveryNotice('Still listening. Please repeat a little closer.');
          return;
        }
        if (e instanceof ApiError && e.retryable) {
          failedTurns.current++;
          if (failedTurns.current >= 3) throw new Error('Conversation paused after several attempts. Check your microphone or connection, then try again or use Type.');
          setRecoveryNotice('Connection interrupted. Still listening. Please repeat when connected.');
          return;
        }
        throw e;
      }
      if (input.text) setDraft(current => current || input.text!);
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    } finally {
      if (request.current === controller) {
        request.current = null;
        sending.current = false;
        setPending(null);
        if (!automatic) setPhase('idle');
      }
    }
  }

  async function readTurn(turn: Turn) {
    if (sending.current || phase !== 'idle') return;
    conversation.current?.stop();
    const revision = ++playbackRevision.current;
    playbackCanceled.current = false;
    setNotice(null);
    setPhase('speaking');
    const played = await speak(turn.translated.text, turn.translated.lang, undefined, playbackVoice(accessibilityRef.current.voice, turn.voice));
    if (revision !== playbackRevision.current) return;
    if (!played && focusedRef.current && !playbackCanceled.current) setNotice('The translation is ready, but speech could not play. Tap Read aloud to retry or use Show them.');
    setPhase('idle');
  }

  async function startListening() {
    if (recordingLock.current || sending.current) return;
    recordingLock.current = true;
    const revision = ++captureRevision.current;
    setPhase('starting');
    setError(null);
    try {
      let permission = await getRecordingPermissionsAsync();
      if (revision !== captureRevision.current) return;
      if (!permission.granted) {
        requestingPermission.current = true;
        try {
          permission = await requestRecordingPermissionsAsync();
          if (permission.granted) await waitForMicrophoneForeground(() => revision === captureRevision.current && focusedRef.current, () => AppState.currentState === 'active');
        }
        finally { requestingPermission.current = false; }
      }
      if (revision !== captureRevision.current) return;
      if (!focusedRef.current) { setPhase('idle'); return; }
      if (!permission.granted) throw new Error('Allow microphone access in Settings, or choose Type instead.');
      if (AppState.currentState !== 'active') throw new Error('Return to Roamie, then start recording again.');
      stopSpeaking();
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync(SPEECH_RECORDING);
      if (revision !== captureRevision.current) {
        await recorder.stop().catch(() => {});
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
        return;
      }
      if (!focusedRef.current) { await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }); setPhase('idle'); return; }
      recorder.record();
      recording.current = true;
      startedAt.current = Date.now();
      setPhase('listening');
      if (focusedRef.current) signalFeedback(accessibilityRef.current.vibration);
    } catch (error) {
      if (revision !== captureRevision.current) return;
      setError(error instanceof Error ? error.message : 'Could not open the microphone. Type instead.');
      setPhase('idle');
    } finally {
      recordingLock.current = false;
      if (revision !== captureRevision.current) setPhase('idle');
    }
  }

  async function stopListening() {
    if (!recording.current || recordingLock.current) return;
    recordingLock.current = true;
    const revision = captureRevision.current;
    setPhase('thinking');
    recording.current = false;
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      if (Date.now() - startedAt.current < MIN_HOLD_MS || !recorder.uri) throw new Error('No speech recorded. Tap the microphone and try again, or type instead.');
      const data = await new File(recorder.uri).base64();
      if (revision !== captureRevision.current) return;
      await send({ audio: { data, mimeType: 'audio/mp4' } });
    } catch (error) {
      if (revision !== captureRevision.current) return;
      setError(error instanceof Error ? error.message : 'Could not finish recording. Try again.');
      setPhase('idle');
    } finally {
      recordingLock.current = false;
      if (revision !== captureRevision.current) setPhase('idle');
    }
  }

  useEffect(() => {
    if (focused) return;
    captureRevision.current++;
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
    request.current?.abort();
    playbackRevision.current++;
    stopSpeaking();
  }, [recorder]);

  function submitDraft() {
    const text = draft.trim();
    if (!text || sending.current || phase !== 'idle') return;
    setDraft('');
    send({ text });
  }

  const busy = phase !== 'idle' || pending !== null;
  const status =
    error ??
    recoveryNotice ??
    (pending && phase === 'idle' ? 'Finishing the previous request…' : phase === 'speaking' ? 'Speaking…' : phase === 'listening' ? (handsFree ? 'Listening · pause to translate' : 'Listening…') : phase === 'thinking' ? 'Translating…' : notice ? notice : typing ? null : accessibility.quiet ? 'Quiet mode · both sides stay on screen.' : null);

  useEffect(() => {
    if (accessibility.screenReader && !handsFree && (error || phase !== 'idle')) {
      AccessibilityInfo.announceForAccessibility(error ?? (phase === 'listening' ? 'Recording. Activate Finish and translate when you are done.' : phase === 'starting' ? 'Opening microphone.' : 'Translating.'));
    }
  }, [accessibility.screenReader, error, phase, handsFree]);

  const header = (
    <>
      <View style={[styles.header, { paddingTop: insets.top + space.sm }]}>
        <Text maxFontSizeMultiplier={2} style={[fontScale > 1.3 ? font.title : font.largeTitle, { color: c.text, flex: 1 }]} accessibilityRole="header">
          Translate
        </Text>
        {mode === 'talk' && (turns.length || pending) ? (
          <IconButton
            icon="trash"
            label="Clear conversation"
            onPress={() => {
              conversation.current?.stop();
              playbackRevision.current++;
              captureRevision.current++;
              stopSpeaking();
              if (recording.current) {
                recording.current = false;
                recordingLock.current = true;
                void recorder.stop().then(() => setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }))
                  .catch(() => setError('Could not stop the microphone. Leave this screen and try again.'))
                  .finally(() => { recordingLock.current = false; setPhase('idle'); });
              }
              request.current?.abort();
              request.current = null;
              sending.current = false;
              playbackCanceled.current = true;
              setPending(null);
              setPhase(recordingLock.current ? 'starting' : 'idle');
              setError(null);
              setNotice(null);
              setRecoveryNotice(null);
              failedTurns.current = 0; unclearTurns.current = 0;
              setTurns([]);
              history.current = [];
              expectedSpeaker.current = undefined;
              if (autoPartner) { languages.current.partner = null; setPartner(null); }
              if (autoMine) { languages.current.mine = profile!.language; setMine(profile!.language); }
            }}
          />
        ) : null}
        <View pointerEvents={handsFree ? 'none' : 'auto'} accessibilityElementsHidden={handsFree} importantForAccessibility={handsFree ? 'no-hide-descendants' : 'auto'} style={{ opacity: handsFree ? 0.4 : 1 }}><ProfileSettings /></View>
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
        <Pressable accessibilityRole="button"
          accessibilityLabel={`Your language: ${autoMine ? `Auto-detect (${languageName(mine)})` : languageName(mine)}. Change`}
          disabled={busy}
          onPress={() => setPicking('mine')}
          style={({ pressed }) => [styles.langSide, { minHeight: 48, justifyContent: 'center', opacity: pressed ? 0.6 : 1 }]}>
          <Text maxFontSizeMultiplier={2} style={[font.overline, { color: c.muted }]}>{autoMine ? 'You · auto' : 'You'}</Text>
          <Text maxFontSizeMultiplier={2} style={[font.headline, { color: c.text }]} >
            {autoMine ? `Auto · ${languageName(mine)}` : languageName(mine)}
          </Text>
        </Pressable>
        <View style={[styles.swap, { backgroundColor: c.accentSoft }]}>
          <Icon name="arrow.left.arrow.right" size={16} color={c.accent} />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={partner ? `Their language: ${languageName(partner)}. Change` : 'Their language: Auto-detect. Choose manually'}
          disabled={busy}
          onPress={() => setPicking('partner')}
          style={({ pressed }) => [styles.langSide, { minHeight: 48, justifyContent: 'center', alignItems: 'flex-end', opacity: pressed ? 0.6 : 1 }]}>
          <Text maxFontSizeMultiplier={2} style={[font.overline, { color: c.muted }]}>{autoPartner ? 'Them · auto' : 'Them'}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text maxFontSizeMultiplier={2} style={[font.headline, { color: partner ? c.text : c.accent, flexShrink: 1 }]} >
              {partner ? languageName(partner) : 'Auto-detect'}
            </Text>
            <Icon name="chevron.down" size={12} color={c.muted} />
          </View>
        </Pressable>
      </View>

          </View>
        }
        onContentSizeChange={() => { if (turns.length) list.current?.scrollToEnd({ animated: !accessibility.reducedMotion }); }}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={pending ? null :
          <View style={{ flexGrow: 1, justifyContent: 'center' }}>
            <Message
              icon="bubble.left.and.bubble.right.fill"
              title={handsFree ? "Speak naturally" : "Talk to anyone"}
              body={
                handsFree ? "Take turns speaking. Pause briefly when you finish, then wait for the translation before replying." : partner
                  ? `Tap to speak. Tap again to translate. Replies switch automatically between ${languageName(mine)} and the other person’s language.`
                  : `Let the other person speak first. We’ll detect their language and translate into ${languageName(mine)}. Then reply in ${languageName(mine)}.`
              }
            />
          </View>
        }
        ListFooterComponent={pending ? <View style={{ padding: space.md, borderRadius: radius.lg, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, gap: 12 }}>
          {pending.text ? <Text style={[font.body, { color: c.text }]}>{pending.text}</Text> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <ActivityIndicator color={c.accent} accessible={false} />
            <Text accessibilityLiveRegion="polite" style={[font.body, { color: c.muted }]}>Finding the words…</Text>
          </View>
        </View> : null}
        renderItem={({ item }) => (
          <Bubble turn={item} busy={busy} onPlay={() => { void readTurn(item); }} onShow={() => { conversation.current?.stop(); setShowing(item.translated); }} />
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
        {phase === 'speaking' && !handsFree ? <IconButton icon="stop.fill" label="Stop speaking" onPress={() => { playbackCanceled.current = true; stopSpeaking(); }} /> : null}
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
              disabled={!draft.trim() || phase !== 'idle'}
              onPress={submitDraft}
              style={({ pressed }) => [
                styles.send,
                { backgroundColor: c.accent, opacity: !draft.trim() || phase !== 'idle' ? 0.4 : pressed ? 0.8 : 1 },
              ]}>
              <Icon name="arrow.up" size={20} color={c.onAccent} />
            </Pressable>
            <IconButton icon="xmark" label="Close keyboard" onPress={() => setTyping(false)} />
          </View>
        ) : (
          <View style={styles.micRow}>
            <Pressable accessibilityRole="button" accessibilityLabel="Type instead"
              disabled={handsFree || busy} accessibilityState={{ disabled: handsFree || busy }}
              onPress={() => setTyping(true)}
              style={({ pressed }) => [styles.sideAction, { opacity: handsFree || busy ? 0.4 : pressed ? 0.7 : 1 }]}>
              <View style={[styles.sideIcon, lift, { backgroundColor: c.surface }]}><Icon name="keyboard" size={22} color={c.text} /></View>
              <Text maxFontSizeMultiplier={2} style={[font.caption, { color: c.muted, textAlign: 'center' }]}>Type</Text>
            </Pressable>
            {handsFree ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Stop hands-free conversation"
                onPress={() => { conversation.current?.stop(); request.current?.abort(); }}
                style={({ pressed }) => ({ flex: 1, alignItems: 'center', gap: 8, paddingVertical: 6, opacity: pressed ? 0.8 : 1 })}>
                <View style={{ padding: 5, borderRadius: 48, borderWidth: 1, borderColor: c.danger, backgroundColor: c.surface }}>
                  <View style={{ width: 68, height: 68, borderRadius: 34, backgroundColor: c.danger, alignItems: 'center', justifyContent: 'center' }}><Icon name="stop.fill" size={28} color={c.onAccent} /></View>
                </View>
                <Text maxFontSizeMultiplier={2} style={[font.body, { color: c.danger, fontWeight: '600', textAlign: 'center' }]}>Stop</Text>
              </Pressable>
            ) : <RecordButton phase={phase === 'speaking' || pending ? 'thinking' : phase} onPress={() => { void (phase === 'listening' ? stopListening() : startListening()); }} />}
            {handsFree ? (
              <View style={styles.sideAction} accessible accessibilityLabel="Hands-free active">
                <View style={[styles.sideIcon, { backgroundColor: c.accentSoft }]}><Icon name="waveform" size={22} color={c.accent} /></View>
                <Text maxFontSizeMultiplier={2} style={[font.caption, { color: c.accent, fontWeight: '600', textAlign: 'center' }]}>Hands-free</Text>
              </View>
            ) : (
              <Pressable accessibilityRole="button" accessibilityLabel="Start hands-free conversation"
                accessibilityHint="Listens for pauses, translates, and speaks each reply. Stop at any time."
                disabled={busy} accessibilityState={{ disabled: busy }}
                onPress={() => { if (!sending.current && !recording.current && !recordingLock.current) { setError(null); setNotice(null); setRecoveryNotice(null); failedTurns.current = 0; unclearTurns.current = 0; void conversation.current?.start(); } }}
                style={({ pressed }) => [styles.sideAction, { opacity: busy ? 0.4 : pressed ? 0.7 : 1 }]}>
                <View style={[styles.sideIcon, { backgroundColor: c.accentSoft }]}><Icon name="waveform" size={22} color={c.accent} /></View>
                <Text maxFontSizeMultiplier={2} style={[font.caption, { color: c.accent, fontWeight: '600', textAlign: 'center' }]}>Hands-free</Text>
              </Pressable>
            )}
          </View>
        )}

      </View>

      </>
      )}

      <LanguagePicker
        visible={picking !== null}
        allowAuto
        title={picking === 'mine' ? 'Your language' : 'Their language'}
        selected={picking === 'mine' ? (autoMine ? '' : mine) : autoPartner ? '' : partner ?? ''}
        onPick={code => {
          if (picking === 'mine') {
            languages.current.autoMine = !code;
            setAutoMine(!code);
            setTalkLanguage(code || null);
            if (code) { languages.current.mine = code; setMine(code); }
          } else { languages.current.partner = code || null; languages.current.autoPartner = !code; setAutoPartner(!code); setPartner(code || null); savePartner(code || null); }
          expectedSpeaker.current = undefined;
          history.current = [];
        }}
        onClose={() => setPicking(null)}
      />
      <ShowThem shown={showing} onClose={() => setShowing(null)} />
    </KeyboardAvoidingView>
  );
}

function Bubble({ turn, busy, onShow, onPlay }: { turn: Turn; busy: boolean; onShow: () => void; onPlay: () => void }) {
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
            disabled={busy}
            accessibilityState={{ disabled: busy }}
            onPress={onPlay}
            style={styles.action}>
            <Icon name="speaker.wave.2.fill" size={14} color={c.accent} />
            <Text style={[font.caption, { color: c.accent, fontWeight: '600' }]}>Play</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Show them" hitSlop={10} onPress={onShow} style={styles.action}>
            <Icon name="arrow.up.left.and.arrow.down.right" size={14} color={c.accent} />
            <Text style={[font.caption, { color: c.accent, fontWeight: '600' }]}>Show them</Text>
          </Pressable>
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
  sideAction: { width: 76, minHeight: 72, alignItems: 'center', justifyContent: 'center', gap: 6 },
  sideIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  micRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  typeRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  input: { flex: 1, minHeight: 48, borderRadius: radius.pill, paddingHorizontal: space.md + 2, fontSize: 17 },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
