import { afterEach, expect, jest, test } from '@jest/globals';
import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { AuthProvider, useAuth } from '../auth';
import { session } from '../auth-client';

jest.mock('expo-auth-session', () => ({}));
jest.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: jest.fn() }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), deleteItemAsync: jest.fn(), setItemAsync: jest.fn() }));
const previous = process.env.EXPO_PUBLIC_AUTH_ENABLED;
afterEach(() => { process.env.EXPO_PUBLIC_AUTH_ENABLED = previous; Object.defineProperty(globalThis, '__DEV__', { value: true, writable: true }); jest.clearAllMocks(); });
function Identity() {
 const auth = useAuth();
 return <Text>{auth.ready ? auth.customer?.sub ?? 'signed-out' : 'loading'}</Text>;
}
test('auth=false opens a separate development account without contacting Zitadel or touching saved credentials', async () => {
 process.env.EXPO_PUBLIC_AUTH_ENABLED = 'false';
 global.fetch = jest.fn<typeof fetch>();
 await render(<AuthProvider><Identity /></AuthProvider>);
 expect(await screen.findByText('local-development')).toBeTruthy();
 expect(session.current()?.sub).toBe('local-development');
 await expect(session.accessToken()).resolves.toBe('local-development');
 await act(async () => { await session.clear(); });
 expect(global.fetch).not.toHaveBeenCalled();
 expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
 expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
});
test('a release build ignores auth=false and still requires a real session', async () => {
 process.env.EXPO_PUBLIC_AUTH_ENABLED = 'false';
 Object.defineProperty(globalThis, '__DEV__', { value: false, writable: true });
 expect(session.current()).toBeNull();
 await expect(session.accessToken()).rejects.toThrow('Sign in');
});
