import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

export type Diet = 'none' | 'vegetarian' | 'vegan' | 'jain' | 'pescatarian' | 'halal' | 'kosher';

export type Profile = {
  language: string;
  homeCurrency: string;
  budgetMinor: number;
  diet: Diet;
};

export type Expense = {
  id: string;
  amountMinor: number;
  currency: string;
  homeMinor: number;
  category: string;
  note: string;
  at: string;
};

type State = {
  profile: Profile | null;
  expenses: Expense[];
  talkPartner: string | null;
  talkLanguage: string | null;
};

type Store = State & {
  ready: boolean;
  error: string | null;
  retry: () => void;
  saveProfile: (p: Profile) => void;
  addExpense: (e: Omit<Expense, 'id' | 'at'> & { at?: string }) => void;
  removeExpense: (id: string) => void;
  setTalkPartner: (lang: string | null) => void;
  setTalkLanguage: (lang: string | null) => void;
  clearAll: () => Promise<void>;
};

export const accountStorageKey = (accountId: string) => `roamie.v2.auth.tesserix.app.${encodeURIComponent(accountId)}`;
const EMPTY: State = { profile: null, expenses: [], talkPartner: null, talkLanguage: null };
const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children, accountId }: { children: ReactNode; accountId: string }) {
  const key = accountStorageKey(accountId);
  const [state, setState] = useState<State>(EMPTY);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0), [saveAttempt, setSaveAttempt] = useState(0);
  const writes = useRef(Promise.resolve());

  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(key)
      .then(raw => {
        const saved: State = raw ? JSON.parse(raw) : EMPTY;
        if (!saved || !Array.isArray(saved.expenses) || saved.expenses.some(e => !e || typeof e.id !== 'string' || typeof e.note !== 'string') || (saved.profile !== null && (typeof saved.profile !== 'object' || !saved.profile || typeof saved.profile.homeCurrency !== 'string' || typeof saved.profile.language !== 'string' || !Number.isSafeInteger(saved.profile.budgetMinor) || saved.profile.budgetMinor < 0))) throw new Error('Invalid wallet');
        if ([saved.talkLanguage, saved.talkPartner].some(lang => lang != null && (typeof lang !== 'string' || !/^[a-z]{2,3}$/.test(lang)))) throw new Error('Invalid language');
        if (mounted) { setState({ ...EMPTY, ...saved }); setReady(true); }
      })
      .catch(() => { if (mounted) setError('We could not open your saved wallet. Your data has not been changed.'); });
    return () => { mounted = false; };
  }, [key, attempt]);

  useEffect(() => {
    if (!ready) return;
    let mounted = true;
    const operation = writes.current.then(() => AsyncStorage.setItem(key, JSON.stringify(state)));
    writes.current = operation.catch(() => {});
    operation.then(() => { if (mounted) setError(null); }).catch(() => { if (mounted) setError('Your latest wallet changes have not been saved. Keep Roamie open and try again.'); });
    return () => { mounted = false; };
  }, [ready, state, key, saveAttempt]);

  const retry = useCallback(() => {
    setError(null);
    if (ready) setSaveAttempt(value => value + 1);
    else setAttempt(value => value + 1);
  }, [ready]);

  const saveProfile = useCallback((profile: Profile) => setState((s) => ({ ...s, profile })), []);
  const addExpense = useCallback(
    (e: Omit<Expense, 'id' | 'at'> & { at?: string }) =>
      setState((s) => ({
        ...s,
        expenses: [{ ...e, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: e.at ?? new Date().toISOString() }, ...s.expenses],
      })),
    [],
  );
  const removeExpense = useCallback(
    (id: string) => setState((s) => ({ ...s, expenses: s.expenses.filter((e) => e.id !== id) })),
    [],
  );
  const setTalkPartner = useCallback((talkPartner: string | null) => setState((s) => ({ ...s, talkPartner })), []);
  const setTalkLanguage = useCallback((talkLanguage: string | null) => setState((s) => ({ ...s, talkLanguage })), []);
  const clearAll = useCallback(async () => {
    await writes.current;
    await AsyncStorage.removeItem(key);
    setState(EMPTY);
  }, [key]);

  const value = useMemo(
    () => ({ ...state, ready, error, retry, saveProfile, addExpense, removeExpense, setTalkPartner, setTalkLanguage, clearAll }),
    [state, ready, error, retry, saveProfile, addExpense, removeExpense, setTalkPartner, setTalkLanguage, clearAll],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const store = useContext(Ctx);
  if (!store) throw new Error('useStore outside StoreProvider');
  return store;
}
