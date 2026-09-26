import { restoreChosenPlan } from './trip-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { tripStorageKey, createTrip, updateStop, type Trip } from './trips';

type TripStore = { trips: Trip[]; ready: boolean; error: string | null; save: (trip: Trip) => Promise<void>; remove: (id: string) => Promise<void>; reload: () => void; accountId: string };
const Context = createContext<TripStore | null>(null);
export function TripsProvider({ children, accountId }: { children: ReactNode; accountId: string }) {
  const [trips, setTrips] = useState<Trip[]>([]), [ready, setReady] = useState(false), [error, setError] = useState<string | null>(null), [attempt, setAttempt] = useState(0);
  const current = useRef<Trip[]>([]), writes = useRef(Promise.resolve()), loaded = useRef(false);
  const key = tripStorageKey(accountId);
  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(key).then(raw => {
      const data: unknown = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(data) || data.length > 20 || data.some(t => !t || typeof t.id !== 'string' || !Array.isArray(t.days) || !Array.isArray(t.photos))) throw new Error('Invalid saved trips');
      for (const trip of data) {
        const blank = createTrip(trip);
        if (trip.managerPlan) trip.managerPlan = restoreChosenPlan(trip.managerPlan, trip);
        if (typeof trip.notice !== 'string' || typeof trip.updatedAt !== 'string' || trip.days.length !== blank.days.length || trip.photos.length > 15) throw new Error('Invalid saved trip');
        for (const [index, day] of trip.days.entries()) {
          if (day.date !== blank.days[index].date || !Array.isArray(day.stops)) throw new Error('Invalid saved day');
          let checked = blank;
          for (const stop of day.stops) {
            if (typeof stop.id !== 'string' || !Array.isArray(stop.transport) || !['sight', 'lunch', 'dinner'].includes(stop.kind)) throw new Error('Invalid saved stop');
            checked = updateStop(checked, index, stop);
          }
        }
        if (trip.photos.some((photo: Trip['photos'][number]) => !photo || typeof photo.id !== 'string' || typeof photo.uri !== 'string' || typeof photo.caption !== 'string' || !Number.isFinite(photo.creationTime) || !(photo.width > 0 && photo.height > 0))) throw new Error('Invalid saved photo');
      }
      if (live) { current.current = data; loaded.current = true; setTrips(data); setReady(true); setError(null); }
    }).catch(() => { if (live) setError('We could not open your saved trips. Retry without changing them.'); });
    return () => { live = false; loaded.current = false; };
  }, [key, attempt]);
  function change(update: (items: Trip[]) => Trip[]) {
    const operation = writes.current.then(async () => {
      if (!loaded.current) throw new Error('Wait for your trips to load.');
      const next = update(current.current);
      if (next.length > 20) throw new Error('You can keep 20 trips on this phone.');
      await AsyncStorage.setItem(key, JSON.stringify(next));
      current.current = next; setTrips(next);
    });
    writes.current = operation.catch(() => {});
    return operation;
  }
  return <Context.Provider value={{ trips, ready, error, accountId, reload: () => setAttempt(n => n + 1), save: trip => change(items => [trip, ...items.filter(t => t.id !== trip.id)]), remove: id => change(items => items.filter(t => t.id !== id)) }}>{children}</Context.Provider>;
}
export function useTrips() { const value = useContext(Context); if (!value) throw new Error('TripsProvider is required'); return value; }
