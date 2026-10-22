import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Platform, ScrollView, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getLocales } from 'expo-localization';
import { offlineNative } from '../../modules/roamie-offline';
import { Button, Chip, IconButton, Segmented } from './ui';
import { LanguagePicker } from './language-picker';
import { TextTranslate } from './text-translate';
import { CameraTranslate } from './camera-translate';
import { font, space, useColors } from '@/constants/theme';
import { languageName, LANGUAGES } from '@/lib/languages';
import { appLanguage, modelLanguage, supportsLocalText } from '@/lib/offline-translation';
import { downloadSpeechModel, installedSpeechModels, removeSpeechModel, SPEECH_MODELS, supportsSmallSpeechModel } from '@/lib/speech-models';
import { restoreTranslationPreferences, saveTranslationPreferences, useTranslationPreferences, type SpeechModel, type TranslationMode } from '@/lib/translation-preferences';

type Panel = 'prepare' | 'text' | 'talk' | 'camera';
const PANELS = [{ value: 'prepare' as const, label: 'Prepare', icon: 'wifi.exclamationmark' as const }, { value: 'text' as const, label: 'Text', icon: 'character.cursor.ibeam' as const }, { value: 'talk' as const, label: 'Talk', icon: 'mic.fill' as const }, { value: 'camera' as const, label: 'Camera', icon: 'camera.fill' as const }];

const OfflineTalk = lazy(() => import('./offline-talk').then(module => ({ default: module.OfflineTalk })));

