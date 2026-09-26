import React from 'react';
import { beforeEach, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { fetch } from 'expo/fetch';
import { TripManager } from '../../components/trip-manager';
import { session } from '../auth-client';
import { initialPreferences } from '../trip-manager';
import { createTrip } from '../trips';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}) }));
jest.mock('expo-secure-store', () => ({ setItemAsync: jest.fn(async () => {}), deleteItemAsync: jest.fn(async () => {}) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const trip = createTrip({ title: 'Sydney', destination: 'Sydney', startDate: '2026-10-01', endDate: '2026-10-02', currency: 'AUD', budgetMinor: 60000, diet: 'none', interests: '', travellers: 1 });
const saved = { trip_id: trip.id, revision: 'r1', preferences: initialPreferences(trip, 'en') };
const respond = (data: unknown) => jest.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 200, json: async () => data } as Awaited<ReturnType<typeof fetch>>);

beforeEach(async () => {
  jest.mocked(fetch).mockReset();
  await session.clear();
  await session.accept({ accessToken: 'test-token', refreshToken: 'test-refresh', expiresIn: 3600 },
    { sub: 'alice', email: 'alice@example.com', name: 'Alice' },
    { issuer: 'https://auth.tesserix.app', organizationId: 'org', projectId: 'project', clientIds: { ios: 'ios', android: 'android' }, providers: { google: 'google' } }, 'ios');
  respond(saved);
});

test('currency exchange sends exact minor units with the saved profile reference', async () => {
  respond({ ...saved, revision: 'r2' });
  respond({ manager_id: 'trip-manager-alice', profile_revision: 'r2', review_run_ids: ['pre', 'post'], response: { status: 'no_matches', specialist: 'currency-exchange', recommendations: [], limitations: ['No verified quotes'] } });
  await render(<TripManager trip={trip} language="en" choose={async () => {}} />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Currency exchange' }));
  await fireEvent.changeText(screen.getByLabelText('Amount to exchange in AUD'), '125.50');
  await fireEvent.changeText(screen.getByLabelText('Currency to receive'), 'usd');
  await fireEvent.press(screen.getByRole('button', { name: 'Ask my trip manager' }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  const [url, request] = jest.mocked(fetch).mock.calls[2];
  expect(url).toContain('/v1/trip-manager');
  expect(JSON.parse(String(request?.body))).toMatchObject({ profile: { trip_id: trip.id, revision: 'r2' }, specialist: 'currency-exchange', request: { exchange_amount_minor: 12550, exchange_destination_currency: 'USD' } });
  expect(await screen.findByText('No verified quotes')).toBeTruthy();
});

test.each(['', '0', '-1', '1.001', '10000000001', 'NaN', '1e3'])('rejects invalid exchange amount %s before saving or requesting advice', async amount => {
  await render(<TripManager trip={trip} language="en" choose={async () => {}} />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Currency exchange' }));
  await fireEvent.changeText(screen.getByLabelText('Amount to exchange in AUD'), amount);
  await fireEvent.changeText(screen.getByLabelText('Currency to receive'), 'USD');
  await fireEvent.press(screen.getByRole('button', { name: 'Ask my trip manager' }));
  expect(await screen.findByText('Enter a valid amount to exchange without rounding.')).toBeTruthy();
  expect(fetch).toHaveBeenCalledTimes(1);
});

test.each(['', 'AUD', 'aud', 'US', 'US1', 'USDD'])('rejects invalid or same-currency target %s before API writes', async currency => {
  await render(<TripManager trip={trip} language="en" choose={async () => {}} />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Currency exchange' }));
  await fireEvent.changeText(screen.getByLabelText('Amount to exchange in AUD'), '125.50');
  await fireEvent.changeText(screen.getByLabelText('Currency to receive'), currency);
  await fireEvent.press(screen.getByRole('button', { name: 'Ask my trip manager' }));
  expect(await screen.findByText('Enter a different three-letter currency code, such as USD.')).toBeTruthy();
  expect(fetch).toHaveBeenCalledTimes(1);
});

test.each<[string, string, number]>([['JPY', '125', 125], ['KWD', '1.234', 1234], ['AUD', '10000000000', 10 ** 12]])('uses saved %s precision for %s', async (currency, amount, minor) => {
  jest.mocked(fetch).mockReset();
  const profile = { ...saved, preferences: { ...saved.preferences, currency } };
  respond(profile);
  respond({ ...profile, revision: 'r2' });
  respond({ manager_id: 'trip-manager-alice', profile_revision: 'r2', review_run_ids: ['pre', 'post'], response: { status: 'no_matches', specialist: 'currency-exchange', recommendations: [], limitations: ['No verified quotes'] } });
  await render(<TripManager trip={trip} language="en" choose={async () => {}} />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Currency exchange' }));
  await fireEvent.changeText(screen.getByLabelText(`Amount to exchange in ${currency}`), amount);
  await fireEvent.changeText(screen.getByLabelText('Currency to receive'), 'USD');
  await fireEvent.press(screen.getByRole('button', { name: 'Ask my trip manager' }));
  expect(await screen.findByText('No verified quotes')).toBeTruthy();
  expect(JSON.parse(String(jest.mocked(fetch).mock.calls[2][1]?.body)).request.exchange_amount_minor).toBe(minor);
  await fireEvent.changeText(screen.getByLabelText('Currency to receive'), 'EUR');
  expect(screen.queryByText('No verified quotes')).toBeNull();
});
