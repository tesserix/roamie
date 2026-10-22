import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import * as SecureStore from 'expo-secure-store';
import { session, type AuthConfig } from '../auth-client';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn() }));
jest.mock('expo-auth-session', () => ({ ...jest.requireActual<object>('expo-auth-session/build/TokenRequest'), TokenTypeHint: { RefreshToken: 'refresh_token' } }));

const config: AuthConfig = { issuer: 'https://auth.tesserix.app', organizationId: 'org', projectId: 'project', clientIds: { ios: 'ios-client', android: 'android-client' }, providers: { google: 'google' } };
const originalFetch = global.fetch;
beforeEach(async () => {
  jest.clearAllMocks();
  await session.clear();
  await session.accept({ accessToken: 'test-access', refreshToken: 'test-refresh+&=', expiresIn: 600 }, { sub: 'test-user', email: 'qa@example.test', name: 'QA' }, config, 'android');
});
afterEach(() => { global.fetch = originalFetch; jest.useRealTimers(); });

test('Zitadel empty JSON-labelled HTTP 200 confirms logout without parsing a body', async () => {
  const response = new Response('', { status: 200, headers: { 'content-type': 'application/json' } });
  const json = jest.spyOn(response, 'json');
  global.fetch = jest.fn<typeof global.fetch>().mockResolvedValue(response);
  await expect(session.logout()).resolves.toBe(true);
  expect(json).not.toHaveBeenCalled();
  expect(session.current()).toBeNull();
  expect(SecureStore.deleteItemAsync).toHaveBeenCalled();
  const [url, init] = jest.mocked(global.fetch).mock.calls[0];
  expect(url).toBe('https://auth.tesserix.app/oauth/v2/revoke');
  expect(init?.method).toBe('POST');
  const form = new URLSearchParams(init?.body as string);
  expect(form.get('client_id')).toBe('android-client');
  expect(form.get('token')).toBe('test-refresh+&=');
  expect(form.get('token_type_hint')).toBe('refresh_token');
});

test('a rejected revocation cannot be reported as remotely signed out', async () => {
  global.fetch = jest.fn<typeof global.fetch>().mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_client' }), { status: 401, headers: { 'content-type': 'application/json' } }));
  await expect(session.logout()).resolves.toBe(false);
  expect(session.current()).toBeNull();
});

test('a timed-out revocation aborts the network request and leaves local credentials cleared', async () => {
  jest.useFakeTimers();
  global.fetch = jest.fn<typeof global.fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })), { once: true });
  }));
  const pending = session.logout();
  await jest.advanceTimersByTimeAsync(15001);
  await expect(pending).resolves.toBe(false);
  expect(session.current()).toBeNull();
  expect(jest.mocked(global.fetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
});