export function OfflineTools({ onClose, mine: initialMine, partner: initialPartner, signedIn = false }: { onClose: () => void; mine?: string; partner?: string | null; signedIn?: boolean }) {
  const c = useColors(); const insets = useSafeAreaInsets();
  const preferences = useTranslationPreferences();
  const [panel, setPanel] = useState<Panel>('prepare');
  const deviceLanguage = getLocales()[0]?.languageCode ?? 'en';
  const [mine, setMine] = useState(initialMine ?? (LANGUAGES[deviceLanguage] ? deviceLanguage : 'en'));
  const [partner, setPartner] = useState(initialPartner ?? (mine === 'fr' ? 'en' : 'fr'));
  const [picking, setPicking] = useState<'mine' | 'partner' | null>(null);
  const [languages, setLanguages] = useState<string[]>([]);
  const [supported, setSupported] = useState<string[]>([]);
  const [canRemove, setCanRemove] = useState(false);
  const [speech, setSpeech] = useState<SpeechModel[]>([]);
  const [voices, setVoices] = useState<string[]>([]);
  const [ocr, setOcr] = useState<string[]>([]);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [cellular, setCellular] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelDownload = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const operation = useRef(false);
  const available = Boolean(offlineNative());

  const refresh = useCallback(async () => {
    const native = offlineNative();
    if (!native) { setChecking(false); return; }
    setChecking(true);
    const results = await Promise.allSettled([native.downloadedLanguages(), installedSpeechModels(), native.offlineVoices(), native.ocrLanguages(), native.supportedTextLanguages(), native.canRemoveLanguagePacks()]);
    if (!alive.current) return;
    if (results[0].status === 'fulfilled') setLanguages(['en', ...results[0].value.map(appLanguage)]);
    if (results[1].status === 'fulfilled') setSpeech(results[1].value);
    if (results[2].status === 'fulfilled') setVoices(results[2].value.map(voice => appLanguage(voice.language.split(/[-_]/)[0])));
    if (results[3].status === 'fulfilled') setOcr(results[3].value.map(appLanguage));
    if (results[4].status === 'fulfilled') setSupported(results[4].value);
    if (results[5].status === 'fulfilled') setCanRemove(results[5].value);
    if (results.some(result => result.status === 'rejected')) setError('Some offline assets could not be checked. Tap Refresh to try again.');
    setChecking(false);
  }, []);

  useEffect(() => {
    alive.current = true;
    void restoreTranslationPreferences().then(refresh);
    return () => { alive.current = false; cancelDownload.current?.abort(); };
  }, [refresh]);

  async function run(label: string, action: () => Promise<unknown>) {
    if (operation.current) return;
    operation.current = true; setBusy(label); setError(null);
    try { await action(); }
    catch (error) { if (alive.current && !(label === 'Downloading speech model…' && cancelDownload.current?.signal.aborted)) setError(error instanceof Error ? error.message : 'Could not finish this action. Please retry.'); }
    finally {
      operation.current = false;
      if (alive.current) { setBusy(null); setProgress(null); await refresh(); }
    }
  }

  const pair = [...new Set([mine, partner])];
  const textReady = available && pair.every(language => supportsLocalText(language, supported) && languages.includes(language));
  const speechReady = textReady && speech.includes(preferences.speechModel) && pair.every(language => language !== 'or');
  const voiceReady = pair.every(language => voices.includes(language));
  const cameraReady = textReady && ocr.includes(partner);
  const readyLine = (label: string, ready: boolean, detail: string) => <Text style={[font.body, { color: ready ? c.text : c.muted }]}>{ready ? '✓' : '○'} {label}: {ready ? 'Ready' : detail}</Text>;

  return <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top + space.sm, paddingBottom: insets.bottom }}>
    <View style={{ paddingHorizontal: space.md, paddingBottom: space.md, flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
      <Text accessibilityRole="header" style={[font.title, { color: c.text, flex: 1 }]}>Offline translation</Text>
      <IconButton icon="xmark" label="Close offline translation" onPress={onClose} />
    </View>
    <Segmented options={PANELS} value={panel} onChange={setPanel} />
    {panel === 'prepare' ? <ScrollView contentContainerStyle={{ padding: space.md, gap: space.md }}>
      <Text style={[font.body, { color: c.muted }]}>Download before you travel. Text, speech, camera and read-aloud need their own support. Translations in these tools stay on this phone.</Text>
      {!available ? <Text accessibilityRole="alert" style={[font.body, { color: c.warn }]}>Offline models need a new Roamie app build. This installation cannot download or run them yet.</Text> : null}
      <Button label={`Your offline language: ${languageName(mine)}`} kind="secondary" onPress={() => setPicking('mine')} />
      <Button label={`Other offline language: ${languageName(partner)}`} kind="secondary" onPress={() => setPicking('partner')} />
      {checking ? <Text accessibilityRole="progressbar" style={[font.body, { color: c.muted }]}>Checking offline assets…</Text> : <View style={{ gap: space.xs }}>
        {readyLine('Text in both directions', textReady, 'Download both supported languages')}
        {readyLine('Microphone', speechReady, 'Download a speech model and both languages')}
        {readyLine('Camera', cameraReady, `Requires ${languageName(partner)} camera reading and text packs`)}
        {readyLine('Read aloud in both languages', voiceReady, 'Install offline voices in device speech settings')}
      </View>}
      {pair.map(language => <View key={language} style={{ gap: space.sm }}>
        <Text style={[font.headline, { color: c.text }]}>{languageName(language)}</Text>
        {checking ? null : !supportsLocalText(language, supported) ? <Text style={[font.body, { color: c.muted }]}>This language needs cloud translation. Its offline text pack is not available on this device.</Text>
          : languages.includes(language) ? <><Text style={[font.caption, { color: c.muted }]}>{language === 'en' ? 'English pivot · included' : 'Text pack downloaded'}</Text>{language !== 'en' && canRemove ? <Button label={`Remove ${languageName(language)} pack`} kind="secondary" disabled={!!busy} onPress={() => { void run('Removing language…', () => offlineNative()!.removeLanguage(modelLanguage(language))); }} /> : null}</>
            : <Button label={`Download ${languageName(language)}${Platform.OS === 'android' ? ' · about 30 MB' : ''}`} disabled={!available || !!busy} onPress={() => { void run(`Downloading ${languageName(language)}…`, async () => {
              const network = await import('expo-network');
              const state = await network.getNetworkStateAsync();
              if (!cellular && state.type !== network.NetworkStateType.WIFI) throw new Error('Connect to Wi-Fi, or allow mobile data for this download.');
              await offlineNative()!.downloadLanguage(modelLanguage(language), cellular);
            }); }} />}
      </View>)}
      {Platform.OS === 'ios' ? <Text style={[font.caption, { color: c.muted }]}>iOS manages text pack downloads and sizes. Confirm its download prompt, then refresh readiness. Remove text packs in Translate settings. Offline text requires iOS 18 or later and a physical iPhone.</Text> : null}
      <Text style={[font.headline, { color: c.text }]}>Speech model</Text>
      <Text style={[font.body, { color: c.muted }]}>Base is the balanced choice. Small uses more memory and battery and may recognise speech better. Neither supports Odia speech. A small speech detector is included to reject silence.</Text>
      {(['base', 'small'] as const).map(model => <View key={model} style={{ gap: space.sm }}>
        <Text style={[font.headline, { color: c.text }]}>{SPEECH_MODELS[model].name} · {Math.ceil((SPEECH_MODELS[model].bytes + SPEECH_MODELS.vad.bytes) / 1_000_000)} MB</Text>
        {checking ? null : model === 'small' && !supportsSmallSpeechModel() ? <Text style={[font.caption, { color: c.muted }]}>Use Base on this phone. Small requires at least 6 GB of device memory.</Text>
          : speech.includes(model) ? <View style={{ gap: space.sm }}><Chip label={preferences.speechModel === model ? `${model === 'base' ? 'Base' : 'Small'} selected` : `Use ${model === 'base' ? 'Base' : 'Small'}`} selected={preferences.speechModel === model} onPress={() => { void saveTranslationPreferences({ speechModel: model }); }} /><Button label={`Remove ${model === 'base' ? 'Base' : 'Small'} speech model`} kind="secondary" disabled={!!busy} onPress={() => { void run('Removing speech model…', () => removeSpeechModel(model)); }} /></View>
            : <Button label={`Download ${model === 'base' ? 'Base' : 'Small'} speech model`} disabled={!available || !!busy} onPress={() => {
              cancelDownload.current = new AbortController();
              void run('Downloading speech model…', async () => {
                await downloadSpeechModel(model, cellular, fraction => { if (alive.current) setProgress(fraction); }, cancelDownload.current!.signal);
                if (alive.current) await saveTranslationPreferences({ speechModel: model });
              });
            }} />}
      </View>)}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}><Text style={[font.body, { color: c.text, flex: 1 }]}>Allow mobile data for downloads</Text><Switch accessibilityLabel="Allow mobile data for downloads" value={cellular} onValueChange={setCellular} disabled={!!busy} /></View>
      {busy ? <Text accessibilityRole="progressbar" accessibilityValue={progress === null ? undefined : { min: 0, max: 100, now: Math.round(progress * 100) }} style={[font.body, { color: c.accent }]}>{busy}{progress === null ? '' : ` ${Math.round(progress * 100)}%`}</Text> : null}
      {busy === 'Downloading speech model…' ? <Button label="Cancel speech download" kind="secondary" onPress={() => cancelDownload.current?.abort()} /> : null}
      {error || preferences.error ? <Text accessibilityRole="alert" style={[font.body, { color: c.danger }]}>{error ?? preferences.error}</Text> : null}
      <Button label="Refresh offline readiness" kind="secondary" disabled={checking || !!busy} onPress={() => { void run('Checking offline assets…', refresh); }} />
      {signedIn ? <><Text style={[font.headline, { color: c.text }]}>Main translator preference</Text><Text style={[font.body, { color: c.muted }]}>Automatic uses downloaded models first and can use cloud translation when needed. Offline never uploads translation requests. Cloud always uses the online service.</Text><View style={{ gap: space.sm }}>{(['auto', 'offline', 'cloud'] as TranslationMode[]).map(mode => <Chip key={mode} label={mode === 'auto' ? 'Automatic' : mode === 'offline' ? 'Offline only' : 'Cloud'} selected={preferences.mode === mode} onPress={() => { void saveTranslationPreferences({ mode }); }} />)}</View></> : null}
      <Text style={[font.caption, { color: c.muted }]}>Offline models do not provide cloud review, pronunciation guides or speaker-voice matching. Check important numbers, names and instructions.</Text>
      <LanguagePicker visible={!!picking} title={picking === 'mine' ? 'Your offline language' : 'Other offline language'} selected={picking === 'mine' ? mine : partner} onPick={language => { if (picking === 'mine') setMine(language); else setPartner(language); setPicking(null); }} onClose={() => setPicking(null)} />
    </ScrollView> : panel === 'text' ? <TextTranslate key={`${mine}:${partner}`} mine={mine} partner={partner} bottom={space.md} offlineOnly />
      : panel === 'camera' ? <CameraTranslate mine={mine} partner={partner} bottom={space.md} offlineOnly />
        : <Suspense fallback={<ActivityIndicator color={c.accent} />}><OfflineTalk key={`${mine}:${partner}`} mine={mine} partner={partner} /></Suspense>}
  </View>;
}

export function OfflinePreparation({ mine, partner, disabled }: { mine: string; partner: string | null; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return <><Button label="Offline languages" icon="wifi.exclamationmark" kind="secondary" disabled={disabled} onPress={() => setOpen(true)} /><Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>{open ? <OfflineTools mine={mine} partner={partner} signedIn onClose={() => setOpen(false)} /> : null}</Modal></>;
}
