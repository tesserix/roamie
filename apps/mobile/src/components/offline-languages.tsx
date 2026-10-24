import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, FlatList, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, Switch, View } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, TextInput } from './typography';
import { LanguagePicker } from './language-picker';
import { font, radius, space, useColors } from '@/constants/theme';
import { languageName } from '@/lib/languages';
import { downloadOfflineLanguages, offlineCode, offlineModelBusy, offlineStatus, removeOfflineLanguage, subscribeOfflineModels, translateOffline, type OfflineStatus } from '@/lib/offline-translation';
import { cancelOfflineRecognition, downloadOfflineSpeech, offlineSpeechStatus, recognizeOffline, speakOffline, stopOfflineRecognition, stopOfflineSpeech, type OfflineSpeechStatus } from '@/lib/offline-speech';

function OfflineAction({ title, onPress, disabled = false }: { title: string; onPress: () => void; disabled?: boolean }) {
  const c = useColors();
  return <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => ({ minHeight: 48, padding: space.md, borderRadius: 14, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, justifyContent: 'center', opacity: disabled ? 0.45 : pressed ? 0.7 : 1 })}><Text style={[font.headline, { color: c.accent }]}>{title}</Text></Pressable>;
}

export function OfflineLanguages({ label = 'Offline languages', variant = 'button', disabled = false }: { label?: string; variant?: 'button' | 'shortcut' | 'icon'; disabled?: boolean }) {
  const c = useColors(), insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false), [status, setStatus] = useState<OfflineStatus | null>(null);
  const [from, setFrom] = useState('en'), [to, setTo] = useState('fr');
  const [picker, setPicker] = useState<'from' | 'to' | 'download' | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [cellular, setCellular] = useState(false), [busy, setBusy] = useState('');
  const [text, setText] = useState(''), [result, setResult] = useState(''), [error, setError] = useState('');
  const [speech, setSpeech] = useState<OfflineSpeechStatus | null>(null), [notice, setNotice] = useState('');
  const modelBusy = useSyncExternalStore(subscribeOfflineModels, offlineModelBusy, () => false);
  const revision = useRef(0), working = useRef(false);
  useEffect(() => {
    if (!open) return;
    let live = true;
    const refresh = () => {
      void offlineStatus().then(value => { if (live) setStatus(value); }).catch(() => { if (live) setError('Could not check downloaded languages. Close and reopen to retry.'); });
      void offlineSpeechStatus(from, to).then(value => { if (live) setSpeech(value); }).catch(() => { if (live) setSpeech(null); });
    };
    refresh();
    const listener = AppState.addEventListener('change', state => {
      if (state === 'active') refresh();
      else { cancelOfflineRecognition(); stopOfflineSpeech(); }
    });
    return () => { live = false; listener.remove(); };
  }, [open, from, to, modelBusy]);
  useEffect(() => {
    if (!open) return;
    let live = true;
    void AsyncStorage.getItem('roamie.offline.pair').then(value => {
      if (!live || !value) return;
      try {
        const pair: unknown = JSON.parse(value);
        if (Array.isArray(pair) && pair.length === 2 && pair.every(code => typeof code === 'string')) { setFrom(pair[0]); setTo(pair[1]); }
      } catch { /* A damaged preference does not remove installed models. */ }
    }).catch(() => {});
    return () => { live = false; };
  }, [open]);
  useEffect(() => () => { revision.current++; cancelOfflineRecognition(); stopOfflineSpeech(); }, []);
  const supported = Boolean(status?.available && [from, to].every(code => status.supported.includes(offlineCode(code))));
  const ready = supported && [from, to].every(code => status?.downloaded.includes(offlineCode(code)));
  const locked = Boolean(busy) || modelBusy;
  async function perform(title: string, work: (isCurrent: () => boolean) => Promise<void>) {
    if (working.current) return;
    working.current = true;
    const current = ++revision.current;
    const isCurrent = () => current === revision.current;
    setBusy(title); setError(''); setNotice('');
    try { await work(isCurrent); const next = await offlineStatus(); if (isCurrent()) setStatus(next); }
    catch (e) { if (isCurrent()) setError(e instanceof Error ? e.message : 'Could not finish. Please retry.'); }
    finally {
      try { const next = await offlineStatus(); if (isCurrent()) setStatus(next); } catch { /* Preserve the original operation error. */ }
      if (isCurrent()) setBusy(''); working.current = false;
    }
  }
  const close = () => {
    revision.current++; cancelOfflineRecognition(); stopOfflineSpeech(); setOpen(false); setBusy('');
    setText(''); setResult(''); setError(''); setNotice(''); setCellular(false); setPicker(null);
  };
  const header = <View style={{ gap: space.md }}>
    <Text style={[font.body, { color: c.muted }]}>Download your language and the language you need before travelling. Text translation then works on this phone, including in airplane mode.</Text>
    {!status ? <Text accessibilityLiveRegion="polite">Checking installed languages…</Text> : !status.available ? <Text accessibilityRole="alert">Offline translation requires a new iOS or Android app build.</Text> : <>
      <Text style={[font.body, { color: c.text }]}>{status.online ? 'Connected · downloads available' : 'Offline mode · using this phone'}</Text>
      <Text accessibilityRole="header" style={[font.headline, { color: c.text }]}>{status.downloaded.length} languages downloaded</Text>
      <Text style={[font.body, { color: c.muted }]}>Keep five or more languages for your trip, with no app limit. Choose at least two for your first download. Download while connected, then switch between downloaded languages in airplane mode.</Text>
      <Text style={[font.caption, { color: c.muted }]}>Text packs are typically around 30 MB each; actual storage varies. Remove unused languages below to free device storage. Odia is not supported by the current offline engine.</Text>
      <OfflineAction title="Choose languages to download" disabled={locked || !status.online} onPress={() => setPicker('download')} />
      {selection.length ? <Text style={[font.body, { color: c.text }]}>Selected: {selection.map(languageName).join(', ')}</Text> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}><Text style={[font.body, { flex: 1, color: c.text }]}>Allow mobile data for this download</Text><Switch accessibilityLabel="Allow mobile data for this download" value={cellular} onValueChange={setCellular} disabled={locked} /></View>
      <OfflineAction title="Download selected languages" disabled={locked || !selection.length || !status.online} onPress={() => { void perform('Downloading and preparing languages…', async isCurrent => {
        await downloadOfflineLanguages(selection, cellular);
        if (isCurrent()) setSelection([]);
      }); }} />
      <Text accessibilityRole="header" style={[font.headline, { color: c.text }]}>Translate offline</Text>
      <OfflineAction title={`From: ${status.downloaded.includes(offlineCode(from)) ? languageName(from) : 'Choose downloaded language'}`} onPress={() => setPicker('from')} disabled={locked || !status.downloaded.length} />
      <OfflineAction title={`To: ${status.downloaded.includes(offlineCode(to)) ? languageName(to) : 'Choose downloaded language'}`} onPress={() => setPicker('to')} disabled={locked || !status.downloaded.length} />
      <OfflineAction title="Swap languages" onPress={() => { setFrom(to); setTo(from); setResult(''); }} disabled={locked || !ready} />
      <Text style={[font.body, { color: c.text }]}>{ready ? 'Ready for offline text translation' : supported ? 'Download both languages to use this pair offline' : 'Choose two downloaded languages to translate offline.'}</Text>
      {locked ? <Text accessibilityLiveRegion="polite">{busy || 'Working with language models…'}</Text> : null}
      <Text style={[font.body, { color: c.text }]}>Voice input: {speech?.inputLocale ? 'available on this phone' : 'not installed or unavailable'}. Spoken output: {speech?.voice ? 'device voice available' : 'not available for this language'}.</Text>
      <Text style={[font.caption, { color: c.muted }]}>Speech models are separate from text packs. Camera translation and hands-free mode still need a connection. Test voice in airplane mode before travelling.</Text>
      {Platform.OS === 'android' && !speech?.inputLocale && speech?.downloadableLocale ? <OfflineAction title="Download speech support" disabled={locked || !status.online} onPress={() => { void perform('Requesting speech download…', async isCurrent => {
        const message = await downloadOfflineSpeech(from);
        const next = await offlineSpeechStatus(from, to);
        if (isCurrent()) { setSpeech(next); setNotice(message); }
      }); }} /> : null}
      {busy === 'Listening on this phone…' ? <OfflineAction title="Finish speaking" onPress={stopOfflineRecognition} /> : <OfflineAction title="Speak offline" disabled={locked || !ready || !speech?.inputLocale} onPress={() => { void perform('Listening on this phone…', async isCurrent => {
        const transcript = await recognizeOffline(from);
        if (!isCurrent()) return;
        setText(transcript); setBusy('Translating on this phone…');
        const translated = await translateOffline(transcript, from, to);
        if (isCurrent()) setResult(translated);
      }); }} />}
      <TextInput accessibilityLabel="Text to translate offline" multiline maxLength={2000} value={text} onChangeText={value => { setText(value); setResult(''); }} editable={!locked} placeholder="Type a message" placeholderTextColor={c.muted} style={[font.body, { color: c.text, backgroundColor: c.surface, padding: space.md, minHeight: 120, textAlignVertical: 'top', borderRadius: 12 }]} />
      <OfflineAction title="Translate on this phone" disabled={locked || !ready || !text.trim()} onPress={() => { void perform('Translating on this phone…', async isCurrent => {
        const translated = await translateOffline(text, from, to);
        if (isCurrent()) setResult(translated);
      }); }} />
      {result ? <>
        <Text selectable accessibilityLiveRegion="polite" accessibilityLanguage={to} style={[font.title, { color: c.text }]}>{result}</Text>
        <Text accessibilityRole="link" onPress={() => void Linking.openURL('https://translate.google.com')} style={[font.caption, { color: c.accent }]}>Translated by Google</Text>
        <OfflineAction title="Read offline translation aloud" disabled={locked || !speech?.voice} onPress={() => { void perform('Speaking on this phone…', async () => { if (!await speakOffline(result, to)) throw new Error('The device voice could not play. Read the translation on screen.'); }); }} />
        <Text style={[font.caption, { color: c.muted }]}>Offline translations may be less accurate. Check names, numbers and important details.</Text>
      </> : null}
      <Text accessibilityRole="header" style={[font.headline, { color: c.text }]}>Downloaded languages</Text>
    </>}
    {notice ? <Text accessibilityLiveRegion="polite" style={[font.body, { color: c.text }]}>{notice}</Text> : null}
    {error ? <Text accessibilityRole="alert" style={[font.body, { color: c.danger }]}>{error}</Text> : null}
  </View>;
  return <>{variant === 'icon' ? <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint="Download and manage languages for offline translation." accessibilityState={{ disabled }} disabled={disabled} onPress={() => setOpen(true)} style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface, opacity: disabled ? 0.45 : pressed ? 0.7 : 1 })}><FontAwesome name="download" size={18} color={c.accent} accessible={false} /></Pressable> : variant === 'shortcut' ? <Pressable
    accessibilityRole="button" accessibilityLabel={label} accessibilityHint="Download and manage languages for translation without an internet connection."
    accessibilityState={{ disabled }} disabled={disabled} onPress={() => setOpen(true)}
    style={({ pressed }) => ({ minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.sm, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, opacity: disabled ? 0.45 : pressed ? 0.7 : 1 })}>
    <View style={{ width: 36, height: 36, borderRadius: radius.sm, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
      <FontAwesome name="download" size={18} color={c.accent} accessible={false} />
    </View>
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={[font.headline, { color: c.text }]}>{label}</Text>
      <Text style={[font.caption, { color: c.muted }]}>Download for offline use</Text>
    </View>
    <FontAwesome name="angle-right" size={22} color={c.muted} accessible={false} />
  </Pressable> : <OfflineAction title={label} disabled={disabled} onPress={() => setOpen(true)} />}<Modal visible={open} animationType="slide" onRequestClose={close}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} accessibilityViewIsModal style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top }}>
      <View style={{ padding: space.md, gap: space.sm }}><Text accessibilityRole="header" style={[font.title, { color: c.text }]}>Offline languages</Text><OfflineAction title="Close offline languages" onPress={close} /></View>
      <FlatList data={status?.available ? status.downloaded : []} keyExtractor={code => code} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: insets.bottom + space.lg }} ListHeaderComponent={header} ListEmptyComponent={status?.available ? <Text>No downloaded languages yet.</Text> : null} renderItem={({ item }) => <View style={{ gap: space.sm }}>
        <Text style={[font.body, { color: c.text }]}>{languageName(item === 'tl' ? 'fil' : item)} · downloaded</Text>
        <OfflineAction title={`Remove ${languageName(item === 'tl' ? 'fil' : item)}`} disabled={locked} onPress={() => { setResult(''); void perform('Removing language…', () => removeOfflineLanguage(item)); }} />
      </View>} />
      <LanguagePicker visible={picker !== null} title={picker === 'download' ? 'Choose languages to download' : 'Downloaded languages'} selected={picker === 'from' ? from : to}
        catalogue={picker === 'download'} multiple={picker === 'download'} selectedCodes={selection}
        availableCodes={picker === 'download' ? status?.supported.filter(code => !status.downloaded.includes(code)) ?? [] : status?.downloaded ?? []}
        onClose={() => setPicker(null)} onPick={code => {
          if (picker === 'download') { setSelection(previous => previous.includes(code) ? previous.filter(item => item !== code) : [...previous, code]); return; }
          const pair = picker === 'from' ? [code, to] : [from, code];
          if (picker === 'from') setFrom(code); else setTo(code);
          setResult('');
          void AsyncStorage.setItem('roamie.offline.pair', JSON.stringify(pair)).catch(() => {});
        }} />
    </KeyboardAvoidingView>
  </Modal></>;
}
