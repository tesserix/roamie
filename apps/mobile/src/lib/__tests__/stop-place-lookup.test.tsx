import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useState } from 'react';
import * as Location from 'expo-location';
import { StopPlaceLookup } from '../../components/stop-place-lookup';
import { session } from '../auth-client';
import type { TripPlace } from '../trip-contract';

jest.mock('expo/fetch', () => ({ fetch: (...args: Parameters<typeof global.fetch>) => global.fetch(...args) }));
jest.mock('expo-location', () => ({ getForegroundPermissionsAsync: jest.fn(), requestForegroundPermissionsAsync: jest.fn(), getCurrentPositionAsync: jest.fn(), Accuracy: { Balanced: 3 } }));
jest.mock('expo-notifications', () => ({ cancelAllScheduledNotificationsAsync: jest.fn(async () => {}) }));
const originalFetch = global.fetch;
const destination = { placeId: 'kyoto', name: 'Kyoto', label: 'Kyoto, Japan', country: 'Japan', countryCode: 'JP', latitude: 35, longitude: 135 };
const place = { id: 'garden', name: 'Temple garden', address: 'Kyoto street', lat: 35.001, lng: 135, mapsUri: 'https://maps.google.com/?q=garden', distanceM: 100, rating: 4.5, openNow: null, why: '' };
const reply = (places = [place]) => ({ ok: true, status: 200, json: async () => ({ places, relaxed: [] }) }) as Response;
function Editor({ onSelect = () => {} }: { onSelect?: (place: TripPlace) => void }) {
  const [value, setValue] = useState('');
  return <StopPlaceLookup destination={destination} destinationLabel="Kyoto, Japan" value={value} onChange={setValue} onSelect={p => { setValue(p.name); onSelect(p); }} />;
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(session, 'current').mockReturnValue({ sub: 'places-test', name: 'Test', email: 'test@example.invalid' });
  jest.spyOn(session, 'accessToken').mockResolvedValue('test-token');
  global.fetch = jest.fn<typeof global.fetch>().mockResolvedValue(reply());
});
afterEach(() => { jest.restoreAllMocks(); global.fetch = originalFetch; });

test('opens destination suggestions only on demand and selects real place details', async () => {
  const select = jest.fn<(place: TripPlace) => void>();
  await render(<Editor onSelect={select} />);
  expect(global.fetch).not.toHaveBeenCalled();
  await fireEvent(screen.getByLabelText('Place or activity'), 'focus');
  await fireEvent.press(await screen.findByRole('button', { name: 'Choose Temple garden, Kyoto street' }));
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('lat=35&lng=135&kind=sights'), expect.anything());
  expect(Location.getForegroundPermissionsAsync).not.toHaveBeenCalled();
  expect(select).toHaveBeenCalledWith({ id: 'garden', name: 'Temple garden', address: 'Kyoto street', lat: 35.001, lng: 135, mapsUri: place.mapsUri });
  expect(screen.getByLabelText('Place or activity').props.value).toBe('Temple garden');
  expect(screen.queryByText('Sights near Kyoto, Japan')).toBeNull();
});

test('asks for device location only after Near me and falls back to trip suggestions on denial', async () => {
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue({ granted: false, canAskAgain: false } as never);
  await render(<Editor />);
  await fireEvent(screen.getByLabelText('Place or activity'), 'focus');
  await screen.findByText('Temple garden');
  await fireEvent.press(screen.getByRole('button', { name: 'Near me' }));
  expect(await screen.findByText('Location access is off. Choose Trip destination or type your own stop.')).toBeTruthy();
  expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Trip destination' }));
  await screen.findByText('Temple garden');
});

test('filters locally, keeps custom text and retries a failed request', async () => {
  global.fetch = jest.fn<typeof global.fetch>().mockRejectedValueOnce(new Error('Offline')).mockResolvedValue(reply());
  await render(<Editor />);
  await fireEvent(screen.getByLabelText('Place or activity'), 'focus');
  await screen.findByRole('button', { name: 'Retry place suggestions' });
  await fireEvent.changeText(screen.getByLabelText('Place or activity'), 'My picnic');
  expect(screen.getByLabelText('Place or activity').props.value).toBe('My picnic');
  await fireEvent.press(screen.getByRole('button', { name: 'Retry place suggestions' }));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  await screen.findByText('No matching suggestions. You can still save the place or activity you type.');
  await fireEvent.changeText(screen.getByLabelText('Place or activity'), 'temple');
  await screen.findByText('Temple garden');
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test('switching source cancels an older request and ignores its late results', async () => {
  let finish!: (response: Response) => void;
  global.fetch = jest.fn<typeof global.fetch>().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(reply([{ ...place, id: 'local', name: 'Local museum' }]));
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue({ granted: true } as never);
  jest.mocked(Location.getCurrentPositionAsync).mockResolvedValue({ coords: { latitude: -37, longitude: 145 } } as never);
  await render(<Editor />);
  await fireEvent(screen.getByLabelText('Place or activity'), 'focus');
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  await fireEvent.press(screen.getByRole('button', { name: 'Near me' }));
  await screen.findByText('Local museum');
  expect((jest.mocked(global.fetch).mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
  await act(async () => finish(reply()));
  expect(screen.queryByText('Temple garden')).toBeNull();
  expect(global.fetch).toHaveBeenLastCalledWith(expect.stringContaining('lat=-37&lng=145'), expect.anything());
});
