import { getLocales } from 'expo-localization';
import * as Speech from 'expo-speech';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { useSyncExternalStore } from 'react';
import { synthesizeSpeech, type VoiceGender } from './api';
import type { VoicePreference } from './accessibility';

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

export function speak(text: string, lang: string, key = text, gender?: VoiceGender): Promise<boolean> {
  stopSpeaking();
  const revision = speechRevision;
  return new Promise(resolve => {
    let finished = false;
    let cleanup = () => {};
    const done = (completed: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      try { cleanup(); } catch { completed = false; }
      if (revision === speechRevision) { finishSpeech = null; setCurrent(null); }
      resolve(completed);
    };
    let timeout = setTimeout(() => { stopSpeaking(); done(false); }, 60000);
    finishSpeech = done;
    const play = async () => {
      voices ??= Speech.getAvailableVoicesAsync().catch(() => []);
      const region = lang === getLocales()[0]?.languageCode ? (getLocales()[0]?.regionCode ?? undefined) : undefined;
      const voice = pickVoice(await voices, lang, region, gender);
      if (finished || revision !== speechRevision) return;
      setCurrent(key);
      if (!voice) {
        clearTimeout(timeout);
        timeout = setTimeout(() => { stopSpeaking(); done(false); }, 120000);
        const controller = new AbortController();
        cleanup = () => controller.abort();
        const audio = await synthesizeSpeech(text, lang, gender, controller.signal);
        if (finished || revision !== speechRevision) return;
        const file = new File(Paths.cache, `roamie-speech-${Date.now()}-${revision}.wav`);
        cleanup = () => { controller.abort(); if (file.exists) file.delete(); };
        file.write(audio.data, { encoding: 'base64' });
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
        if (finished || revision !== speechRevision) { cleanup(); return; }
        const player = createAudioPlayer(file.uri);
        const subscription = player.addListener('playbackStatusUpdate', status => {
          if (status.didJustFinish) done(true);
        });
        cleanup = () => {
          controller.abort();
          subscription.remove();
          player.pause();
          player.remove();
          if (file.exists) file.delete();
        };
        player.play();
        return;
      }
      Speech.speak(text, { language: lang, voice, rate: RATE, onDone: () => done(true), onStopped: () => done(false), onError: () => done(false) });
    };
    void play().catch(() => done(false));
  });
}

export function stopSpeaking() {
  speechRevision++;
  finishSpeech?.(false);
  finishSpeech = null;
  void Promise.resolve(Speech.stop()).catch(() => {});
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
