import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';

type Preferences = { quiet: boolean; highContrast: boolean; vibration: boolean };
const defaults: Preferences = { quiet: false, highContrast: false, vibration: false };
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
      if (live) setPreferences({ quiet: saved?.quiet === true, highContrast: saved?.highContrast === true, vibration: saved?.vibration === true });
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
