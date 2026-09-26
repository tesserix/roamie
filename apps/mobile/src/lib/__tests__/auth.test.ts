import { beforeEach, expect, jest, test } from '@jest/globals';
import * as SecureStore from 'expo-secure-store';
import * as AuthSession from 'expo-auth-session';
import { fetchCustomer, loadAuthConfig, providersFor, session, type AuthConfig } from '../auth-client';
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn() }));
jest.mock('expo-auth-session', () => ({ refreshAsync: jest.fn(), revokeAsync: jest.fn(), TokenTypeHint: { RefreshToken: 'refresh_token' } }));

const config: AuthConfig = { issuer: 'https://auth.tesserix.app', organizationId: 'org', projectId: 'project', clientIds: { ios: 'ios-client', android: 'android-client' }, providers: { google: 'google-id', facebook: 'facebook-id', apple: 'apple-id' } };
const user = { sub: 'a', email: 'a@example.com', name: 'A' };
beforeEach(async () => { jest.clearAllMocks(); await session.clear(); });

test('offers only social providers appropriate for the platform', () => {
  expect(providersFor('ios')).toEqual(['google', 'facebook', 'apple']);
  expect(providersFor('android')).toEqual(['google', 'facebook']);
  expect(providersFor('web')).toEqual([]);
});

test('coalesces rotating refresh tokens and persists the new refresh token securely', async () => {
  jest.mocked(AuthSession.refreshAsync).mockResolvedValue({ accessToken: 'new-access', refreshToken: 'rotated-refresh', expiresIn: 600, issuedAt: 1000 } as AuthSession.TokenResponse);
  await session.accept({ accessToken: 'expired-access', refreshToken: 'old-refresh', expiresIn: 1, issuedAt: 0 }, user, config, 'ios');
  const values = await Promise.all([session.accessToken(), session.accessToken()]);
  expect(values).toEqual(['new-access', 'new-access']);
  expect(AuthSession.refreshAsync).toHaveBeenCalledTimes(1);
  expect(SecureStore.setItemAsync).toHaveBeenLastCalledWith(expect.any(String), expect.stringContaining('rotated-refresh'), expect.any(Object));
});

test('logout prevents an in-flight refresh from restoring credentials', async () => {
  let finish!: (value: object) => void;
  jest.mocked(AuthSession.refreshAsync).mockImplementation(() => new Promise<AuthSession.TokenResponse>(resolve => { finish = value => resolve(value as AuthSession.TokenResponse); }));
  await session.accept({ accessToken: 'expired', refreshToken: 'old', expiresIn: 1, issuedAt: 0 }, user, config, 'ios');
  const pending = session.accessToken();
  await session.clear();
  finish({ accessToken: 'late-access', refreshToken: 'late-refresh', expiresIn: 600, issuedAt: 1000 } as AuthSession.TokenResponse);
  await expect(pending).rejects.toThrow('Sign in');
  expect(session.current()).toBeNull();
});

test('a failed account verification on restore never exposes cached account data', async () => {
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue(JSON.stringify({ refreshToken: 'old', customer: user, config, platform: 'ios' }));
  jest.mocked(AuthSession.refreshAsync).mockResolvedValue({ accessToken: 'new', refreshToken: 'rotated', expiresIn: 600, issuedAt: Date.now() / 1000 } as AuthSession.TokenResponse);
  global.fetch = jest.fn<typeof fetch>().mockResolvedValue({ ok: false, status: 503 } as Response);
  const observed: unknown[] = [];
  const unsubscribe = session.subscribe(() => observed.push(session.current()));
  try {
    await expect(session.restore(config, 'ios')).rejects.toThrow();
    expect(observed.every(customer => customer === null)).toBe(true);
    expect(session.current()).toBeNull();
  } finally { unsubscribe(); }
});

test('an expired saved refresh token returns to sign-in instead of trapping retries', async () => {
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue(JSON.stringify({ refreshToken: 'expired', customer: user, config, platform: 'ios' }));
  jest.mocked(AuthSession.refreshAsync).mockRejectedValue(Object.assign(new Error('expired'), { code: 'invalid_grant' }));
  await expect(session.restore(config, 'ios')).resolves.toBeUndefined();
  expect(session.current()).toBeNull();
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledTimes(2);
});


test('logout finishes locally when remote revocation never responds', async () => {
  jest.useFakeTimers();
  try {
    await session.accept({ accessToken: 'access', refreshToken: 'refresh', expiresIn: 600 }, user, config, 'ios');
    jest.mocked(AuthSession.revokeAsync).mockImplementation(() => new Promise<boolean>(() => {}));
    let outcome: boolean | undefined;
    const pending = session.logout().then(value => { outcome = value; });
    await jest.advanceTimersByTimeAsync(15_001);
    expect(session.current()).toBeNull();
    expect(AuthSession.revokeAsync).toHaveBeenCalledTimes(1);
    expect(outcome).toBe(false);
    await pending;
  } finally { jest.useRealTimers(); }
});


test('one unconfigured provider does not disable the available social providers', async () => {
  const available = { ...config, providers: { google: 'google-id', apple: 'apple-id' } };
  global.fetch = jest.fn<typeof fetch>().mockResolvedValue({ ok: true, json: async () => available } as Response);
  await expect(loadAuthConfig()).resolves.toEqual(available);
});

test('a forbidden account response does not claim that the email is unverified', async () => {
 global.fetch=jest.fn<typeof fetch>().mockResolvedValue({ok:false,status:403} as Response);
 await expect(fetchCustomer('test-access')).rejects.toThrow('This account could not be verified for Roamie. Try another account or contact support.');
});
