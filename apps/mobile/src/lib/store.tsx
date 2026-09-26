import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

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
  partner: string | null;
};

type Store = State & {
  ready: boolean;
  saveProfile: (p: Profile) => void;
  addExpense: (e: Omit<Expense, 'id' | 'at'> & { at?: string }) => void;
  removeExpense: (id: string) => void;
  setPartner: (lang: string) => void;
  clearAll: () => Promise<void>;
};

export const accountStorageKey = (accountId: string) => `roamie.v2.auth.tesserix.app.${encodeURIComponent(accountId)}`;
const EMPTY: State = { profile: null, expenses: [], partner: null };
const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children, accountId }: { children: ReactNode; accountId: string }) {
  const key = accountStorageKey(accountId);
  const [state, setState] = useState<State>(EMPTY);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(key)
      .then((raw) => raw && mounted && setState({ ...EMPTY, ...JSON.parse(raw) }))
      .catch(() => {})
      .finally(() => { if (mounted) setReady(true); });
    return () => { mounted = false; };
  }, [key]);

  useEffect(() => {
    if (ready) AsyncStorage.setItem(key, JSON.stringify(state)).catch(() => {});
  }, [ready, state, key]);

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
  const setPartner = useCallback((partner: string) => setState((s) => ({ ...s, partner })), []);
  const clearAll = useCallback(async () => {
    await AsyncStorage.removeItem(key);
    setState(EMPTY);
  }, [key]);

  const value = useMemo(
    () => ({ ...state, ready, saveProfile, addExpense, removeExpense, setPartner, clearAll }),
    [state, ready, saveProfile, addExpense, removeExpense, setPartner, clearAll],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const store = useContext(Ctx);
  if (!store) throw new Error('useStore outside StoreProvider');
  return store;
}
