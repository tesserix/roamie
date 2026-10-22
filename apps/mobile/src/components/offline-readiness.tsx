import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, View } from 'react-native';
import { Text } from './typography';
import { font, space, useColors } from '@/constants/theme';
import { offlineNative } from '../../modules/roamie-offline';
import { languageName } from '@/lib/languages';
import { offlineTextStatus, type OfflineTextStatus } from '@/lib/offline-translation';
import { SPEECH_MODELS, speechModelStatus, supportsSmallSpeechModel, type SpeechAssetState, type SpeechModelStatus } from '@/lib/speech-models';
import { restoreTranslationPreferences, useTranslationPreferences } from '@/lib/translation-preferences';

type Status = { key: string; checking: boolean; available: boolean; text?: OfflineTextStatus; speech?: SpeechModelStatus; error?: string };
const assetLabel = (state?: SpeechAssetState) => state === 'ready' ? 'Downloaded and verified' : state === 'missing' ? 'Not downloaded' : state === 'invalid' ? 'Download incomplete or invalid' : 'Could not verify';

export function OfflineReadiness({ mine, partner, refreshKey, offlineOnly = false, onRefresh }: { mine: string; partner: string | null; refreshKey?: string | boolean | null; offlineOnly?: boolean; onRefresh?: () => void }) {
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
    const [text, speech] = await Promise.allSettled([offlineTextStatus(mine, partner), speechModelStatus(model)]);
    if (current !== revision.current) return;
    clearTimeout(timer.current);
    setStatus({
      key, checking: false, available,
      text: text.status === 'fulfilled' ? text.value : undefined,
      speech: speech.status === 'fulfilled' ? speech.value : undefined,
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
  const text = status.text;
  const ready = text?.state === 'ready' && status.speech?.model === 'ready' && status.speech.detector === 'ready'
    && (model !== 'small' || supportsSmallSpeechModel()) && mine !== 'or' && partner !== 'or';
  const pair = `${languageName(mine)} ↔ ${partner ? languageName(partner) : 'Choose a language'}`;
  const textLabel = text?.state === 'ready' ? `${pair} · Ready on this phone`
    : text?.state === 'unsupported' ? `${text.unsupported.map(languageName).join(', ')} · Offline text is not supported on this phone`
      : text?.state === 'choose_languages' ? 'Choose two different languages to check offline translation'
        : text?.state === 'missing' ? `${pair} · Language packs not ready on this phone`
          : 'Language packs · Could not verify';
  const name = model === 'base' ? 'Base' : 'Small';
  const cloudMode = !offlineOnly && preferences.mode === 'cloud';
  const modeLabel = offlineOnly ? 'Offline tools (on-device only)' : preferences.mode === 'cloud' ? 'Cloud (internet required)' : preferences.mode === 'offline' ? 'Offline only' : 'Automatic';

  return <View style={{ marginHorizontal: space.md, marginTop: space.sm, padding: space.md, gap: space.xs, borderRadius: 16, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }}>
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
          <Text style={[font.caption, { color: c.text }]}>{name} speech model · {assetLabel(status.speech?.model)}{status.speech?.model === 'ready' ? ` · ${Math.ceil(SPEECH_MODELS[model].bytes / 1_000_000)} MB` : ''}</Text>
          <Text style={[font.caption, { color: c.text }]}>Speech detector · {assetLabel(status.speech?.detector)}</Text>
          <Text accessibilityLiveRegion="polite" style={[font.caption, { color: ready && !cloudMode ? c.accent : c.muted }]}>{ready ? cloudMode ? 'Offline downloads are ready. Select Automatic or Offline only to use them.' : 'Offline conversation is ready' : 'Finish preparing offline conversation in Profile → Offline languages.'}</Text>
          {model === 'small' && !supportsSmallSpeechModel() ? <Text style={[font.caption, { color: c.warn }]}>Select Base on this phone. Small needs at least 6 GB of memory.</Text> : null}
          {status.error ? <Text accessibilityRole="alert" style={[font.caption, { color: c.danger }]}>{status.error}</Text> : null}
        </View>}
  </View>;
}
