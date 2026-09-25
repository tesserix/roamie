import { getLocales } from 'expo-localization';
import * as Location from 'expo-location';
import { useIsFocused } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

export type Here = {
  status: 'loading' | 'ready' | 'denied' | 'error';
  coords: { lat: number; lng: number } | null;
  country: string | null;
  refresh: () => void;
};

const deviceRegion = () => getLocales()[0]?.regionCode ?? null;

// Asks for location the first time the screen is shown, not when the tab bar mounts it.
export function useHere(): Here {
  const [state, setState] = useState<Omit<Here, 'refresh'>>({ status: 'loading', coords: null, country: null });
  const [tick, setTick] = useState(0);
  const focused = useIsFocused();
  const [seen, setSeen] = useState(false);
  if (focused && !seen) setSeen(true);

  useEffect(() => {
    if (!seen) return;
    let live = true;
    (async () => {
      setState((s) => ({ ...s, status: 'loading' }));
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        if (live) setState({ status: 'denied', coords: null, country: deviceRegion() });
        return;
      }
      try {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const place = await Location.reverseGeocodeAsync({ latitude: coords.lat, longitude: coords.lng }).catch(() => []);
        if (live) setState({ status: 'ready', coords, country: place[0]?.isoCountryCode ?? deviceRegion() });
      } catch {
        if (live) setState({ status: 'error', coords: null, country: deviceRegion() });
      }
    })();
    return () => {
      live = false;
    };
  }, [seen, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
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
