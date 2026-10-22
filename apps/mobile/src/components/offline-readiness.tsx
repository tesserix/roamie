import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Modal, Pressable, ScrollView, View } from 'react-native';
import * as Network from 'expo-network';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from './typography';
import { Icon, IconButton } from './ui';
import { font, radius, space, useColors } from '@/constants/theme';
import { useAccessibility } from '@/lib/accessibility';
import { offlineNative } from '../../modules/roamie-offline';
import { languageName } from '@/lib/languages';
import { offlineTextStatus, type OfflineTextStatus } from '@/lib/offline-translation';
import { SPEECH_MODELS, resolveSpeechModel, speechModelStatus, speechModelUnavailableReason, type SpeechAssetState, type SpeechModelStatus } from '@/lib/speech-models';
import { restoreTranslationPreferences, useTranslationPreferences, type SpeechModel } from '@/lib/translation-preferences';

type Status = { key: string; checking: boolean; available: boolean; text?: OfflineTextStatus; speech?: SpeechModelStatus; model?: SpeechModel; error?: string };
const assetLabel = (state?: SpeechAssetState) => state === 'ready' ? 'Downloaded and verified' : state === 'missing' ? 'Not downloaded' : state === 'invalid' ? 'Download incomplete or invalid' : 'Could not verify';

type Props = { mine: string; partner: string | null; refreshKey?: string | boolean | null; offlineOnly?: boolean; onRefresh?: () => void; compact?: boolean; onOpenChange?: (open: boolean) => void };

export function OfflineReadiness(props: Props) {
  return props.compact ? <ConnectionStatus {...props} /> : <DeviceReadiness {...props} />;
}

function ConnectionStatus(props: Props) {
  const c = useColors(), insets = useSafeAreaInsets();
  const { reducedMotion } = useAccessibility();
  const preferences = useTranslationPreferences();
  const [network, setNetwork] = useState<Network.NetworkState | null>();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true, revision = 0;
    const refresh = async () => {
      const current = ++revision;
      const state = await Network.getNetworkStateAsync().catch(() => null);
      if (alive && current === revision) setNetwork(state);
    };
    const connection = Network.addNetworkStateListener(state => { revision++; if (alive) setNetwork(state); });
    const app = AppState.addEventListener('change', state => { if (state === 'active') void refresh(); });
    void refresh();
    return () => { alive = false; connection.remove(); app.remove(); };
  }, []);
  const forced = props.offlineOnly || preferences.mode === 'offline';
  const disconnected = network?.isConnected === false || network?.isInternetReachable === false;
  const online = network?.isInternetReachable === true;
  const label = forced || disconnected ? 'Offline' : online ? 'Online' : network === undefined ? 'Checking connection' : 'Connection unknown';
  const reason = forced ? 'Offline only is selected. Translation stays on this phone and requires downloaded models.'
    : disconnected ? 'Your phone cannot reach the internet. Roamie uses ready downloads; missing language or speech models need to be downloaded first.'
      : online ? 'Your phone has an internet connection. Automatic uses cloud first, with ready offline models as a backup if the connection becomes slow or unavailable.'
        : 'Roamie could not confirm internet access. Automatic can still use ready downloads. Check your connection if cloud translation is unavailable.';
  const close = () => { setOpen(false); props.onOpenChange?.(false); };
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel="Translation connection details" accessibilityHint={`${label}. Opens connection and download information.`} onPress={() => { setOpen(true); props.onOpenChange?.(true); }} style={({ pressed }) => ({ alignSelf: 'flex-start', flexShrink: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.sm, opacity: pressed ? 0.6 : 1 })}>
      <Icon name={forced || disconnected ? 'wifi.slash' : 'wifi'} size={14} color={c.muted} />
      <Text accessibilityLiveRegion="polite" style={[font.caption, { color: c.muted, flexShrink: 1 }]}>{label}</Text>
      <Icon name="info.circle" size={14} color={c.muted} />
    </Pressable>
    <Modal visible={open} animationType={reducedMotion ? 'none' : 'slide'} onRequestClose={close}>
      {open ? <View accessibilityViewIsModal style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top + space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md }}>
          <Text accessibilityRole="header" style={[font.title, { color: c.text, flex: 1 }]}>Translation status</Text>
          <IconButton icon="xmark" label="Close connection details" onPress={close} />
        </View>
        <ScrollView contentContainerStyle={{ padding: space.md, paddingBottom: insets.bottom + space.lg, gap: space.md }}>
          <Text style={[font.headline, { color: c.text }]}>{label}</Text>
          <Text style={[font.body, { color: c.muted }]}>{reason}</Text>
          <DeviceReadiness {...props} />
        </ScrollView>
      </View> : null}
    </Modal>
  </>;
}

