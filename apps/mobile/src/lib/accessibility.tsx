import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, useColorScheme, useWindowDimensions } from 'react-native';

export type VoicePreference = 'match' | 'female' | 'male';
export const TEXT_SIZES = [
  { value: 'system', label: 'Phone settings', description: 'Follows your phone’s text size.', scale: null },
  { value: 'compact', label: 'Compact', description: 'Slightly smaller text with the same easy-to-tap controls.', scale: 0.9 },
  { value: 'normal', label: 'Normal', description: 'Roamie’s standard text size, independent of your phone’s text size.', scale: 1 },
  { value: 'large', label: 'Large', description: 'Larger text for easier reading.', scale: 1.2 },
] as const;
export const APPEARANCES = [
  { value: 'system', label: 'Phone' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const;
export type TextSize = typeof TEXT_SIZES[number]['value'];
type AppearancePreference = typeof APPEARANCES[number]['value'];
type Preferences = { quiet: boolean; highContrast: boolean; vibration: boolean; voice: VoicePreference; textSize: TextSize; appearance: AppearancePreference };
const defaults: Preferences = { quiet: false, highContrast: false, vibration: false, voice: 'match', textSize: 'system', appearance: 'system' };
const VOICES: VoicePreference[] = ['match', 'female', 'male'];
const KEY = 'roamie.accessibility.v1';
const Context = createContext({ ...defaults, screenReader: false, reducedMotion: false, ready: true, error: '', update: (_change: Partial<Preferences>) => {} });

export function AccessibilityProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState(defaults);
  const [ready, setReady] = useState(false), [error, setError] = useState('');
  const [screenReader, setScreenReader] = useState(false), [reducedMotion, setReducedMotion] = useState(false);
  const writes = useRef(Promise.resolve());
  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(KEY).then(raw => {
      const saved = raw ? JSON.parse(raw) : defaults;
      if (live) setPreferences({ quiet: saved?.quiet === true, highContrast: saved?.highContrast === true, vibration: saved?.vibration === true, voice: VOICES.includes(saved?.voice) ? saved.voice : 'match', textSize: TEXT_SIZES.some(size => size.value === saved?.textSize) ? saved.textSize : 'system', appearance: APPEARANCES.some(appearance => appearance.value === saved?.appearance) ? saved.appearance : 'system' });
    }).catch(() => { if (live) setError('Could not load your accessibility preferences.'); }).finally(() => { if (live) setReady(true); });
    Promise.resolve(AccessibilityInfo.isScreenReaderEnabled()).then(value => { if (live) setScreenReader(!!value); }).catch(() => {});
    Promise.resolve(AccessibilityInfo.isReduceMotionEnabled()).then(value => { if (live) setReducedMotion(!!value); }).catch(() => {});
    const reader = AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReader);
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    return () => { live = false; reader.remove(); motion.remove(); };
  }, []);
  useEffect(() => {
    if (!ready) return;
    let live = true;
    writes.current = writes.current.catch(() => {}).then(() => AsyncStorage.setItem(KEY, JSON.stringify(preferences)));
    writes.current.catch(() => { if (live) setError('Your choices work now, but could not be saved.'); });
    return () => { live = false; };
  }, [preferences, ready]);
  return <Context.Provider value={{ ...preferences, ready, error, screenReader, reducedMotion, update: change => setPreferences(previous => ({ ...previous, ...change })) }}>{children}</Context.Provider>;
}
export const useAccessibility = () => useContext(Context);
export function useAppColorScheme() {
  const phoneScheme = useColorScheme();
  const { appearance } = useAccessibility();
  return appearance === 'system' ? phoneScheme : appearance;
}
export function useTextScale() {
  const { textSize } = useAccessibility();
  const { fontScale } = useWindowDimensions();
  return TEXT_SIZES.find(size => size.value === textSize)!.scale ?? fontScale;
}
