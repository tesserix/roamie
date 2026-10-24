import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { session } from './auth-client';
import type { Group } from './group-budget';
import { balanceNotice, balanceReminders, type BalanceNotice } from './balance-reminders';
import type { Trip } from './trips';
import type { DestinationCheck } from './trip-readiness';
import { weatherNotices, weatherReminders, type WeatherNotice } from './weather-reminders';
import { useTrips } from './trip-store';
import { buildTripReminders, DEFAULT_REMINDERS, type ReminderPreferences } from './trip-reminders';
import { activateReminderAccount, reconcileTripReminders, requestReminderAccess, stopTripReminders } from './reminder-notifications';

const Context = createContext<{ preferences: ReminderPreferences; ready: boolean; busy: boolean; error: string; count: number; update: (kind: keyof ReminderPreferences, enabled: boolean) => Promise<void>; retry: () => void; rememberWeather: (trip: Trip, checks: DestinationCheck[]) => Promise<void>; rememberGroup: (group: Group) => Promise<void>; forgetGroup: (id: string) => Promise<void>; groupIds: string[] } | null>(null);
export const useReminders = () => useContext(Context);
export function RemindersProvider({children}: {children: ReactNode}) {
  const {trips, ready: tripsReady, accountId} = useTrips();
  const [preferences, setPreferences] = useState<ReminderPreferences>(DEFAULT_REMINDERS);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [count, setCount] = useState(0), [revision, setRevision] = useState(0);
  const live = useRef(false), saving = useRef(false);
  const [forecasts, setForecasts] = useState<Record<string,WeatherNotice[]>>({});
  const forecastRef = useRef<Record<string,WeatherNotice[]>>({});
  const forecastWrites = useRef(Promise.resolve());
  const [balances, setBalances] = useState<Record<string,BalanceNotice>>({});
  const balanceRef = useRef<Record<string,BalanceNotice>>({}), balanceWrites = useRef(Promise.resolve());
  const key = `roamie.reminders.v1.${encodeURIComponent(accountId)}`;
  const retry = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    live.current = true;
    activateReminderAccount(accountId);
    Promise.all([AsyncStorage.getItem(key), AsyncStorage.getItem(key+'.weather'), AsyncStorage.getItem(key+'.balances')]).then(([raw, weatherRaw, balanceRaw]) => {
      const parsed = raw ? JSON.parse(raw) : DEFAULT_REMINDERS;
      if (!parsed || typeof parsed !== 'object' || Object.keys(DEFAULT_REMINDERS).some(kind => parsed[kind] !== undefined && typeof parsed[kind] !== 'boolean')) throw new Error('Invalid preferences');
      const weather = weatherRaw ? JSON.parse(weatherRaw) : {};
      if (!weather || typeof weather !== 'object' || Array.isArray(weather) || Object.keys(weather).length > 20) throw new Error('Invalid forecasts');
      const groups = balanceRaw ? JSON.parse(balanceRaw) : {};
      if (!groups || typeof groups !== 'object' || Array.isArray(groups) || Object.keys(groups).length > 20) throw new Error('Invalid balance reminders');
      if (live.current) { balanceRef.current = groups; setBalances(groups); forecastRef.current = weather; setForecasts(weather); setPreferences({...DEFAULT_REMINDERS, ...parsed}); setReady(true); }
    }).catch(() => { if (live.current) setError('Could not load reminder settings. Reopen Roamie to retry.'); });
    return () => { live.current = false; void stopTripReminders().catch(() => {}); };
  }, [accountId, key]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => { if (state === 'active') retry(); });
    const midnight = new Date(); midnight.setHours(24, 0, 0, 0);
    const timer = setTimeout(retry, Math.max(1, midnight.getTime() - Date.now()));
    return () => { listener.remove(); clearTimeout(timer); };
  }, [retry, revision]);
  useEffect(() => {
    if (!ready || !tripsReady) return;
    let current = true;
    const now = new Date();
    const plans = [...buildTripReminders(trips, preferences, now), ...(preferences.weather ? trips.flatMap(trip => weatherReminders(trip, forecasts[trip.id] ?? [], now)) : [])].sort((a,b) => a.date.getTime()-b.date.getTime()).slice(0,40);
    const financial = preferences.balances ? Object.values(balances).flatMap(notice => notice ? balanceReminders(notice,now) : []) : [];
    reconcileTripReminders(accountId, [...plans,...financial].sort((a,b)=>a.date.getTime()-b.date.getTime()).slice(0,60))
      .then(total => { if (current) { setCount(total); setError(''); } })
      .catch(() => { if (current) setError('Could not update reminders on this phone. Please retry.'); });
    return () => { current = false; };
  }, [accountId, trips, tripsReady, preferences, ready, revision, forecasts, balances]);
  const saveBalance = useCallback(async (id: string, notice: BalanceNotice | null) => {
    const operation = balanceWrites.current.catch(() => {}).then(async () => {
      if (!live.current || session.current()?.sub !== accountId) return;
      const next = Object.fromEntries(Object.entries(balanceRef.current).filter(([groupId, value]) => groupId !== id && value && Date.parse(value.checkedAt) > Date.now()-7*86400000).sort((a,b)=>Date.parse(b[1].checkedAt)-Date.parse(a[1].checkedAt)).slice(0,19));
      if (notice) next[id] = notice;
      await AsyncStorage.setItem(key+'.balances',JSON.stringify(next));
      if (live.current) { balanceRef.current=next; setBalances(next); }
    });
    balanceWrites.current=operation;
    try { await operation; } catch { if(live.current)setError('Could not save your balance reminders. Reopen the group to retry.'); }
  },[accountId,key]);
  const rememberGroup = useCallback(async (group: Group) => {
    if (preferences.balances) await saveBalance(group.id,balanceNotice(group,new Date()));
  },[preferences.balances,saveBalance]);
  const forgetGroup = useCallback((id: string) => saveBalance(id,null),[saveBalance]);
  async function rememberWeather(trip: Trip, checks: DestinationCheck[]) {
    if (!preferences.weather || !live.current) return;
    const operation = forecastWrites.current.catch(() => {}).then(async () => {
      if (!live.current) return;
      const next = Object.fromEntries(Object.entries(forecastRef.current).filter(([id]) => trips.some(item => item.id === id)));
      next[trip.id] = weatherNotices(trip, checks, new Date());
      await AsyncStorage.setItem(key+'.weather', JSON.stringify(next));
      if (live.current && session.current()?.sub === accountId) { forecastRef.current = next; setForecasts(next); }
    });
    forecastWrites.current = operation;
    try { await operation; } catch { if (live.current) setError('Weather was checked, but its notification could not be saved. Refresh your trip checks to retry.'); }
  }
  async function update(kind: keyof ReminderPreferences, enabled: boolean) {
    if (!ready || saving.current) return;
    saving.current = true; setBusy(true); setError('');
    try {
      if (enabled && !await requestReminderAccess()) throw new Error('Notifications are off for Roamie. Enable them in your phone settings to receive reminders.');
      if (!live.current) return;
      const next = {...preferences, [kind]: enabled};
      await AsyncStorage.setItem(key, JSON.stringify(next));
      if (live.current) setPreferences(next);
    } catch (cause) { if (live.current) setError(cause instanceof Error ? cause.message : 'Could not save reminder settings. Please retry.'); }
    finally { saving.current = false; if (live.current) setBusy(false); }
  }
  return <Context.Provider value={{preferences,ready,busy,error,count,update,retry,rememberWeather,rememberGroup,forgetGroup,groupIds:Object.keys(balances)}}>{children}</Context.Provider>;
}
