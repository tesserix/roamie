import { expect, test } from '@jest/globals';

import { capturePayments, type CardPayment } from '../card-payments';

const trips = [{ startDate: '2026-10-02', endDate: '2026-10-08' }];
const payment = (id: string, date: string, amount: string, currency: string, merchant = 'Pho 24'): CardPayment => ({ id, merchant, amount, currency, date, at: `${date}T05:00:00.000Z` });

test('payments made during a trip become expenses converted home', () => {
  const { add, done } = capturePayments([payment('a', '2026-10-02', '185000', 'VND'), payment('b', '2026-10-08', '12.5', 'AUD', 'Opal')], trips, 'AUD', { VND: 16000 });
  expect(add).toEqual([
    { paymentId: 'a', amountMinor: 185000, currency: 'VND', homeMinor: 1156, category: 'other', note: 'Pho 24', at: '2026-10-02T05:00:00.000Z' },
    { paymentId: 'b', amountMinor: 1250, currency: 'AUD', homeMinor: 1250, category: 'other', note: 'Opal', at: '2026-10-08T05:00:00.000Z' },
  ]);
  expect(done).toEqual(['a', 'b']);
});

test('payments outside every trip wait while unreadable payments are dropped', () => {
  const { add, done } = capturePayments([payment('home', '2026-10-09', '5', 'AUD'), payment('bad', '2026-10-03', 'abc', 'AUD'), payment('neg', '2026-10-03', '-5', 'AUD')], trips, 'AUD', {});
  expect(add).toEqual([]);
  expect(done).toEqual(['bad', 'neg']);
});

test('payments that cannot be converted yet wait for rates', () => {
  const { add, done } = capturePayments([payment('jpy', '2026-10-03', '1000', 'JPY')], trips, 'AUD', null);
  expect(add).toEqual([]);
  expect(done).toEqual([]);
});

test('malformed stored entries are dropped when they carry an id', () => {
  const { add, done } = capturePayments([{ id: 'x' } as CardPayment], trips, 'AUD', {});
  expect(add).toEqual([]);
  expect(done).toEqual(['x']);
});

test('rejects unsafe amounts and timestamps and counts a repeated payment id once', () => {
  const valid = payment('once', '2026-10-03', '12.50', 'AUD');
  const result = capturePayments([
    payment('huge', '2026-10-03', '9'.repeat(40), 'AUD'),
    { ...valid, id: 'bad-time', at: 'not a timestamp' },
    valid, valid,
  ], trips, 'AUD', null);
  expect(result.add).toEqual([expect.objectContaining({ paymentId: 'once', amountMinor: 1250 })]);
  expect(result.done).toEqual(['huge', 'bad-time', 'once']);
});
