import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, ScrollView, Switch, View } from 'react-native';
import { Text } from './typography';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getLocales } from 'expo-localization';
import { offlineNative } from '../../modules/roamie-offline';
import { Button, Card, Chip, IconButton, SectionLabel, Segmented } from './ui';
import { LanguagePicker } from './language-picker';
import { TextTranslate } from './text-translate';
import { CameraTranslate } from './camera-translate';
import { font, space, useColors } from '@/constants/theme';
import { languageName, LANGUAGES } from '@/lib/languages';
import { appLanguage, modelLanguage, offlineTextStatus, supportsLocalText } from '@/lib/offline-translation';
import { downloadSpeechModel, removeSpeechModel, SPEECH_MODELS, speechModelStatus, supportsSmallSpeechModel, smallSpeechModelUnavailableReason, type SpeechModelStatus } from '@/lib/speech-models';
import { restoreTranslationPreferences, saveTranslationPreferences, useTranslationPreferences, type SpeechModel, type TranslationMode } from '@/lib/translation-preferences';
import { OfflineReadiness } from './offline-readiness';

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
  const [models, setModels] = useState<Partial<Record<SpeechModel, SpeechModelStatus>>>({});
  const [pairReady, setPairReady] = useState(false);
  const [voices, setVoices] = useState<string[]>([]);
  const [ocr, setOcr] = useState<string[]>([]);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [cellular, setCellular] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const cancelDownload = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const operation = useRef(false);
  const checkRevision = useRef(0);
  const invalidateChecks = useCallback(() => { checkRevision.current++; }, []);
  const available = Boolean(offlineNative());

  const refresh = useCallback(async () => {
    const current = ++checkRevision.current;
    const native = offlineNative();
    if (!native) { setChecking(false); return; }
    setChecking(true);
    const results = await Promise.allSettled([native.downloadedLanguages(), Promise.all([speechModelStatus('base'), speechModelStatus('small')]), native.offlineVoices(), native.ocrLanguages(), native.supportedTextLanguages(), native.canRemoveLanguagePacks(), offlineTextStatus(mine, partner)]);
    if (!alive.current || current !== checkRevision.current) return;
    if (results[0].status === 'fulfilled') setLanguages(['en', ...results[0].value.map(appLanguage)]);
    if (results[1].status === 'fulfilled') setModels({ base: results[1].value[0], small: results[1].value[1] });
    if (results[2].status === 'fulfilled') setVoices(results[2].value.map(voice => appLanguage(voice.language.split(/[-_]/)[0])));
    if (results[3].status === 'fulfilled') setOcr(results[3].value.map(appLanguage));
    if (results[4].status === 'fulfilled') setSupported(results[4].value);
    if (results[5].status === 'fulfilled') setCanRemove(results[5].value);
    setPairReady(results[6].status === 'fulfilled' && results[6].value.state === 'ready');
    if (results.some(result => result.status === 'rejected')) setError('Some offline assets could not be checked. Tap Refresh to try again.');
    setChecking(false);
  }, [mine, partner]);

  useEffect(() => {
    alive.current = true;
    void restoreTranslationPreferences().then(refresh);
    const listener = AppState.addEventListener('change', state => { if (state === 'active' && !operation.current) void refresh(); });
    return () => { alive.current = false; invalidateChecks(); cancelDownload.current?.abort(); listener.remove(); };
  }, [refresh, invalidateChecks]);

  async function run(label: string, action: () => Promise<unknown>, success?: string) {
    if (operation.current) return;
    operation.current = true; setBusy(label); setError(null); setNotice(null);
    try { await action(); if (alive.current && success) setNotice(success); }
    catch (error) { if (alive.current && !(label === 'Downloading speech model…' && cancelDownload.current?.signal.aborted)) setError(error instanceof Error ? error.message : 'Could not finish this action. Please retry.'); }
    finally {
      operation.current = false;
      if (alive.current) { setBusy(null); setProgress(null); await refresh(); }
    }
  }

  const pair = [...new Set([mine, partner])];
  const speech = (['base', 'small'] as const).filter(model => models[model]?.model === 'ready' && models[model]?.detector === 'ready');
  const textReady = available && pairReady;
  const voiceReady = pair.every(language => voices.includes(language));
  const cameraReady = textReady && ocr.includes(partner);
  const readyLine = (label: string, ready: boolean, detail: string) => <Text style={[font.body, { color: ready ? c.text : c.muted }]}>{ready ? '✓' : '○'} {label}: {ready ? 'Ready' : detail}</Text>;

  return <View accessibilityViewIsModal style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top + space.sm, paddingBottom: insets.bottom }}>
    <View style={{ paddingHorizontal: space.md, paddingBottom: space.md, flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
      <Text accessibilityRole="header" style={[font.title, { color: c.text, flex: 1 }]}>Offline translation</Text>
      <IconButton icon="xmark" label="Close offline translation" onPress={onClose} />
    </View>
    <Segmented options={PANELS} value={panel} onChange={setPanel} />
    {panel === 'prepare' ? <ScrollView contentContainerStyle={{ padding: space.md, gap: space.md }}>
      <Text style={[font.body, { color: c.muted }]}>Download before you travel. Text, speech, camera and read-aloud need their own support. Translations in these tools stay on this phone.</Text>
      {!available ? <Text accessibilityRole="alert" style={[font.body, { color: c.warn }]}>Offline models need a new Roamie app build. This installation cannot download or run them yet.</Text> : null}
      <SectionLabel>Languages on this phone</SectionLabel>
      <View style={{ gap: space.sm }}>
        <Button label={`Your offline language: ${languageName(mine)}`} kind="secondary" disabled={!!busy} onPress={() => setPicking('mine')} />
        <Button label={`Other offline language: ${languageName(partner)}`} kind="secondary" disabled={!!busy} onPress={() => setPicking('partner')} />
      </View>
      <OfflineReadiness mine={mine} partner={partner} refreshKey={busy} offlineOnly onRefresh={() => { void run('Checking offline assets…', refresh); }} />
      {checking ? <Text accessibilityRole="progressbar" style={[font.body, { color: c.muted }]}>Checking offline assets…</Text> : <View style={{ gap: space.xs }}>
        {readyLine('Camera', cameraReady, `Requires ${languageName(partner)} camera reading and text packs`)}
        {readyLine('Read aloud in both languages', voiceReady, 'Install offline voices in device speech settings')}
      </View>}
      {pair.map(language => <Card key={language}>
        <Text style={[font.headline, { color: c.text }]}>{languageName(language)}</Text>
        {checking ? null : !supportsLocalText(language, supported) ? <Text style={[font.body, { color: c.muted }]}>This language needs cloud translation. Its offline text pack is not available on this device.</Text>
          : textReady || languages.includes(language) ? <><Text style={[font.caption, { color: c.muted }]}>{language === 'en' ? Platform.OS === 'ios' ? 'English is prepared with the language pair' : 'English pivot · included' : 'Text pack downloaded'}</Text>{language !== 'en' && canRemove ? <Button label={`Remove ${languageName(language)} pack`} kind="secondary" disabled={!!busy} onPress={() => { void run('Removing language…', () => offlineNative()!.removeLanguage(modelLanguage(language))); }} /> : null}</>
            : <Button label={`Download ${languageName(language)}${Platform.OS === 'android' ? ' · about 30 MB' : ''}`} disabled={!available || !!busy} onPress={() => { void run(`Downloading ${languageName(language)}…`, async () => {
              const network = await import('expo-network');
              const state = await network.getNetworkStateAsync();
              if (!cellular && state.type !== network.NetworkStateType.WIFI) throw new Error('Connect to Wi-Fi, or allow mobile data for this download.');
              await offlineNative()!.downloadLanguage(modelLanguage(language), cellular);
            }); }} />}
      </Card>)}
      {Platform.OS === 'ios' ? <Text style={[font.caption, { color: c.muted }]}>iOS manages text pack downloads and sizes. Confirm its download prompt, then refresh readiness. To remove text packs, open Settings → Apps → Translate → Downloaded Languages. Offline text requires iOS 18 or later and a physical iPhone.</Text> : null}
      <SectionLabel>Speech models</SectionLabel>
      <Text style={[font.body, { color: c.muted }]}>Base balances speed and size. Small may recognise speech better, with more memory and battery use. Both include a silence detector. Odia speech is not supported.</Text>
      {(['base', 'small'] as const).map(model => <Card key={model}>
        <Text style={[font.headline, { color: c.text }]}>{SPEECH_MODELS[model].name} · {Math.ceil((SPEECH_MODELS[model].bytes + SPEECH_MODELS.vad.bytes) / 1_000_000)} MB</Text>
        {!checking && models[model] ? <Text style={[font.caption, { color: c.muted }]}>{models[model]!.model === 'ready' ? 'Model file downloaded and verified on this phone' : models[model]!.model === 'invalid' ? 'Model file is incomplete or invalid' : 'Model file is not downloaded'}</Text> : null}
        {!checking && model === 'small' && !supportsSmallSpeechModel() ? <Text style={[font.caption, { color: c.muted }]}>{smallSpeechModelUnavailableReason()}</Text> : null}
        {checking ? null : speech.includes(model) ? model !== 'small' || supportsSmallSpeechModel() ? <Chip label={preferences.speechModel === model ? `${model === 'base' ? 'Base' : 'Small'} selected` : `Use ${model === 'base' ? 'Base' : 'Small'}`} selected={preferences.speechModel === model} onPress={() => { void saveTranslationPreferences({ speechModel: model }); }} /> : null
            : <Button label={models[model]?.model === 'ready' ? `Finish ${model === 'base' ? 'Base' : 'Small'} speech download` : `Download ${model === 'base' ? 'Base' : 'Small'} speech model`} disabled={!available || !!busy || (model === 'small' && !supportsSmallSpeechModel())} onPress={() => {
              cancelDownload.current = new AbortController();
              void run('Downloading speech model…', async () => {
                await downloadSpeechModel(model, cellular, fraction => { if (alive.current) setProgress(fraction); }, cancelDownload.current!.signal);
                if (alive.current) await saveTranslationPreferences({ speechModel: model });
              });
            }} />}
        {!checking && models[model] && models[model]!.model !== 'missing' ? <Button label={`Remove ${model === 'base' ? 'Base' : 'Small'} speech model`} kind="secondary" disabled={!!busy} onPress={() => { void run('Removing speech model…', () => removeSpeechModel(model), `${model === 'base' ? 'Base' : 'Small'} speech model removed from this phone.`); }} /> : null}
      </Card>)}
      <Text style={[font.caption, { color: c.muted }]}>Remove models to free storage. Download them again whenever you need them.</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}><Text style={[font.body, { color: c.text, flex: 1 }]}>Allow mobile data for downloads</Text><Switch accessibilityLabel="Allow mobile data for downloads" value={cellular} onValueChange={setCellular} disabled={!!busy} /></View>
      {busy ? <Text accessibilityRole="progressbar" accessibilityValue={progress === null ? undefined : { min: 0, max: 100, now: Math.min(99, Math.floor(progress * 100)) }} style={[font.body, { color: c.accent }]}>{busy}{progress === null ? '' : ` ${Math.min(99, Math.floor(progress * 100))}%`}</Text> : null}
      {busy === 'Downloading speech model…' ? <Button label="Cancel speech download" kind="secondary" onPress={() => cancelDownload.current?.abort()} /> : null}
      {error || preferences.error ? <Text accessibilityRole="alert" style={[font.body, { color: c.danger }]}>{error ?? preferences.error}</Text> : null}
      {notice ? <Text accessibilityLiveRegion="polite" style={[font.body, { color: c.accent }]}>{notice}</Text> : null}
      {signedIn ? <><Text style={[font.headline, { color: c.text }]}>Main translator preference</Text><Text style={[font.body, { color: c.muted }]}>Automatic uses downloaded models first and can use cloud translation when needed. Offline never uploads translation requests. Cloud always uses the online service.</Text><View style={{ gap: space.sm }}>{(['auto', 'offline', 'cloud'] as TranslationMode[]).map(mode => <Chip key={mode} label={mode === 'auto' ? 'Automatic' : mode === 'offline' ? 'Offline only' : 'Cloud'} selected={preferences.mode === mode} onPress={() => { void saveTranslationPreferences({ mode }); }} />)}</View></> : null}
      <Text style={[font.caption, { color: c.muted }]}>Offline models do not provide cloud review, pronunciation guides or speaker-voice matching. Check important numbers, names and instructions.</Text>
      <LanguagePicker visible={!!picking} title={picking === 'mine' ? 'Your offline language' : 'Other offline language'} selected={picking === 'mine' ? mine : partner} onPick={language => { if (picking === 'mine') setMine(language); else setPartner(language); setPicking(null); }} onClose={() => setPicking(null)} />
    </ScrollView> : panel === 'text' ? <TextTranslate key={`${mine}:${partner}`} mine={mine} partner={partner} bottom={space.md} offlineOnly />
      : panel === 'camera' ? <CameraTranslate mine={mine} partner={partner} bottom={space.md} offlineOnly />
        : <Suspense fallback={<ActivityIndicator color={c.accent} />}><OfflineTalk key={`${mine}:${partner}`} mine={mine} partner={partner} /></Suspense>}
  </View>;
}

