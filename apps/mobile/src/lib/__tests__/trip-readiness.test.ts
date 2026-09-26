import { beforeEach, expect, jest, test } from '@jest/globals';
import { fetch } from 'expo/fetch';
import { session } from '../auth-client';
import { searchDestinations } from '../trip-api';
import { checkTripReadiness } from '../trip-readiness';
import { createTrip } from '../trips';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('../auth-client', () => ({ API_BASE: 'https://api.example.org', session: { current: jest.fn(() => ({ sub: 'traveller' })), accessToken: jest.fn(async () => 'fixture') } }));
jest.mock('../trip-api', () => ({ searchDestinations: jest.fn() }));
const tokyo = { placeId: 'tokyo', name: 'Tokyo', label: 'Tokyo, Japan', country: 'Japan', countryCode: 'JP' };
const osaka = { ...tokyo, placeId: 'osaka', name: 'Osaka', label: 'Osaka, Japan' };
const trip = createTrip({ title: 'Japan', destination: 'Japan', startDate: '2027-01-01', endDate: '2027-01-04', currency: 'JPY', budgetMinor: 20000, travellers: 1, diet: 'none', interests: '', stays: [{ destination: tokyo, days: 2 }, { destination: osaka, days: 2 }] });
beforeEach(() => { jest.clearAllMocks(); jest.mocked(session.current).mockReturnValue({ sub: 'traveller' } as never); });

test('each destination check uses its own dates and verified destination coordinates', async () => {
  const sent: any[] = [];
  jest.mocked(searchDestinations).mockImplementation(async query => [{ ...(query.startsWith('Tokyo') ? tokyo : osaka), latitude: 35, longitude: 139 }]);
  jest.mocked(fetch).mockImplementation(async (_url, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (init?.method === 'GET') return { ok: false, status: 404 } as Awaited<ReturnType<typeof fetch>>;
    if (init?.method === 'PUT') return { ok: true, json: async () => ({ revision: 'revision-1' }) } as Awaited<ReturnType<typeof fetch>>;
    sent.push(body);
    return { ok: true, json: async () => ({ profile_revision: 'revision-1', response: { status: 'ok', recommendations: [], limitations: [] } }) } as Awaited<ReturnType<typeof fetch>>;
  });
  const result = await checkTripReadiness(trip, new AbortController().signal);
  expect(result).toHaveLength(2);
  expect(sent.map(item => item.request.start_date)).toEqual(['2027-01-01','2027-01-01','2027-01-03','2027-01-03']);
  expect(sent[0].request.origin).toEqual({ latitude: 35, longitude: 139 });
  expect(sent[0].profile.revision).toBe('revision-1');
  expect(sent[0].profile.subject).toBeUndefined();
});

test('an account switch prevents saving or returning another account profile', async () => {
  jest.mocked(fetch).mockImplementation(async () => { jest.mocked(session.current).mockReturnValue({ sub: 'other' } as never); return { ok: true } as Awaited<ReturnType<typeof fetch>>; });
  await expect(checkTripReadiness(trip, new AbortController().signal)).rejects.toThrow('account changed');
  expect(fetch).toHaveBeenCalledTimes(1);
});
