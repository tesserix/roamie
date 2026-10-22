import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as AuthSession from 'expo-auth-session';
import { Linking, Platform, Text } from 'react-native';
import SignIn from '../../components/sign-in';
import { AuthProvider, useAuth } from '../auth';
import { session } from '../auth-client';

const mockStore = new Map<string, string>();
const mockBrowsers: (() => void)[] = [];
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}) }));
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked-this-device-only',
  getItemAsync: async (key: string) => mockStore.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => { mockStore.set(key, value); },
  deleteItemAsync: async (key: string) => { mockStore.delete(key); },
}));
jest.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: jest.fn() }));
jest.mock('expo-auth-session', () => ({
  AuthRequest: function AuthRequest() { return { state: 'state-1', codeVerifier: 'verifier-1', makeAuthUrlAsync: async () => 'https://auth.tesserix.app/oauth/v2/authorize?state=state-1', promptAsync: () => new Promise(resolve => { mockBrowsers.push(() => resolve({ type: 'dismiss' })); }) }; },
  exchangeCodeAsync: jest.fn(),
  ResponseType: { Code: 'code' }, Prompt: { Login: 'login' },
}));
jest.mock('expo-router', () => ({ useIsFocused: () => false }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@expo/vector-icons/FontAwesome', () => ({ __esModule: true, default: () => null }));

const config = { issuer: 'https://auth.tesserix.app', organizationId: 'org', projectId: 'project', clientIds: { ios: 'ios', android: 'android' }, providers: { google: 'g' } };
function Who() { const { ready, customer } = useAuth(); return <Text>{ready ? customer?.email ?? 'signed out' : 'loading'}</Text>; }

beforeEach(async () => {
  jest.clearAllMocks();
  jest.mocked(AuthSession.exchangeCodeAsync).mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh', expiresIn: 600, issuedAt: Date.now() / 1000 } as AuthSession.TokenResponse);
  jest.replaceProperty(Platform, 'OS', 'android');
  jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(null);
  mockStore.clear();
  await session.clear();
  global.fetch = jest.fn<typeof fetch>(async input => String(input).endsWith('/v1/auth/me')
    ? { ok: true, status: 200, json: async () => ({ sub: 'traveller', email: 'traveller@example.com', name: 'Traveller' }) } as Response
    : { ok: true, status: 200, json: async () => config } as Response);
});
afterEach(async () => { await act(async () => { mockBrowsers.splice(0).forEach(close => close()); }); jest.restoreAllMocks(); });

async function startSignInThenLoseProcess() {
  const first = await render(<AuthProvider><SignIn /></AuthProvider>);
  await fireEvent.press(await screen.findByRole('button', { name: 'Continue with Google' }));
  await waitFor(() => expect(mockStore.size).toBe(1));
  await first.unmount();
}

test('android finishes sign-in when the app restarts from the auth redirect', async () => {
  await startSignInThenLoseProcess();
  jest.spyOn(Linking, 'getInitialURL').mockResolvedValue('roamie:/auth/callback?code=code-1&state=state-1');
  await render(<AuthProvider><Who /></AuthProvider>);
  expect(await screen.findByText('traveller@example.com')).toBeTruthy();
  expect(AuthSession.exchangeCodeAsync).toHaveBeenCalledWith(
    expect.objectContaining({ clientId: 'android', code: 'code-1', redirectUri: 'roamie:/auth/callback', extraParams: { code_verifier: 'verifier-1' } }),
    expect.objectContaining({ tokenEndpoint: 'https://auth.tesserix.app/oauth/v2/token' }));
});

test('a redirect whose state does not match the pending sign-in is ignored', async () => {
  await startSignInThenLoseProcess();
  jest.spyOn(Linking, 'getInitialURL').mockResolvedValue('roamie:/auth/callback?code=code-1&state=forged');
  await render(<AuthProvider><Who /></AuthProvider>);
  expect(await screen.findByText('signed out')).toBeTruthy();
  expect(AuthSession.exchangeCodeAsync).not.toHaveBeenCalled();
});

test('a pending sign-in is single use', async () => {
  await startSignInThenLoseProcess();
  const redirect = jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(null);
  await (await render(<AuthProvider><Who /></AuthProvider>)).unmount();
  redirect.mockResolvedValue('roamie:/auth/callback?code=code-1&state=state-1');
  await render(<AuthProvider><Who /></AuthProvider>);
  expect(await screen.findByText('signed out')).toBeTruthy();
  expect(AuthSession.exchangeCodeAsync).not.toHaveBeenCalled();
});

test('an expired pending sign-in is not resumed', async () => {
  const now = Date.now();
  await startSignInThenLoseProcess();
  jest.spyOn(Date, 'now').mockReturnValue(now + 31 * 60_000);
  jest.spyOn(Linking, 'getInitialURL').mockResolvedValue('roamie:/auth/callback?code=code-1&state=state-1');
  await render(<AuthProvider><Who /></AuthProvider>);
  expect(await screen.findByText('signed out')).toBeTruthy();
  expect(AuthSession.exchangeCodeAsync).not.toHaveBeenCalled();
});

test('a sign-in the traveller closes leaves nothing to resume', async () => {
  await render(<AuthProvider><SignIn /></AuthProvider>);
  await fireEvent.press(await screen.findByRole('button', { name: 'Continue with Google' }));
  await waitFor(() => expect(mockStore.size).toBe(1));
  mockBrowsers.splice(0).forEach(close => close());
  await waitFor(() => expect(mockStore.size).toBe(0));
});

test.each(['roamie:/auth/callback-extra', 'roamie://other/auth/callback', 'https://example.com/auth/callback'])('a callback to a different redirect URI is ignored: %s', async prefix => {
  await startSignInThenLoseProcess();
  jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(`${prefix}?code=code-1&state=state-1`);
  await render(<AuthProvider><Who /></AuthProvider>);
  expect(await screen.findByText('signed out')).toBeTruthy();
  expect(AuthSession.exchangeCodeAsync).not.toHaveBeenCalled();
});


test('signing out while the cold-start redirect is loading prevents session revival', async () => {
  await startSignInThenLoseProcess();
  let redirect!: (url: string) => void;
  const initialURL = jest.spyOn(Linking, 'getInitialURL').mockImplementation(() => new Promise(resolve => { redirect = resolve; }));
  await render(<AuthProvider><Who /></AuthProvider>);
  await waitFor(() => expect(initialURL).toHaveBeenCalled());
  await act(async () => { await session.logout(); });
  await act(async () => { redirect('roamie:/auth/callback?code=code-1&state=state-1'); });
  expect(await screen.findByText('signed out')).toBeTruthy();
  expect(AuthSession.exchangeCodeAsync).not.toHaveBeenCalled();
});


test('signing out discards a pending sign-in before a later cold-start redirect', async () => {
  await startSignInThenLoseProcess();
  await session.logout();
  jest.spyOn(Linking, 'getInitialURL').mockResolvedValue('roamie:/auth/callback?code=code-1&state=state-1');
  await render(<AuthProvider><Who /></AuthProvider>);
  expect(await screen.findByText('signed out')).toBeTruthy();
  expect(AuthSession.exchangeCodeAsync).not.toHaveBeenCalled();
});
