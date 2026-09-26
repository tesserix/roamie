import { getLocales } from 'expo-localization';
import * as Speech from 'expo-speech';
import { useSyncExternalStore } from 'react';

// Speech slightly under normal pace is far easier to follow in a second language.
const RATE = 0.92;

function score(v: Speech.Voice, region?: string) {
  const id = v.identifier.toLowerCase();
  if (id.includes('eloquence')) return 0;
  const quality = id.includes('premium') ? 3 : v.quality === Speech.VoiceQuality.Enhanced ? 2 : 1;
  return quality + (region && v.language.toUpperCase().endsWith(`-${region}`) ? 1.5 : 0);
}

export function pickVoice(voices: Speech.Voice[], lang: string, region?: string): string | undefined {
  let best: Speech.Voice | undefined;
  for (const v of voices) {
    if (v.language.toLowerCase().split(/[-_]/)[0] !== lang) continue;
    if (!best || score(v, region) > score(best, region)) best = v;
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

export function speak(text: string, lang: string, key = text): Promise<boolean> {
  stopSpeaking();
  const revision = speechRevision;
  return new Promise(resolve => {
    let finished = false;
    const done = (completed: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      if (revision === speechRevision) { finishSpeech = null; setCurrent(null); }
      resolve(completed);
    };
    const timeout = setTimeout(() => { stopSpeaking(); done(false); }, 60000);
    finishSpeech = done;
    const play = async () => {
      voices ??= Speech.getAvailableVoicesAsync().catch(() => []);
      const region = lang === getLocales()[0]?.languageCode ? (getLocales()[0]?.regionCode ?? undefined) : undefined;
      const voice = pickVoice(await voices, lang, region);
      if (finished || revision !== speechRevision) return;
      setCurrent(key);
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
