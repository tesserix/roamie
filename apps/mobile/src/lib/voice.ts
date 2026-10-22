import { getLocales } from 'expo-localization';
import * as Speech from 'expo-speech';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { useSyncExternalStore } from 'react';
import { synthesizeSpeech, type VoiceGender } from './api';
import type { VoicePreference } from './accessibility';
import { offlineNative } from '../../modules/roamie-offline';
import { restoreTranslationPreferences, translationPreferences } from './translation-preferences';

// Speech slightly under normal pace is far easier to follow in a second language.
const RATE = 0.92;

// expo-speech exposes no gender, so known Apple voice names stand in; unknown voices still play.
const FEMALE = new Set(['samantha', 'ava', 'allison', 'susan', 'zoe', 'nicky', 'serena', 'kate', 'stephanie', 'martha', 'karen', 'catherine', 'moira', 'tessa', 'fiona', 'veena', 'isha', 'kanya', 'narisa', 'kyoko', 'tingting', 'meijia', 'sinji', 'lili', 'yuna', 'amelie', 'audrey', 'aurelie', 'marie', 'anna', 'petra', 'helena', 'monica', 'paulina', 'marisol', 'alice', 'federica', 'paola', 'luciana', 'joana', 'catarina', 'lekha', 'kiyara', 'damayanti', 'linh', 'milena', 'katya', 'yelda', 'claire', 'ellen', 'alva', 'klara', 'zosia', 'ewa', 'carmit', 'melina', 'amira', 'sara', 'nora', 'satu', 'mariska', 'ioana', 'zuzana', 'laura', 'lana']);
const MALE = new Set(['daniel', 'oliver', 'arthur', 'jamie', 'evan', 'tom', 'alex', 'aaron', 'nathan', 'fred', 'lee', 'gordon', 'rishi', 'otoya', 'hattori', 'minsu', 'thomas', 'nicolas', 'markus', 'yannick', 'martin', 'jorge', 'juan', 'diego', 'carlos', 'luca', 'felipe', 'yuri', 'maged', 'cem', 'xander', 'oskar', 'krzysztof', 'nikos', 'reed']);

export const playbackVoice = (preference: VoicePreference, heard?: VoiceGender) => preference === 'match' ? heard : preference;

function genderOf(v: Speech.Voice): VoiceGender | undefined {
  const id = v.identifier.toLowerCase();
  if (/(^|[._-])female([._-]|$)/.test(id)) return 'female';
  if (/(^|[._-])male([._-]|$)/.test(id)) return 'male';
  const name = (id.split('.').pop() ?? '').normalize('NFD').replace(/[^a-z]/g, '');
  return FEMALE.has(name) ? 'female' : MALE.has(name) ? 'male' : undefined;
}

function score(v: Speech.Voice, region?: string, gender?: VoiceGender) {
  const id = v.identifier.toLowerCase();
  if (id.includes('eloquence')) return 0;
  const quality = id.includes('premium') ? 3 : v.quality === Speech.VoiceQuality.Enhanced ? 2 : 1;
  return quality + (region && v.language.toUpperCase().endsWith(`-${region}`) ? 1.5 : 0) + (gender && genderOf(v) === gender ? 10 : 0);
}

export function pickVoice(voices: Speech.Voice[], lang: string, region?: string, gender?: VoiceGender): string | undefined {
  let best: Speech.Voice | undefined;
  for (const v of voices) {
    if (v.language.toLowerCase().split(/[-_]/)[0] !== lang) continue;
    if (!best || score(v, region, gender) > score(best, region, gender)) best = v;
  }
  return best?.identifier;
}

let voices: Promise<Speech.Voice[]> | null = null;
let current: string | null = null;
const listeners = new Set<() => void>();

function setCurrent(key: string | null) {
  current = key;
  listeners.forEach((l) => l());
}

let speechRevision = 0;
let finishSpeech: ((completed: boolean) => void) | null = null;
let stopping = Promise.resolve();

async function within<T>(operation: Promise<T>, milliseconds: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation.catch(() => fallback), new Promise<T>(resolve => { timer = setTimeout(() => resolve(fallback), milliseconds); })]);
  } finally { clearTimeout(timer); }
}

