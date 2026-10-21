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

export type CardPaymentExpense = Omit<Expense, 'id'> & { paymentId: string };

type State = {
  profile: Profile | null;
  expenses: Expense[];
  talkPartner: string | null;
  talkLanguage: string | null;
  talkPair: { mine: string; partner: string } | null;
  cardPaymentIds: string[];
};

type Store = State & {
  ready: boolean;
  error: string | null;
  retry: () => void;
  saveProfile: (p: Profile) => void;
  addExpense: (e: Omit<Expense, 'id' | 'at'> & { at?: string }) => void;
  addCardPayments: (payments: CardPaymentExpense[]) => void;
  savedCardPaymentIds: string[];
  removeExpense: (id: string) => void;
  setTalkPartner: (lang: string | null) => void;
  setTalkLanguage: (lang: string | null) => void;
  setTalkPair: (pair: State['talkPair']) => void;
  clearAll: () => Promise<void>;
};

export const accountStorageKey = (accountId: string) => `roamie.v2.auth.tesserix.app.${encodeURIComponent(accountId)}`;
const EMPTY: State = { profile: null, expenses: [], talkPartner: null, talkLanguage: null, talkPair: null, cardPaymentIds: [] };
const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children, accountId }: { children: ReactNode; accountId: string }) {
  const key = accountStorageKey(accountId);
  const [state, setState] = useState<State>(EMPTY);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedCardPaymentIds, setSavedCardPaymentIds] = useState<string[]>([]);
  const [attempt, setAttempt] = useState(0), [saveAttempt, setSaveAttempt] = useState(0);
  const writes = useRef(Promise.resolve());

  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(key)
      .then(raw => {
        const saved: State = raw ? JSON.parse(raw) : EMPTY;
        if (!saved || !Array.isArray(saved.expenses) || saved.expenses.some(e => !e || typeof e.id !== 'string' || typeof e.note !== 'string') || (saved.profile !== null && (typeof saved.profile !== 'object' || !saved.profile || typeof saved.profile.homeCurrency !== 'string' || typeof saved.profile.language !== 'string' || !Number.isSafeInteger(saved.profile.budgetMinor) || saved.profile.budgetMinor < 0))) throw new Error('Invalid wallet');
        if ([saved.talkLanguage, saved.talkPartner].some(lang => lang != null && (typeof lang !== 'string' || !/^[a-z]{2,3}$/.test(lang)))) throw new Error('Invalid language');
        if (saved.talkPair != null && (typeof saved.talkPair !== 'object' || [saved.talkPair.mine, saved.talkPair.partner].some(lang => typeof lang !== 'string' || !/^[a-z]{2,3}$/.test(lang)) || saved.talkPair.mine === saved.talkPair.partner)) throw new Error('Invalid conversation languages');
        if (saved.cardPaymentIds != null && (!Array.isArray(saved.cardPaymentIds) || saved.cardPaymentIds.some(id => typeof id !== 'string' || !id))) throw new Error('Invalid payment history');
        if (mounted) { setState({ ...EMPTY, ...saved, cardPaymentIds: saved.cardPaymentIds ?? [] }); setSavedCardPaymentIds(saved.cardPaymentIds ?? []); setReady(true); }
      })
      .catch(() => { if (mounted) setError('We could not open your saved wallet. Your data has not been changed.'); });
    return () => { mounted = false; };
  }, [key, attempt]);

  useEffect(() => {
    if (!ready) return;
    let mounted = true;
    const operation = writes.current.then(() => AsyncStorage.setItem(key, JSON.stringify(state)));
    writes.current = operation.catch(() => {});
    operation.then(() => { if (mounted) { setError(null); setSavedCardPaymentIds(state.cardPaymentIds); } }).catch(() => { if (mounted) setError('Your latest wallet changes have not been saved. Keep Roamie open and try again.'); });
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
  const addCardPayments = useCallback((payments: CardPaymentExpense[]) => {
    setState(previous => {
      const ids = new Set(previous.cardPaymentIds);
      const added: Expense[] = [];
      for (const { paymentId, ...expense } of payments) {
        if (ids.has(paymentId)) continue;
        ids.add(paymentId);
        added.push({ ...expense, id: `card:${paymentId}` });
      }
      return added.length ? { ...previous, expenses: [...added, ...previous.expenses], cardPaymentIds: [...ids] } : previous;
    });
  }, []);
  const setTalkPartner = useCallback((talkPartner: string | null) => setState((s) => ({ ...s, talkPartner })), []);
  const setTalkLanguage = useCallback((talkLanguage: string | null) => setState((s) => ({ ...s, talkLanguage })), []);
  const setTalkPair = useCallback((talkPair: State['talkPair']) => setState((s) => ({ ...s, talkPair })), []);
  const clearAll = useCallback(async () => {
    await writes.current;
    await AsyncStorage.removeItem(key);
    setState(EMPTY);
    setSavedCardPaymentIds([]);
  }, [key]);

  const value = useMemo(
    () => ({ ...state, ready, error, retry, saveProfile, addExpense, addCardPayments, savedCardPaymentIds, removeExpense, setTalkPartner, setTalkLanguage, setTalkPair, clearAll }),
    [state, ready, error, retry, saveProfile, addExpense, addCardPayments, savedCardPaymentIds, removeExpense, setTalkPartner, setTalkLanguage, setTalkPair, clearAll],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const store = useContext(Ctx);
  if (!store) throw new Error('useStore outside StoreProvider');
  return store;
}
