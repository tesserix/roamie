import { expect, test } from '@jest/globals';

import { reviewStatement } from '../statement';

const expense = (amountMinor: number, currency: string, at: string) => ({ id: at, amountMinor, currency, homeMinor: 0, category: 'food', note: '', at });

test('statement lines are converted home and already-added spending is flagged', () => {
  const rows = reviewStatement(
    [
      { date: '2026-10-02', merchant: 'Pho 24', amountMinor: 185000, currency: 'VND', category: 'food' },
      { date: '2026-10-03', merchant: 'Hotel refund', amountMinor: -2500, currency: 'AUD', category: 'stay' },
      { date: '2026-10-04', merchant: 'Tokyo taxi', amountMinor: 1000, currency: 'JPY', category: 'transport' },
    ],
    [expense(185000, 'VND', '2026-10-02T11:00:00.000Z')],
    'AUD',
    { VND: 16000 },
  );
  expect(rows.map(r => [r.merchant, r.homeMinor, r.duplicate, r.selected])).toEqual([
    ['Pho 24', 1156, true, false],
    ['Hotel refund', -2500, false, true],
    ['Tokyo taxi', null, false, false],
  ]);
});
