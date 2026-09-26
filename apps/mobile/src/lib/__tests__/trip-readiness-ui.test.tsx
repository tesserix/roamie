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
  expect(screen.getByText(/No forecast yet for 1 trip day/)).toBeTruthy();
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
