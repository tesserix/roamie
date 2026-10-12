import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { Alert, Linking } from 'react-native';
import Nearby from '../../app/nearby';
import { StoreProvider, useStore } from '../store';
import { session } from '../auth-client';

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(async () => {}) }));
jest.mock('expo-audio', () => ({ createAudioPlayer: jest.fn(), setAudioModeAsync: jest.fn() }));
jest.mock('expo-speech', () => ({ stop: jest.fn(), speak: jest.fn(), getAvailableVoicesAsync: jest.fn(async () => []) }));
jest.mock('expo-router', () => ({ useIsFocused: () => true }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('expo-location', () => ({ getForegroundPermissionsAsync: jest.fn(), requestForegroundPermissionsAsync: jest.fn(), hasServicesEnabledAsync: jest.fn(async () => true), getCurrentPositionAsync: jest.fn(async () => ({ coords: { latitude: -37, longitude: 145 } })), reverseGeocodeAsync: jest.fn(async () => []), Accuracy: { Balanced: 3 } }));
jest.mock('expo/fetch', () => ({ fetch: (...args: Parameters<typeof global.fetch>) => global.fetch(...args) }));
jest.mock('expo-notifications', () => ({ cancelAllScheduledNotificationsAsync: jest.fn(async () => {}) }));
function ReadyNearby() { return useStore().ready ? <Nearby /> : null; }
async function open() { await render(<StoreProvider accountId="nearby-test"><ReadyNearby /></StoreProvider>); }
const originalFetch = global.fetch;
beforeEach(() => {
  jest.spyOn(session, 'current').mockReturnValue({ sub: 'nearby-test', name: 'Test traveller', email: 'test@example.invalid' });
  jest.spyOn(session, 'accessToken').mockResolvedValue('test-token');
  jest.mocked(AsyncStorage.getItem).mockResolvedValue(JSON.stringify({ profile: { language: 'en', homeCurrency: 'USD', budgetMinor: 0, diet: 'none' }, partner: null, expenses: [] }));
});
afterEach(() => { jest.restoreAllMocks(); global.fetch = originalFetch; });
const place = { id: 'tea', name: 'Tea cafe', address: 'Test street', mapsUri: 'https://maps.google.com/?q=tea', distanceM: 100, rating: null, openNow: true, why: '' };

test('location denial offers retry and Settings failure is actionable', async () => {
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue({ granted: false, canAskAgain: false } as never);
  jest.spyOn(Linking, 'openSettings').mockRejectedValue(new Error('unavailable'));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  global.fetch = jest.fn<typeof global.fetch>().mockResolvedValue({ ok: true, status: 200, json: async () => ({ places: [place], relaxed: [] }) } as Response);
  await open();
  await fireEvent.press(await screen.findByRole('button', { name: 'Open Settings' }));
  await waitFor(() => expect(alert).toHaveBeenCalledWith('Open your phone settings', 'Allow location access for Roamie, then return and tap Try again.'));
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue({ granted: true } as never);
  await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Tea cafe')).toBeTruthy();
});

test('changing category removes old places and cancels stale requests', async () => {
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue({ granted: true } as never);
  let finish!: (response: Response) => void;
  const fetch = jest.fn<typeof global.fetch>()
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ places: [place], relaxed: [] }) } as Response)
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValue({ ok: true, status: 200, json: async () => ({ places: [], relaxed: [] }) } as Response);
  global.fetch = fetch;
  await open();
  await screen.findByText('Tea cafe');
  await fireEvent.press(screen.getByRole('button', { name: 'Pharmacy' }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(screen.queryByText('Tea cafe')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'ATM' }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  expect((fetch.mock.calls[1][1]?.signal as AbortSignal).aborted).toBe(true);
  await act(async () => finish({ ok: true, status: 200, json: async () => ({ places: [place], relaxed: [] }) } as Response));
  expect(screen.queryByText('Tea cafe')).toBeNull();
  expect(screen.getByText('Nothing open nearby')).toBeTruthy();
});
