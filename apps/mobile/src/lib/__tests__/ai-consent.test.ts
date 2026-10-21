import { beforeEach, expect, jest, test } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';
import { fetch } from 'expo/fetch';
import { apiRequest } from '../trip-api';
import { session } from '../auth-client';
import { aiConsentKey, withdrawAIConsent, requireAIConsent, reviewAIConsent, usesAI } from '../ai-consent';

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn() }));
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('../auth-client', () => ({ API_BASE: 'https://api.example.test', session: {
  current: jest.fn(() => ({ sub: 'alice' })), revision: jest.fn(() => 1),
  accessToken: jest.fn(async () => 'token'), clear: jest.fn(async () => {}),
} }));

const stored = new Map<string, string>();
let account = '', sequence = 0;
beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  stored.clear();
  account = `alice-${++sequence}`;
  jest.mocked(session.current).mockReturnValue({ sub: account } as ReturnType<typeof session.current>);
  jest.mocked(session.revision).mockReturnValue(1);
  jest.mocked(AsyncStorage.getItem).mockImplementation(async key => stored.get(key) ?? null);
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => { stored.set(key, value); });
  jest.mocked(fetch).mockResolvedValue({ ok: true, status: 200, json: async () => ({ translation: 'Bonjour' }) } as Awaited<ReturnType<typeof fetch>>);
});

test('a declined choice is remembered without prompting on the next request', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const request = requireAIConsent(account);
  const rejected = expect(request).rejects.toThrow('sharing is off');
  for (let i = 0; i < 5; i++) await Promise.resolve();
  alert.mock.calls[0][2]?.find(button => button.text === 'Not now')?.onPress?.();
  await rejected;
  await expect(requireAIConsent(account)).rejects.toThrow('sharing is off');
  expect(alert).toHaveBeenCalledTimes(1);
  expect(stored.get(aiConsentKey(account))).toBe('denied');
  expect(fetch).not.toHaveBeenCalled();
});

test('concurrent AI requests share one disclosure and save permission before sending', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const requests = ['/v1/talk/turn', '/v1/signs/translate'].map(path => apiRequest(path, {}, res => res.json(), 1000));
  for (let i = 0; i < 5; i++) await Promise.resolve();
  expect(alert).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
  alert.mock.calls[0][2]?.find(button => button.text === 'Allow and continue')?.onPress?.();
  await Promise.all(requests);
  expect(stored.get(aiConsentKey(account))).toBe('allowed');
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('consent for another account never authorizes a new account', async () => {
  stored.set(aiConsentKey('different-account'), 'allowed');
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const request = requireAIConsent(account);
  const rejected = expect(request).rejects.toThrow('sharing is off');
  for (let i = 0; i < 5; i++) await Promise.resolve();
  expect(alert).toHaveBeenCalledTimes(1);
  alert.mock.calls[0][2]?.find(button => button.text === 'Not now')?.onPress?.();
  await rejected;
});

test('a session renewed while disclosure is open cannot authorize the old request', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const request = apiRequest('/v1/translate/text', {}, res => res.json(), 1000);
  const rejected = expect(request).rejects.toThrow('account changed');
  for (let i = 0; i < 5; i++) await Promise.resolve();
  jest.mocked(session.revision).mockReturnValue(2);
  alert.mock.calls[0][2]?.find(button => button.text === 'Allow and continue')?.onPress?.();
  await rejected;
  expect(fetch).not.toHaveBeenCalled();
  expect(stored.has(aiConsentKey(account))).toBe(false);
});

test('failure to read or save permission never sends content', async () => {
  jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('storage unavailable'));
  await expect(apiRequest('/v1/translate/text', {}, res => res.json(), 1000)).rejects.toThrow('storage unavailable');
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('storage unavailable'));
  const request = apiRequest('/v1/talk/turn', {}, res => res.json(), 1000);
  const rejected = expect(request).rejects.toThrow('storage unavailable');
  for (let i = 0; i < 5; i++) await Promise.resolve();
  alert.mock.calls[0][2]?.find(button => button.text === 'Allow and continue')?.onPress?.();
  await rejected;
  expect(fetch).not.toHaveBeenCalled();
});

test.each(['/v1/translate/text','/v1/talk/turn','/v1/talk/speech','/v1/signs/translate','/v1/receipts/extract','/v1/statements/extract','/v1/trips/plan','/v1/trip-manager','/v1/trips/trip-1/planning'])('%s requires AI consent before sending', path => {
  expect(usesAI(path, 'POST')).toBe(true);
});

test('non-AI requests and deletion remain available when AI sharing is off', async () => {
  await withdrawAIConsent(account);
  for (const [path, method] of [['/v1/fx', 'GET'], ['/v1/nearby','GET'], ['/v1/auth/deletion-request','POST'], ['/v1/trips/trip-1/planning','DELETE']] as const) {
    expect(usesAI(path, method)).toBe(false);
    await apiRequest(path, {}, res => res.json(), 1000, undefined, method);
  }
  expect(fetch).toHaveBeenCalledTimes(4);
});

test('cancelling while disclosure is open settles without sending the content', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const controller = new AbortController();
  const request = apiRequest('/v1/talk/turn', {}, res => res.json(), 1000, controller.signal);
  const outcome = expect(request).rejects.toThrow('cancelled');
  for (let i = 0; i < 5; i++) await Promise.resolve();
  controller.abort();
  await outcome;
  alert.mock.calls[0][2]?.find(button => button.text === 'Not now')?.onPress?.();
  expect(fetch).not.toHaveBeenCalled();
});

test('translation asks permission before sending content to AI', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const request = apiRequest('/v1/translate/text', { text: 'Hello' }, res => res.json(), 1000);
  await Promise.resolve(); await Promise.resolve();
  expect(fetch).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalledWith('AI data sharing', expect.stringContaining('Google Cloud'), expect.any(Array), expect.any(Object));
  alert.mock.calls[0][2]?.find(button => button.text === 'Allow and continue')?.onPress?.();
  await expect(request).resolves.toEqual({ translation: 'Bonjour' });
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('withdrawal cannot be overwritten by a previously opened disclosure', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const request = reviewAIConsent(account);
  const outcome = expect(request).rejects.toThrow('sharing is off');
  await withdrawAIConsent(account);
  alert.mock.calls[0][2]?.find(button => button.text === 'Allow and continue')?.onPress?.();
  await outcome;
  expect(stored.get(aiConsentKey(account))).toBe('denied');
});
