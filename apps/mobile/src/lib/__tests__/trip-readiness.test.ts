import { beforeEach, expect, jest, test } from '@jest/globals';
import { fetch } from 'expo/fetch';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { session } from '../auth-client';
import { checkTripReadiness } from '../trip-readiness';
import { createTrip } from '../trips';

jest.mock('@react-native-async-storage/async-storage', () => ({getItem:jest.fn(async (key: string)=>key.startsWith('roamie.ai-consent.') ? 'allowed' : null),setItem:jest.fn(async()=>{})}));
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('../auth-client', () => ({ API_BASE: 'https://api.example.org', session: { current: jest.fn(() => ({ sub: 'traveller' })), accessToken: jest.fn(async () => 'fixture') } }));
const tokyo = { placeId: 'tokyo', name: 'Tokyo', label: 'Tokyo, Japan', country: 'Japan', countryCode: 'JP', latitude: 35, longitude: 139 };
const osaka = { ...tokyo, placeId: 'osaka', name: 'Osaka', label: 'Osaka, Japan' };
const trip = createTrip({ title: 'Japan', destination: 'Japan', startDate: '2027-01-01', endDate: '2027-01-04', currency: 'JPY', budgetMinor: 20000, travellers: 1, diet: 'none', interests: '', stays: [{ destination: tokyo, days: 2 }, { destination: osaka, days: 2 }] });
beforeEach(() => { jest.clearAllMocks(); jest.mocked(session.current).mockReturnValue({ sub: 'traveller' } as never); });

test('withdrawal during token acquisition stops AI trip checks before sending', async () => {
  let allowed = true, tokens = 0;
  jest.mocked(AsyncStorage.getItem).mockImplementation(async () => allowed ? 'allowed' : 'denied');
  jest.mocked(session.accessToken).mockImplementation(async () => { if (++tokens >= 3) allowed = false; return 'fixture'; });
  jest.mocked(fetch).mockImplementation(async (_url, init) => ({ok:true,status:200,json:async()=>init?.method==='GET'?null:{revision:'revision-1'}}) as Awaited<ReturnType<typeof fetch>>);
  try {
    const result = await checkTripReadiness(trip, new AbortController().signal);
    expect(jest.mocked(fetch).mock.calls.filter(([url])=>String(url).endsWith('/v1/trip-manager'))).toHaveLength(0);
    expect(result[0].error).toContain('unavailable');
  } finally {
    jest.mocked(AsyncStorage.getItem).mockImplementation(async key=>key.startsWith('roamie.ai-consent.')?'allowed':null);
    jest.mocked(session.accessToken).mockResolvedValue('fixture');
  }
});

test('a new profile is created and checks reuse selected coordinates when search is unavailable', async () => {
  const sent: any[] = [];
  jest.mocked(fetch).mockImplementation(async (_url, init) => {
    if (String(_url).endsWith('/destinations/search')) throw new Error('Search unavailable');
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (init?.method === 'GET') return { ok: false, status: 409, json: async () => ({ error: 'profile_changed' }) } as Awaited<ReturnType<typeof fetch>>;
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
  expect(sent[0].request.prompt.toLowerCase()).toContain('weather');
  expect(sent[0].request.prompt.toLowerCase()).not.toContain('entry');
  expect(sent[1].request.prompt.toLowerCase()).toContain('entry');
  expect(sent[1].request.prompt.toLowerCase()).not.toContain('weather');
});

test('an account switch prevents saving or returning another account profile', async () => {
  jest.mocked(fetch).mockImplementation(async () => { jest.mocked(session.current).mockReturnValue({ sub: 'other' } as never); return { ok: true } as Awaited<ReturnType<typeof fetch>>; });
  await expect(checkTripReadiness(trip, new AbortController().signal)).rejects.toThrow('account changed');
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('each destination gets time to complete its checks after the previous city', async () => {
  jest.useFakeTimers();
  try {
    jest.mocked(fetch).mockImplementation(async (_url, init) => {
      if (init?.method !== 'POST') return { ok: true, json: async () => ({ revision: 'revision-1', preferences: {} }) } as Awaited<ReturnType<typeof fetch>>;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 70000);
        init.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')); }, { once: true });
      });
      return { ok: true, json: async () => ({ profile_revision: 'revision-1', response: { status: 'ok', recommendations: [], limitations: [] } }) } as Awaited<ReturnType<typeof fetch>>;
    });
    const result = checkTripReadiness(trip, new AbortController().signal);
    const completed = expect(result).resolves.toEqual([
      expect.objectContaining({ destination: tokyo.label, weather: expect.any(Object), entry: expect.any(Object) }),
      expect.objectContaining({ destination: osaka.label, weather: expect.any(Object), entry: expect.any(Object) }),
    ]);
    await jest.advanceTimersByTimeAsync(140000);
    await completed;
    expect(jest.getTimerCount()).toBe(0);
  } finally { jest.useRealTimers(); }
});
