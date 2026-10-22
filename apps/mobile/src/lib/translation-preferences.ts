import { useSyncExternalStore } from 'react';

export type TranslationMode = 'auto' | 'offline' | 'cloud';
export type SpeechModel = 'base' | 'small';
type Preferences = { mode: TranslationMode; speechModel: SpeechModel; ready: boolean; error?: string };
let state: Preferences = { mode: 'auto', speechModel: 'base', ready: false };
let restoring: Promise<void> | undefined;
let writing = Promise.resolve();
const listeners = new Set<() => void>();
const KEY = 'roamie:translation-preferences:v1';

function update(next: Preferences) { state = next; listeners.forEach(listener => listener()); }
export const translationPreferences = () => state;
export const subscribeTranslationPreferences = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function restoreTranslationPreferences(): Promise<void> {
  restoring ??= (async () => {
    try {
      const storage = (await import('@react-native-async-storage/async-storage')).default;
      const raw = await storage.getItem(KEY);
      const saved = raw ? JSON.parse(raw) as Partial<Preferences> : {};
      update({ mode: ['auto', 'offline', 'cloud'].includes(saved.mode ?? '') ? saved.mode! : 'auto', speechModel: saved.speechModel === 'small' ? 'small' : 'base', ready: true });
    } catch { update({ ...state, mode: 'offline', ready: true, error: 'Could not load translation preferences. Offline mode is active.' }); }
  })();
  return restoring;
}

export async function saveTranslationPreferences(patch: Partial<Pick<Preferences, 'mode' | 'speechModel'>>) {
  await restoreTranslationPreferences();
  update({ ...state, ...patch, error: undefined });
  const saved = JSON.stringify({ mode: state.mode, speechModel: state.speechModel });
  writing = writing.catch(() => {}).then(async () => {
    const storage = (await import('@react-native-async-storage/async-storage')).default;
    await storage.setItem(KEY, saved);
  });
  try { await writing; }
  catch { update({ ...state, error: 'This preference could not be saved. Please try again.' }); }
}

export function useTranslationPreferences() {
  return useSyncExternalStore(subscribeTranslationPreferences, translationPreferences, translationPreferences);
}
