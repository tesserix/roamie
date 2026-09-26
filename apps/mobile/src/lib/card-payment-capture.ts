import { useEffect } from 'react';
import { AppState, Platform, Settings } from 'react-native';

import { fxRates } from './api';
import { nudge } from './budget-nudge';
import { capturePayments, forgetPayments, PAYMENTS_KEY, pendingPayments } from './card-payments';
import { crossed } from './money';
import { useStore } from './store';
import { useTrips } from './trip-store';

export function useCardPaymentCapture() {
  const { ready, profile, expenses, addExpense } = useStore();
  const { trips, ready: tripsReady } = useTrips();
  const spent = expenses.reduce((sum, e) => sum + e.homeMinor, 0);
  const home = profile?.homeCurrency;
  const budget = profile?.budgetMinor ?? 0;

  useEffect(() => {
    if (Platform.OS !== 'ios' || !ready || !tripsReady || !home) return;
    let busy = false;
    async function capture() {
      const pending = pendingPayments();
      if (busy || !pending.length || !home) return;
      busy = true;
      try {
        const rates = pending.every(p => p.currency === home) ? null : await fxRates(home).then(r => r.rates).catch(() => null);
        const { add, done } = capturePayments(pending, trips, home, rates);
        const after = add.reduce((sum, e) => sum + e.homeMinor, spent);
        add.forEach(addExpense);
        forgetPayments(done);
        const hit = crossed(spent, after, budget);
        if (hit) await nudge(hit, after, budget, home);
      } finally {
        busy = false;
      }
    }
    void capture();
    const app = AppState.addEventListener('change', state => { if (state === 'active') void capture(); });
    const watch = Settings.watchKeys(PAYMENTS_KEY, () => { void capture(); });
    return () => { app.remove(); Settings.clearWatch(watch); };
  }, [ready, tripsReady, home, budget, spent, trips, addExpense]);
}
