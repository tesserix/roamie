import { useEffect, useRef, useState } from 'react';
import { AppState, ScrollView, Text, View } from 'react-native';
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { Button, SpeakButton } from './ui';
import { font, space, useColors } from '@/constants/theme';
import { talkTurn, type TurnResponse } from '@/lib/api';
import { SPEECH_RECORDING } from '@/lib/recording';
import { languageName } from '@/lib/languages';
import { waitForMicrophoneForeground } from '@/lib/microphone';
import { stopSpeaking } from '@/lib/voice';

export function OfflineTalk({ mine, partner }: { mine: string; partner: string }) {
  const c = useColors();
  const recorder = useAudioRecorder(SPEECH_RECORDING);
  const [phase, setPhase] = useState<'idle' | 'starting' | 'recording' | 'thinking'>('idle');
  const [result, setResult] = useState<TurnResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const revision = useRef(0);
  const recording = useRef(false);
  const locked = useRef(false);
  const permissionPending = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const started = useRef(0);
  const stopRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    const stop = () => {
      revision.current++;
      controller.current?.abort();
      clearTimeout(timer.current);
      stopSpeaking();
      if (recording.current) { recording.current = false; void recorder.stop().catch(() => {}).finally(() => { locked.current = false; }); }
    };
    const listener = AppState.addEventListener('change', state => {
      if (state !== 'active' && !permissionPending.current) { stop(); setPhase('idle'); }
    });
    return () => { listener.remove(); stop(); };
  }, [recorder]);

  async function start() {
    if (locked.current) return;
    locked.current = true;
    const current = ++revision.current;
    setPhase('starting'); setError(null); stopSpeaking();
    try {
      let permission = await getRecordingPermissionsAsync();
      if (!permission.granted) {
        permissionPending.current = true;
        try {
          permission = await requestRecordingPermissionsAsync();
          if (permission.granted) await waitForMicrophoneForeground(() => current === revision.current, () => AppState.currentState === 'active');
        } finally { permissionPending.current = false; }
      }
      if (current !== revision.current) return;
      if (!permission.granted) throw new Error('Allow microphone access in Settings, or use Text instead.');
      if (AppState.currentState !== 'active') throw new Error('Return to Roamie to record.');
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync(SPEECH_RECORDING);
      if (current !== revision.current) { await recorder.stop().catch(() => {}); return; }
      recorder.record(); recording.current = true; started.current = Date.now(); setPhase('recording');
      timer.current = setTimeout(() => { void stopRef.current(); }, 30_000);
    } catch (error) {
      if (current === revision.current) { setError(error instanceof Error ? error.message : 'Could not start recording.'); setPhase('idle'); }
    } finally { locked.current = false; }
  }

  async function finish() {
    if (!recording.current || locked.current) return;
    locked.current = true; recording.current = false; clearTimeout(timer.current);
    const current = revision.current;
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      if (current !== revision.current) return;
      if (!recorder.uri || Date.now() - started.current < 400) throw new Error('Record a short phrase before translating.');
      setPhase('thinking');
      const request = new AbortController(); controller.current = request;
      const next = await talkTurn({ mine, partner, partnerLocked: true, audio: { uri: recorder.uri, mimeType: 'audio/mp4' }, history: [], offlineOnly: true }, request.signal);
      if (current === revision.current && !request.signal.aborted) setResult(next);
    } catch (error) {
      if (current === revision.current) setError(error instanceof Error ? error.message : 'Could not translate this recording.');
    } finally {
      locked.current = false;
      if (current === revision.current) setPhase('idle');
    }
  }
  useEffect(() => { stopRef.current = finish; });

  return <ScrollView contentContainerStyle={{ padding: space.md, gap: space.md }}>
    <Text style={[font.headline, { color: c.text }]}>{languageName(mine)} ↔ {languageName(partner)}</Text>
    <Text style={[font.body, { color: c.muted }]}>Take turns speaking. Record a short phrase, then translate it on this phone. Both language packs and a speech model must be downloaded.</Text>
    <Button label={phase === 'recording' ? 'Finish and translate offline' : phase === 'thinking' ? 'Translating on this phone…' : 'Record a phrase'} icon={phase === 'recording' ? 'stop.fill' : 'mic.fill'} busy={phase === 'starting' || phase === 'thinking'} onPress={() => { void (phase === 'recording' ? finish() : start()); }} />
    {phase === 'thinking' ? <Button label="Cancel translation" kind="secondary" onPress={() => { revision.current++; controller.current?.abort(); setPhase('idle'); }} /> : null}
    {error ? <Text accessibilityRole="alert" style={[font.body, { color: c.danger }]}>{error}</Text> : null}
    {result ? <View style={{ gap: space.md }}><Text selectable style={[font.body, { color: c.muted }]}>{result.transcript}</Text><Text selectable style={[font.title, { color: c.text }]}>{result.translation}</Text><Text style={[font.caption, { color: c.muted }]}>Translated on this phone. Check important details.</Text><SpeakButton text={result.translation} lang={result.target} offlineOnly /></View> : null}
  </ScrollView>;
}
