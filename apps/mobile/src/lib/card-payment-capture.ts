import { useEffect } from 'react';
import { AppState, Platform, Settings } from 'react-native';

import { fxRates } from './api';
import { nudge } from './budget-nudge';
import { capturePayments, forgetPayments, PAYMENT_ACCOUNT_KEY, PAYMENTS_KEY, pendingPayments } from './card-payments';
import { crossed } from './money';
import { useStore } from './store';
import { useTrips } from './trip-store';

export function useCardPaymentCapture() {
  const { ready, profile, expenses, addCardPayments, cardPaymentIds, savedCardPaymentIds } = useStore();
  const { trips, ready: tripsReady, accountId } = useTrips();
  const spent = expenses.reduce((sum, e) => sum + e.homeMinor, 0);
  const home = profile?.homeCurrency;
  const budget = profile?.budgetMinor ?? 0;

  useEffect(() => {
    if (Platform.OS !== 'ios' || !ready || !tripsReady || !home) return;
    Settings.set({ [PAYMENT_ACCOUNT_KEY]: accountId });
    return () => { if (Settings.get(PAYMENT_ACCOUNT_KEY) === accountId) Settings.set({ [PAYMENT_ACCOUNT_KEY]: '' }); };
  }, [accountId, ready, tripsReady, home]);

  useEffect(() => {
    if (Platform.OS !== 'ios' || !ready || !tripsReady || !home) return;
    let busy = false;
    let live = true;
    async function capture() {
      const pending = pendingPayments(accountId);
      if (busy || !pending.length || !home) return;
      busy = true;
      try {
        forgetPayments(pending.filter(p => savedCardPaymentIds.includes(p.id)).map(p => p.id), accountId);
        const fresh = pending.filter(p => !cardPaymentIds.includes(p.id));
        const rates = fresh.every(p => p.currency === home) ? null : await fxRates(home).then(r => r.rates).catch(() => null);
        if (!live) return;
        const { add, done } = capturePayments(fresh, trips, home, rates);
        const after = add.reduce((sum, e) => sum + e.homeMinor, spent);
        addCardPayments(add);
        forgetPayments(done.filter(id => !add.some(p => p.paymentId === id)), accountId);
        const hit = crossed(spent, after, budget);
        if (hit) await nudge(hit, after, budget, home);
      } finally {
        busy = false;
      }
    }
    void capture();
    const app = AppState.addEventListener('change', state => { if (state === 'active') void capture(); });
    const watch = Settings.watchKeys(PAYMENTS_KEY, () => { void capture(); });
    return () => { live = false; app.remove(); Settings.clearWatch(watch); };
  }, [accountId, ready, tripsReady, home, budget, spent, trips, addCardPayments, cardPaymentIds, savedCardPaymentIds]);
}
