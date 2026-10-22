import { expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { TripReadiness } from '@/components/trip-readiness';
import { checkTripReadiness, type DestinationCheck } from '../trip-readiness';
import { createTrip } from '../trips';
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}) }));
jest.mock('../trip-readiness', () => ({ checkTripReadiness: jest.fn() }));
const trip = createTrip({ title: 'Japan', destination: 'Japan', startDate: '2027-01-01', endDate: '2027-01-02', currency: 'JPY', budgetMinor: 20000, travellers: 1, diet: 'none', interests: '' });

test('shows progress, then missing forecast coverage and official guidance', async () => {
  let complete!: (value: DestinationCheck[]) => void;
  jest.mocked(checkTripReadiness).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  await render(<TripReadiness trip={trip} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Check weather & entry guidance' }));
  expect(await screen.findByText('Checking your destinations…')).toBeTruthy();
  await act(async () => complete([{ destination: 'Japan', start: trip.startDate, end: trip.endDate, weather: { profile_revision: '1', response: { status: 'ok', limitations: [], recommendations: [{ id: 'coverage', name: 'Forecast coverage', source_url: 'https://developers.google.com/maps/documentation/weather', observed_at: new Date().toISOString(), weather: { coverage: 'unavailable', missing_dates: ['2027-01-01'], suggestions: ['Recheck closer to departure.'] } }] } } }]));
  expect(screen.getByText(/Forecast unavailable for 1 trip day/)).toBeTruthy();
  expect(screen.queryByText('Checking your destinations…')).toBeNull();
});

test('cancel aborts the request and does not show stale results', async () => {
  let signal: AbortSignal | undefined;
  let complete!: (value: DestinationCheck[]) => void;
  jest.mocked(checkTripReadiness).mockImplementationOnce((_trip, value) => { signal = value; return new Promise(resolve => { complete = resolve; }); });
  await render(<TripReadiness trip={trip} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Check weather & entry guidance' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Cancel trip check' }));
  expect(signal?.aborted).toBe(true);
  await act(async () => complete([{ destination: 'stale destination', start: trip.startDate, end: trip.endDate }]));
  expect(screen.queryByText('stale destination')).toBeNull();
  expect(screen.getByRole('button', { name: 'Check weather & entry guidance' })).toBeTruthy();
});

test('unsupported forecast coverage does not promise a later forecast', async () => {
  const guidance = 'Google Weather does not provide daily forecasts in this country.';
  jest.mocked(checkTripReadiness).mockResolvedValueOnce([{ destination: 'Japan', start: trip.startDate, end: trip.endDate, weather: { profile_revision: '1', response: { status: 'ok', limitations: [], recommendations: [{ id: 'coverage', name: 'Daily forecasts unavailable', source_url: 'https://developers.google.com/maps/documentation/weather/coverage', observed_at: new Date().toISOString(), weather: { coverage: 'unavailable', missing_dates: ['2027-01-01'], suggestions: [guidance] } }] } } }]);
  await render(<TripReadiness trip={trip} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Check weather & entry guidance' }));
  expect(await screen.findByText(guidance)).toBeTruthy();
  expect(screen.queryByText(/Check again closer to departure/)).toBeNull();
});

test.each([
  ['https://open-meteo.com/', 'Weather by Open-Meteo · Source'],
  ['https://developers.google.com/maps/documentation/weather', 'Weather by Google · Source'],
  ['https://api.met.no/', 'Weather by MET Norway · Source'],
  ['https://example.com/', 'Weather source'],
  ['https://open-meteo.com.example.com/', 'Weather source'],
])('credits the actual weather provider: %s', async (source_url, label) => {
  jest.mocked(checkTripReadiness).mockResolvedValueOnce([{ destination: 'Tokyo', start: trip.startDate, end: trip.endDate, weather: { profile_revision: '1', response: { status: 'ok', limitations: [], recommendations: [{ id: 'day', name: 'Daily forecast', source_url, observed_at: '2026-10-12T00:00:00Z', weather: { coverage: 'forecast', local_date: '2027-01-01', minimum_celsius: 12, maximum_celsius: 20, precipitation_percent: 55, missing_dates: [], suggestions: [] } }] } } }]);
  await render(<TripReadiness trip={trip} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Check weather & entry guidance' }));
  expect(await screen.findByRole('button', { name: label })).toBeTruthy();
  expect(screen.queryByText(/Daytime rain/)).toBeNull();
  expect(screen.queryByText(/next ten days/)).toBeNull();
});