export function speak(text: string, lang: string, key = text, gender?: VoiceGender, offlineOnly = false): Promise<boolean> {
  stopSpeaking();
  const revision = speechRevision;
  const stopped = stopping;
  return new Promise(resolve => {
    let finished = false;
    let cleanup = () => {};
    const done = (completed: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      clearTimeout(startTimer);
      try { cleanup(); } catch { completed = false; }
      if (revision === speechRevision) { finishSpeech = null; setCurrent(null); }
      resolve(completed);
    };
    let timeout = setTimeout(() => { stopSpeaking(); done(false); }, 8000);
    let startTimer: ReturnType<typeof setTimeout> | undefined;
    const playing = () => {
      clearTimeout(startTimer);
      clearTimeout(timeout);
      timeout = setTimeout(() => { stopSpeaking(); done(false); }, Math.min(120000, Math.max(15000, text.length * 400 + 5000)));
    };
    finishSpeech = done;
    let generated = false;
    let nativeQueued = false;
    const playGenerated = async () => {
      if (finished || revision !== speechRevision || generated) return;
      generated = true;
      clearTimeout(startTimer);
      if (nativeQueued) await Promise.resolve(Speech.stop()).catch(() => {});
      if (finished || revision !== speechRevision) return;
      if (offlineOnly || translationPreferences().mode === 'offline') { done(false); return; }
      if (offlineNative()) {
        const network = await within(import('expo-network').then(module => module.getNetworkStateAsync()), 100, null);
        if (finished || revision !== speechRevision) return;
        if (network?.isConnected === false || network?.isInternetReachable === false) { done(false); return; }
      }
      const controller = new AbortController();
      cleanup = () => controller.abort();
      if (offlineOnly || translationPreferences().mode === 'offline') { done(false); return; }
      const audio = await synthesizeSpeech(text, lang, gender, controller.signal);
      if (finished || revision !== speechRevision) return;
      const file = new File(Paths.cache, `roamie-speech-${Date.now()}-${revision}.wav`);
      cleanup = () => { controller.abort(); if (file.exists) file.delete(); };
      file.write(audio.data, { encoding: 'base64' });
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      if (finished || revision !== speechRevision) { cleanup(); return; }
      const player = createAudioPlayer(file.uri);
      let started = false;
      const subscription = player.addListener('playbackStatusUpdate', status => {
        if (!started && status.playing) { started = true; playing(); }
        if (status.didJustFinish) done(true);
      });
      cleanup = () => {
        controller.abort();
        subscription.remove();
        player.pause();
        player.remove();
        if (file.exists) file.delete();
      };
      startTimer = setTimeout(() => { stopSpeaking(); done(false); }, 2000);
      player.play();
    };
    const play = async () => {
      await stopped;
      if (finished || revision !== speechRevision) return;
      if (offlineNative() && !await within(restoreTranslationPreferences().then(() => true), 300, false)) { done(false); return; }
      voices ??= Speech.getAvailableVoicesAsync().catch(() => []);
      const region = lang === getLocales()[0]?.languageCode ? (getLocales()[0]?.regionCode ?? undefined) : undefined;
      let candidates = await within(voices, 500, []);
      const native = offlineNative();
      const forcedOffline = offlineOnly || translationPreferences().mode === 'offline';
      const network = native && !forcedOffline ? await within(import('expo-network').then(module => module.getNetworkStateAsync()), 100, null) : null;
      const disconnected = network?.isConnected === false || network?.isInternetReachable === false;
      if (native && (forcedOffline || disconnected)) {
        const installed = new Set((await within(native.offlineVoices(), 500, [])).map(voice => voice.identifier));
        candidates = candidates.filter(voice => installed.has(voice.identifier));
      } else if (!native && forcedOffline) { done(false); return; }
      const voice = pickVoice(candidates, lang, region, gender);
      if (finished || revision !== speechRevision) return;
      setCurrent(key);
      if (!voice) {
        await playGenerated();
        return;
      }
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      if (finished || revision !== speechRevision) return;
      nativeQueued = true;
      startTimer = setTimeout(() => { void playGenerated().catch(() => done(false)); }, 2000);
      Speech.speak(text, { language: lang, voice, rate: RATE,
        onStart: () => { if (!generated && !finished) playing(); },
        onDone: () => { if (!generated) done(true); },
        onStopped: () => { if (!generated) done(false); },
        onError: () => { void playGenerated().catch(() => done(false)); },
      });
    };
    void play().catch(() => done(false));
  });
}

export function stopSpeaking() {
  speechRevision++;
  finishSpeech?.(false);
  finishSpeech = null;
  stopping = Promise.resolve(Speech.stop()).catch(() => {});
  setCurrent(null);
}

/** True while the utterance started with `key` is playing. */
export function useSpeaking(key: string) {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current === key,
  );
}
