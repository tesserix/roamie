import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';
import * as Speech from 'expo-speech';
import { offlineStatus } from './offline-translation';

type Recognizer = typeof import('expo-speech-recognition').ExpoSpeechRecognitionModule;
type Voice = { identifier: string; language: string };
type NativeAudio = { speechLocale?(language: string): Promise<string | null>; offlineVoices(): Promise<Voice[]> };
const recognizer = () => requireOptionalNativeModule<Recognizer>('ExpoSpeechRecognition');
const audio = () => requireOptionalNativeModule<NativeAudio>('RoamieOffline');
const base = (locale: string) => locale.toLowerCase().split(/[-_]/)[0];
export type OfflineSpeechStatus = { inputLocale: string | null; downloadableLocale: string | null; voice: Voice | null };

function inventoryWithin<T>(query: Promise<T>, fallback: T): Promise<T> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(fallback), 5000);
    query.then(value => { clearTimeout(timer); resolve(value); }, () => { clearTimeout(timer); resolve(fallback); });
  });
}

export async function offlineSpeechStatus(from: string, to: string): Promise<OfflineSpeechStatus> {
  const module = recognizer(), native = audio();
  let inputLocale: string | null = null, downloadableLocale: string | null = null;
  if (module?.supportsOnDeviceRecognition?.()) {
    if (Platform.OS === 'ios') inputLocale = await inventoryWithin(native?.speechLocale?.(from) ?? Promise.resolve(null), null);
    else if (Platform.OS === 'android') {
      const locales = await inventoryWithin(module.getSupportedLocales({}), { installedLocales: [], locales: [] });
      inputLocale = locales.installedLocales.find(locale => base(locale) === from) ?? null;
      downloadableLocale = locales.locales.find(locale => base(locale) === from) ?? null;
    }
  }
  const voices = native?.offlineVoices ? await inventoryWithin(native.offlineVoices(), []) : [];
  return { inputLocale, downloadableLocale, voice: voices.find(voice => base(voice.language) === to) ?? null };
}

let cancelRecognition: (() => void) | null = null;
let capturePending = false;
let captureRevision = 0;
export function cancelOfflineRecognition() { captureRevision++; cancelRecognition?.(); }
export function stopOfflineRecognition() { if (cancelRecognition) recognizer()?.stop(); else cancelOfflineRecognition(); }

export async function recognizeOffline(language: string): Promise<string> {
  if (capturePending) throw new Error('The microphone is busy. Stop recording before trying again.');
  capturePending = true;
  const revision = ++captureRevision;
  try {
  const module = recognizer();
  const status = await offlineSpeechStatus(language, language);
  if (!module || !status.inputLocale) throw new Error('Offline speech is not installed for this language. Download speech support or type instead.');
  if (revision !== captureRevision) throw new Error('Recording cancelled.');
  const permission = await module.requestMicrophonePermissionsAsync();
  if (revision !== captureRevision) throw new Error('Recording cancelled.');
  if (!permission.granted) throw new Error('Allow microphone access in Settings, or type instead.');
  return await new Promise<string>((resolve, reject) => {
    let done = false;
    const subscriptions: { remove(): void }[] = [];
    const finish = (text?: string, error?: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      subscriptions.forEach(subscription => subscription.remove());
      cancelRecognition = null;
      module.abort();
      if (text?.trim()) resolve(text.trim());
      else reject(new Error(error ?? 'No speech was recognized. Try again or type instead.'));
    };
    const timer = setTimeout(() => finish(undefined, 'Offline speech timed out. Try a shorter sentence or type instead.'), 30000);
    cancelRecognition = () => finish(undefined, 'Recording cancelled.');
    subscriptions.push(module.addListener('result', event => { if (event.isFinal) finish(event.results[0]?.transcript); }));
    subscriptions.push(module.addListener('error', () => finish(undefined, 'Offline speech could not finish. Check the speech download or type instead.')));
    subscriptions.push(module.addListener('end', () => finish()));
    try { module.start({ lang: status.inputLocale!, requiresOnDeviceRecognition: true, continuous: false, interimResults: false, maxAlternatives: 1, recordingOptions: { persist: false } }); }
    catch { finish(undefined, 'Could not start offline speech. Type instead.'); }
  });
  } finally { capturePending = false; }
}

export async function downloadOfflineSpeech(language: string): Promise<string> {
  const network = await offlineStatus();
  if (!network.online) throw new Error('Connect to Wi-Fi to download speech support.');
  if (!network.wifi) throw new Error('Connect to Wi-Fi to download speech support.');
  const module = recognizer(), status = await offlineSpeechStatus(language, language);
  if (Platform.OS !== 'android' || !module || !status.downloadableLocale) throw new Error('Speech downloads are managed by this phone. Use keyboard dictation or type instead.');
  const result = await module.androidTriggerOfflineModelDownload({ locale: status.downloadableLocale });
  return result.status === 'download_success' ? 'Speech download completed. Checking availability…' : 'Speech download requested. Return here after the phone finishes downloading.';
}

let cancelPlayback: (() => void) | null = null;
let playbackRevision = 0;
export function stopOfflineSpeech() { playbackRevision++; cancelPlayback?.(); void Speech.stop(); }
export async function speakOffline(text: string, language: string): Promise<boolean> {
  stopOfflineSpeech();
  const revision = playbackRevision;
  const status = await offlineSpeechStatus(language, language);
  if (revision !== playbackRevision) return false;
  if (!status.voice) return false;
  return new Promise(resolve => {
    let finished = false;
    const finish = (success: boolean) => { if (finished) return; finished = true; clearTimeout(timer); cancelPlayback = null; resolve(success); };
    const timer = setTimeout(() => { void Speech.stop(); finish(false); }, 60000);
    cancelPlayback = () => { void Speech.stop(); finish(false); };
    Speech.speak(text, { language: status.voice!.language, voice: status.voice!.identifier, rate: 0.92, onDone: () => finish(true), onStopped: () => finish(false), onError: () => finish(false) });
  });
}
