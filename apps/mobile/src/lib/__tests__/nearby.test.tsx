import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { Alert, Linking, Platform } from 'react-native';
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
  jest.clearAllMocks();
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
  expect(screen.getByText('No places found nearby')).toBeTruthy();
});

test('travellers can search the current places and clear the search without another network request', async () => {
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue({ granted: true } as never);
  const fetch = jest.fn<typeof global.fetch>().mockResolvedValue({ ok: true, status: 200, json: async () => ({ places: [place, { ...place, id: 'river', name: 'River Kitchen', address: 'Old Quarter' }], relaxed: [] }) } as Response);
  global.fetch = fetch;
  await open();
  await screen.findByText('Tea cafe');
  await fireEvent.changeText(screen.getByLabelText('Search these places'), 'old quarter');
  expect(screen.queryByText('Tea cafe')).toBeNull();
  expect(screen.getByText('River Kitchen')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Clear search' }));
  expect(screen.getByText('Tea cafe')).toBeTruthy();
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('applies confirmed-open filters only after confirmation and lets travellers recover from no matches', async () => {
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue({ granted: true } as never);
  global.fetch = jest.fn<typeof global.fetch>().mockResolvedValue({ ok: true, status: 200, json: async () => ({ places: [{ ...place, openNow: null }], relaxed: [] }) } as Response);
  await open();
  await screen.findByText('Tea cafe');
  expect(screen.getByText('Hours not listed')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Filters' }));
  await fireEvent(screen.getByRole('switch', { name: 'Open now only' }), 'valueChange', true);
  await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByText('Tea cafe')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Filters' }));
  await fireEvent(screen.getByRole('switch', { name: 'Open now only' }), 'valueChange', true);
  await fireEvent.press(screen.getByRole('button', { name: 'Show places' }));
  expect(screen.queryByText('Tea cafe')).toBeNull();
  expect(screen.getByText('No places match your choices')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Clear filters' }));
  expect(screen.getByText('Tea cafe')).toBeTruthy();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('sorts the displayed places by distance and keeps Maps failures actionable', async () => {
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue({ granted: true } as never);
  global.fetch = jest.fn<typeof global.fetch>().mockResolvedValue({ ok: true, status: 200, json: async () => ({ places: [
    { ...place, id: 'far', name: 'Far Cafe', distanceM: 1000 },
    { ...place, id: 'near', name: 'Near Cafe', distanceM: 100 },
  ], relaxed: [] }) } as Response);
  await open();
  await screen.findByText('Far Cafe');
  await fireEvent.press(screen.getByRole('button', { name: 'Filters' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Nearest' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Show places' }));
  expect(screen.getAllByRole('button', { name: /^Directions to/ }).map(link => link.props.accessibilityLabel))
    .toEqual(['Directions to Near Cafe', 'Directions to Far Cafe']);
  jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('Maps unavailable'));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await fireEvent.press(screen.getByRole('button', { name: 'Directions to Near Cafe' }));
  expect(alert).toHaveBeenCalledWith('Get directions', 'Near Cafe', expect.any(Array));
  expect(Linking.openURL).not.toHaveBeenCalled();
  const choices = alert.mock.calls[0][2]!;
  expect(choices.map(choice => choice.text)).toEqual(['Google Maps', Platform.OS === 'ios' ? 'Apple Maps' : 'Apple Maps (web)', 'Cancel']);
  await act(async () => choices[0].onPress?.());
  await waitFor(() => expect(alert).toHaveBeenCalledWith('Could not open Maps', 'Try again or search for Near Cafe in your Maps app.'));
});

test('applies a food preference to this search and explains broader matches without changing the saved profile', async () => {
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue({ granted: true } as never);
  const fetch = jest.fn<typeof global.fetch>()
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ places: [place], relaxed: [] }) } as Response)
    .mockResolvedValue({ ok: true, status: 200, json: async () => ({ places: [place], relaxed: ['diet'] }) } as Response);
  global.fetch = fetch;
  await open();
  await screen.findByText('Tea cafe');
  await fireEvent.press(screen.getByRole('button', { name: 'Filters' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Halal' }));
  expect(fetch).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole('button', { name: 'Show places' }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(String(fetch.mock.calls[1][0])).toContain('kind=food&diet=halal');
  expect(await screen.findByText(/No exact match was found for your diet preference/)).toBeTruthy();
  expect(jest.mocked(AsyncStorage.setItem).mock.calls.every(([, value]) => JSON.parse(value).profile?.diet !== 'halal')).toBe(true);
  await fireEvent.press(screen.getByRole('button', { name: 'Pharmacy' }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  expect(String(fetch.mock.calls[2][0])).toContain('kind=pharmacy&diet=none');
  await fireEvent.press(screen.getByRole('button', { name: 'Filters' }));
  expect(screen.queryByText('Food preference')).toBeNull();
  expect(screen.queryByText('Price')).toBeNull();
});

test.each<typeof Platform.OS>(['ios', 'android'])('%s offers both map providers and opens only the selected Apple option', async platform => {
  jest.replaceProperty(Platform, 'OS', platform);
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue({ granted: true } as never);
  global.fetch = jest.fn<typeof global.fetch>().mockResolvedValue({ ok: true, status: 200, json: async () => ({ places: [place], relaxed: [] }) } as Response);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const launch = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  await open();
  await fireEvent.press(await screen.findByRole('button', { name: 'Directions to Tea cafe' }));
  const choices = alert.mock.calls[0][2]!;
  expect(choices.map(choice => choice.text)).toEqual(['Google Maps', platform === 'ios' ? 'Apple Maps' : 'Apple Maps (web)', 'Cancel']);
  expect(launch).not.toHaveBeenCalled();
  await act(async () => choices[1].onPress?.());
  expect(launch).toHaveBeenCalledTimes(1);
  const url = new URL(launch.mock.calls[0][0]);
  expect(url.origin).toBe('https://maps.apple.com');
  expect(url.searchParams.get('daddr')).toBe('Tea cafe, Test street');
});
