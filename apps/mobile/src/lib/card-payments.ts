import { Platform, Settings } from 'react-native';

import { toHome, toMinor } from './money';
import type { CardPaymentExpense } from './store';

// Written by the LogCardPayment App Intent that an iOS Shortcuts "Transaction" automation runs after each Apple Pay payment.
export const PAYMENTS_KEY = 'roamie.cardPayments';
export const PAYMENT_ACCOUNT_KEY = 'roamie.cardPaymentAccount';

export type CardPayment = { id: string; accountId?: string; merchant: string; amount: string; currency: string; date: string; at: string };
type TripDates = { startDate: string; endDate: string };

export function capturePayments(payments: CardPayment[], trips: TripDates[], home: string, rates: Record<string, number> | null) {
  const add: CardPaymentExpense[] = [];
  const done: string[] = [];
  const seen = new Set<string>();
  for (const p of payments) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    const currency = typeof p.currency === 'string' ? p.currency.toUpperCase() : '';
    const minor = typeof p.amount === 'string' && /^[A-Z]{3}$/.test(currency) ? toMinor(p.amount, currency) : null;
    const day = typeof p.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? new Date(`${p.date}T12:00:00Z`) : null;
    const validDate = day !== null && Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === p.date;
    const onTrip = validDate && trips.some(t => t.startDate <= p.date && p.date <= t.endDate);
    if (!minor || !Number.isSafeInteger(minor) || !onTrip || typeof p.at !== 'string' || !Number.isFinite(Date.parse(p.at))) {
      done.push(p.id);
      continue;
    }
    const homeMinor = currency === home ? minor : rates ? toHome(minor, currency, home, rates) : null;
    if (homeMinor === null || !Number.isSafeInteger(homeMinor) || homeMinor < 0) continue;
    add.push({ paymentId: p.id, amountMinor: minor, currency, homeMinor, category: 'other', note: String(p.merchant ?? '').trim().slice(0, 120), at: p.at });
    done.push(p.id);
  }
  return { add, done };
}

export function pendingPayments(accountId: string): CardPayment[] {
  if (Platform.OS !== 'ios') return [];
  const stored = Settings.get(PAYMENTS_KEY);
  return Array.isArray(stored) ? stored.filter(p => p && typeof p.id === 'string' && p.accountId === accountId) : [];
}

export function forgetPayments(ids: string[], accountId: string) {
  if (Platform.OS !== 'ios' || !ids.length) return;
  const stored = Settings.get(PAYMENTS_KEY);
  if (Array.isArray(stored)) Settings.set({ [PAYMENTS_KEY]: stored.filter(p => !p || p.accountId !== accountId || !ids.includes(p.id)) });
}