function DeviceReadiness({ mine, partner, refreshKey, offlineOnly = false, onRefresh }: Props) {
  const c = useColors();
  const preferences = useTranslationPreferences();
  const model = preferences.speechModel;
  const key = `${mine}:${partner}:${model}`;
  const [status, setStatus] = useState<Status>({ key, checking: true, available: false });
  const revision = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const invalidate = useCallback(() => { revision.current++; clearTimeout(timer.current); }, []);

  const refresh = useCallback(async () => {
    const current = ++revision.current;
    clearTimeout(timer.current);
    const available = !!offlineNative();
    setStatus({ key, checking: available, available });
    if (!available) return;
    timer.current = setTimeout(() => {
      if (current !== revision.current) return;
      revision.current++;
      setStatus({ key, checking: false, available, error: 'The device check took too long. Tap Refresh to retry.' });
    }, 15_000);
    const [text, speech] = await Promise.allSettled([offlineTextStatus(mine, partner), (async () => {
      const selected = (await resolveSpeechModel(model))?.model ?? model;
      return { model: selected, status: await speechModelStatus(selected) };
    })()]);
    if (current !== revision.current) return;
    clearTimeout(timer.current);
    setStatus({
      key, checking: false, available,
      text: text.status === 'fulfilled' ? text.value : undefined,
      speech: speech.status === 'fulfilled' ? speech.value.status : undefined,
      model: speech.status === 'fulfilled' ? speech.value.model : undefined,
      error: text.status === 'rejected' || speech.status === 'rejected' ? 'Some downloads could not be verified. Tap Refresh to retry.' : undefined,
    });
  }, [key, mine, partner, model]);

  useEffect(() => {
    const current = revision.current;
    void restoreTranslationPreferences().then(() => { if (current === revision.current) void refresh(); });
    const listener = AppState.addEventListener('change', state => { if (state === 'active') void refresh(); });
    return () => { invalidate(); listener.remove(); };
  }, [refresh, refreshKey, invalidate]);

  const checking = status.checking || status.key !== key;
  const selected = status.model ?? model;
  const text = status.text;
  const ready = text?.state === 'ready' && status.speech?.model === 'ready' && status.speech.detector === 'ready'
    && !speechModelUnavailableReason(selected) && mine !== 'or' && partner !== 'or';
  const pair = `${languageName(mine)} ↔ ${partner ? languageName(partner) : 'Choose a language'}`;
  const textLabel = text?.state === 'ready' ? `${pair} · Ready on this phone${text.provider === 'hymt' ? ' · Large text model' : ''}`
    : text?.state === 'unsupported' ? `${text.unsupported.map(languageName).join(', ')} · Offline text is not supported on this phone`
      : text?.state === 'choose_languages' ? 'Choose two different languages to check offline translation'
        : text?.state === 'missing' ? `${pair} · ${text.provider === 'hymt' ? 'Download Large text model' : 'Language packs not ready on this phone'}`
          : 'Language packs · Could not verify';
  const name = SPEECH_MODELS[selected].name;
  const modeLabel = offlineOnly ? 'Offline tools (on-device only)' : preferences.mode === 'offline' ? 'Offline only' : 'Automatic';

  return <View style={{ padding: space.md, gap: space.xs, borderRadius: radius.lg, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
      <Text accessibilityRole="header" style={[font.headline, { flex: 1, color: c.text }]}>Offline on this phone</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Refresh offline status" accessibilityState={{ disabled: checking }} disabled={checking} onPress={() => { if (onRefresh) onRefresh(); else void refresh(); }} style={({ pressed }) => ({ minHeight: 44, minWidth: 64, justifyContent: 'center', alignItems: 'center', opacity: checking ? 0.4 : pressed ? 0.6 : 1 })}>
        <Text style={[font.caption, { color: c.accent }]}>Refresh</Text>
      </Pressable>
    </View>
    {checking ? <Text accessibilityRole="progressbar" style={[font.caption, { color: c.muted }]}>Verifying downloads on this phone…</Text>
      : !status.available ? <Text style={[font.caption, { color: c.warn }]}>Install the latest Roamie build to use offline models.</Text>
        : <View style={{ gap: space.xs }}>
          <Text style={[font.caption, { color: c.muted }]}>Translation mode · {modeLabel}</Text>
          <Text style={[font.caption, { color: c.text }]}>{textLabel}</Text>
          <Text style={[font.caption, { color: c.text }]}>{name} speech model · {assetLabel(status.speech?.model)}{status.speech?.model === 'ready' ? ` · ${Math.ceil(SPEECH_MODELS[selected].bytes / 1_000_000)} MB` : ''}</Text>
          <Text style={[font.caption, { color: c.text }]}>Speech detector · {assetLabel(status.speech?.detector)}</Text>
          <Text accessibilityLiveRegion="polite" style={[font.caption, { color: ready ? c.accent : c.muted }]}>{ready ? 'Offline conversation is ready' : 'Finish preparing offline conversation in Profile → Offline languages.'}</Text>
          {speechModelUnavailableReason(selected) ? <Text style={[font.caption, { color: c.warn }]}>{speechModelUnavailableReason(selected)}</Text> : null}
          {status.error ? <Text accessibilityRole="alert" style={[font.caption, { color: c.danger }]}>{status.error}</Text> : null}
        </View>}
  </View>;
}
