import * as Location from 'expo-location';
import { useIsFocused } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

export type Here = {
  status: 'loading' | 'ready' | 'denied' | 'error';
  coords: { lat: number; lng: number } | null;
  country: string | null;
  checkedAt: number | null;
  refresh: () => void;
};

export function useHere(): Here {
  const [state, setState] = useState<Omit<Here, 'refresh'>>({
    status: 'loading', coords: null, country: null, checkedAt: null,
  });
  const [tick, setTick] = useState(0);
  const focused = useIsFocused();
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!focused) return;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') refresh();
    });
    return () => subscription.remove();
  }, [focused, refresh]);

  useEffect(() => {
    if (!focused) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const locate = async () => {
      setState({ status: 'loading', coords: null, country: null, checkedAt: null });
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) return { status: 'denied' as const, coords: null, country: null, checkedAt: null };
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const place = await Location.reverseGeocodeAsync(pos.coords).catch(() => []);
      return { status: 'ready' as const, coords, country: place[0]?.isoCountryCode?.toUpperCase() ?? null, checkedAt: Date.now() };
    };
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Location timed out')), 15000);
    });
    Promise.race([locate(), timeout])
      .then((next) => { if (live) setState(next); })
      .catch(() => { if (live) setState({ status: 'error', coords: null, country: null, checkedAt: null }); })
      .finally(() => clearTimeout(timer));
    return () => { live = false; clearTimeout(timer); };
  }, [focused, tick]);

  return { ...state, refresh };
}

// Country from location only if permission was already granted, so Talk never prompts on launch.
export function useQuietCountry(): string | null {
  const [country, setCountry] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      const perm = await Location.getForegroundPermissionsAsync();
      if (!perm.granted) return;
      const pos =
        (await Location.getLastKnownPositionAsync()) ??
        (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }));
      if (!pos) return;
      const place = await Location.reverseGeocodeAsync(pos.coords).catch(() => []);
      if (live && place[0]?.isoCountryCode) setCountry(place[0].isoCountryCode);
    })().catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return country;
}
