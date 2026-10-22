import { expect, jest, test } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { accountStorageKey, StoreProvider, useStore } from '../store';

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));

function Trip() {
  const { ready, expenses, error } = useStore();
  return <Text>{error ?? (ready ? expenses.map(expense => expense.note).join(', ') || 'No expenses' : 'Loading')}</Text>;
}

test('switching accounts never displays or saves the previous account trip under the next account', async () => {
  const aliceTrip = JSON.stringify({ profile: null, partner: null, expenses: [{ id: 'expense-a', note: 'Alice hotel' }] });
  const stored = new Map([[accountStorageKey('alice'), aliceTrip], ['roamie.v1', 'anonymous trip']]);
  jest.mocked(AsyncStorage.getItem).mockImplementation(async key => stored.get(key) ?? null);
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => { stored.set(key, value); });
  const view = await render(<StoreProvider key="alice" accountId="alice"><Trip /></StoreProvider>);
  expect(await screen.findByText('Alice hotel')).toBeTruthy();
  await view.rerender(<StoreProvider key="bob" accountId="bob"><Trip /></StoreProvider>);
  expect(await screen.findByText('No expenses')).toBeTruthy();
  expect(screen.queryByText('Alice hotel')).toBeNull();
  await waitFor(() => expect(stored.get(accountStorageKey('bob'))).not.toContain('Alice hotel'));
  expect(JSON.parse(stored.get(accountStorageKey('alice'))!).expenses[0].note).toBe('Alice hotel');
  expect(stored.get('roamie.v1')).toBe('anonymous trip');
});

test('a damaged wallet is preserved instead of overwritten by an empty wallet', async () => {
  jest.mocked(AsyncStorage.getItem).mockResolvedValue('{damaged');
  jest.mocked(AsyncStorage.setItem).mockClear();
  await render(<StoreProvider accountId="damaged"><Trip /></StoreProvider>);
  expect(await screen.findByText('We could not open your saved wallet. Your data has not been changed.')).toBeTruthy();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('remembered conversation languages stay with their own account', async () => {
  function Pair() {
    const { ready, talkPair } = useStore();
    return <Text>{ready ? talkPair ? `${talkPair.mine} → ${talkPair.partner}` : 'No conversation languages' : 'Loading'}</Text>;
  }
  const stored = new Map([[accountStorageKey('alice'), JSON.stringify({ profile: null, expenses: [], talkPair: { mine: 'en', partner: 'bn' } })]]);
  jest.mocked(AsyncStorage.getItem).mockImplementation(async key => stored.get(key) ?? null);
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => { stored.set(key, value); });
  const app = await render(<StoreProvider key="alice" accountId="alice"><Pair /></StoreProvider>);
  expect(await screen.findByText('en → bn')).toBeTruthy();
  await app.rerender(<StoreProvider key="bob" accountId="bob"><Pair /></StoreProvider>);
  expect(await screen.findByText('No conversation languages')).toBeTruthy();
  expect(screen.queryByText('en → bn')).toBeNull();
  await waitFor(() => expect(JSON.parse(stored.get(accountStorageKey('bob'))!).talkPair).toBeNull());
  expect(JSON.parse(stored.get(accountStorageKey('alice'))!).talkPair).toEqual({ mine: 'en', partner: 'bn' });
});
