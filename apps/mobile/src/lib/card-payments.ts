import { Platform, Settings } from 'react-native';

import { toHome, toMinor } from './money';
import type { Expense } from './store';

// Written by the LogCardPayment App Intent that an iOS Shortcuts "Transaction" automation runs after each Apple Pay payment.
export const PAYMENTS_KEY = 'roamie.cardPayments';

export type CardPayment = { id: string; merchant: string; amount: string; currency: string; date: string; at: string };
type TripDates = { startDate: string; endDate: string };

export function capturePayments(payments: CardPayment[], trips: TripDates[], home: string, rates: Record<string, number> | null) {
  const add: Omit<Expense, 'id'>[] = [];
  const done: string[] = [];
  for (const p of payments) {
    const currency = typeof p.currency === 'string' ? p.currency.toUpperCase() : '';
    const minor = typeof p.amount === 'string' && /^[A-Z]{3}$/.test(currency) ? toMinor(p.amount, currency) : null;
    const onTrip = typeof p.date === 'string' && trips.some(t => t.startDate <= p.date && p.date <= t.endDate);
    if (!minor || !onTrip) {
      done.push(p.id);
      continue;
    }
    const homeMinor = currency === home ? minor : rates ? toHome(minor, currency, home, rates) : null;
    if (homeMinor === null) continue;
    add.push({ amountMinor: minor, currency, homeMinor, category: 'other', note: String(p.merchant ?? '').trim().slice(0, 120), at: p.at });
    done.push(p.id);
  }
  return { add, done };
}

export function pendingPayments(): CardPayment[] {
  if (Platform.OS !== 'ios') return [];
  const stored = Settings.get(PAYMENTS_KEY);
  return Array.isArray(stored) ? stored.filter(p => p && typeof p.id === 'string') : [];
}

export function forgetPayments(ids: string[]) {
  if (!ids.length) return;
  Settings.set({ [PAYMENTS_KEY]: pendingPayments().filter(p => !ids.includes(p.id)) });
}
