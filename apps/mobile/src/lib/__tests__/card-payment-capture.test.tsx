import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { AppState, Platform, Settings, Text } from 'react-native';

import { fxRates } from '../api';
import { useCardPaymentCapture } from '../card-payment-capture';
import { PAYMENTS_KEY } from '../card-payments';
import { accountStorageKey, StoreProvider, useStore } from '../store';
import { TripsProvider } from '../trip-store';
import { createTrip, tripStorageKey } from '../trips';

jest.mock('../api', () => ({ fxRates: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn() }));
jest.mock('react-native/Libraries/Settings/Settings', () => ({ __esModule: true, default: { get: jest.fn(), set: jest.fn(), watchKeys: jest.fn(), clearWatch: jest.fn() } }));
jest.mock('expo-notifications', () => ({ setNotificationHandler: jest.fn(), scheduleNotificationAsync: jest.fn(async () => ''), getPermissionsAsync: jest.fn(async () => ({ granted: false })) }));

const account = 'card-test';
const payment = { id: 'payment-one', accountId: account, merchant: 'Test cafe', amount: '12.50', currency: 'AUD', date: '2026-10-21', at: '2026-10-21T03:00:00Z' };
const trip = createTrip({ title: 'QA trip', destination: 'Hanoi', startDate: '2026-10-20', endDate: '2026-10-22', currency: 'AUD', budgetMinor: 0, diet: 'none', interests: '', travellers: 1 });
let native: Record<string, unknown>;
let stored: Map<string, string>;
function Capture() {
  useCardPaymentCapture();
  const store = useStore();
  return <Text>{store.error ?? (store.expenses.map(e => e.note).join(', ') || 'No expenses')}</Text>;
}
async function open(accountId = account) {
  return render(<StoreProvider key={accountId} accountId={accountId}><TripsProvider accountId={accountId}><Capture /></TripsProvider></StoreProvider>);
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.replaceProperty(Platform, 'OS', 'ios');
  native = { [PAYMENTS_KEY]: [payment] };
  stored = new Map([
    [accountStorageKey(account), JSON.stringify({ profile: { language: 'en', homeCurrency: 'AUD', budgetMinor: 0, diet: 'none' }, expenses: [], partner: null })],
    [tripStorageKey(account), JSON.stringify([trip])],
  ]);
  jest.mocked(AsyncStorage.getItem).mockImplementation(async key => stored.get(key) ?? null);
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => { stored.set(key, value); });
  jest.spyOn(Settings, 'get').mockImplementation(key => native[key]);
  jest.spyOn(Settings, 'set').mockImplementation(values => { Object.assign(native, values); });
  jest.spyOn(Settings, 'watchKeys').mockReturnValue(1);
  jest.spyOn(Settings, 'clearWatch').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); });

test('keeps a payment queued until its expense has been durably saved', async () => {
  let finish!: () => void;
  jest.mocked(AsyncStorage.setItem).mockImplementation((key, value) => {
    if (JSON.parse(value).expenses?.length) return new Promise<void>(resolve => { finish = () => { stored.set(key, value); resolve(); }; });
    stored.set(key, value);
    return Promise.resolve();
  });
  await open();
  await screen.findByText('Test cafe');
  expect(native[PAYMENTS_KEY]).toEqual([payment]);
  await act(async () => finish());
  await waitFor(() => expect(native[PAYMENTS_KEY]).toEqual([]));
  expect(JSON.parse(stored.get(accountStorageKey(account))!).expenses).toEqual([expect.objectContaining({ note: 'Test cafe', amountMinor: 1250, homeMinor: 1250 })]);
});

test('never imports or removes another account’s payment or an unowned legacy entry', async () => {
  const other = 'other-account';
  stored.set(accountStorageKey(other), stored.get(accountStorageKey(account))!);
  stored.set(tripStorageKey(other), stored.get(tripStorageKey(account))!);
  const legacy = { ...payment, id: 'legacy', accountId: undefined };
  native[PAYMENTS_KEY] = [payment, legacy];
  await open(other);
  await waitFor(() => expect(JSON.parse(stored.get(accountStorageKey(other))!).expenses).toEqual([]));
  expect(screen.queryByText('Test cafe')).toBeNull();
  expect(native[PAYMENTS_KEY]).toEqual([payment, legacy]);
});

test('replaying a queued payment after restart does not add the expense again', async () => {
  const first = await open();
  await screen.findByText('Test cafe');
  await waitFor(() => expect(native[PAYMENTS_KEY]).toEqual([]));
  await first.unmount();
  native[PAYMENTS_KEY] = [payment];
  await open();
  await waitFor(() => expect(native[PAYMENTS_KEY]).toEqual([]));
  expect(JSON.parse(stored.get(accountStorageKey(account))!).expenses).toHaveLength(1);
});

test('a failed save preserves the queue and retry imports only once', async () => {
  let fail = true;
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    if (fail && JSON.parse(value).expenses?.length) throw new Error('Storage full');
    stored.set(key, value);
  });
  const view = await open();
  await screen.findByText('Your latest wallet changes have not been saved. Keep Roamie open and try again.');
  expect(native[PAYMENTS_KEY]).toEqual([payment]);
  await view.unmount();
  fail = false;
  await open();
  await waitFor(() => expect(native[PAYMENTS_KEY]).toEqual([]));
  expect(JSON.parse(stored.get(accountStorageKey(account))!).expenses).toHaveLength(1);
});


test('keeps an unmatched payment until trip dates are corrected, then imports it once', async () => {
  stored.set(tripStorageKey(account), JSON.stringify([]));
  const first = await open();
  await screen.findByText('No expenses');
  await waitFor(() => expect(Settings.watchKeys).toHaveBeenCalled());
  expect(native[PAYMENTS_KEY]).toEqual([payment]);
  await first.unmount();
  stored.set(tripStorageKey(account), JSON.stringify([trip]));
  const second = await open();
  await screen.findByText('Test cafe');
  await waitFor(() => expect(native[PAYMENTS_KEY]).toEqual([]));
  await second.unmount();
  await open();
  await screen.findByText('Test cafe');
  expect(JSON.parse(stored.get(accountStorageKey(account))!).expenses).toHaveLength(1);
});


test('retains a foreign payment offline and imports it on foreground when rates recover', async () => {
  const foreign = { ...payment, currency: 'USD', amount: '10.00' };
  native[PAYMENTS_KEY] = [foreign];
  jest.mocked(fxRates).mockRejectedValue(new Error('Offline'));
  const events = jest.spyOn(AppState, 'addEventListener');
  await open();
  await waitFor(() => expect(fxRates).toHaveBeenCalledWith('AUD'));
  expect(native[PAYMENTS_KEY]).toEqual([foreign]);
  expect(JSON.parse(stored.get(accountStorageKey(account))!).expenses).toHaveLength(0);
  jest.mocked(fxRates).mockResolvedValue({ base: 'AUD', asOf: '2026-10-21', rates: { USD: 0.5 } });
  await act(async () => {
    const listener = events.mock.calls.filter(([event]) => event === 'change').at(-1)![1];
    listener('active');
  });
  await screen.findByText('Test cafe');
  await waitFor(() => expect(native[PAYMENTS_KEY]).toEqual([]));
  expect(JSON.parse(stored.get(accountStorageKey(account))!).expenses).toEqual([expect.objectContaining({ currency: 'USD', amountMinor: 1000, homeMinor: 2000 })]);
});
