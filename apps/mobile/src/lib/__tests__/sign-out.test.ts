import { beforeEach, expect, jest, test } from '@jest/globals';
import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';
import { Alert } from 'react-native';
import { session, type AuthConfig } from '../auth-client';
import { signOut } from '../sign-out';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn() }));
jest.mock('expo-auth-session', () => ({ revokeAsync: jest.fn(), TokenTypeHint: { RefreshToken: 'refresh_token' } }));
jest.mock('expo-notifications', () => ({ cancelAllScheduledNotificationsAsync: jest.fn() }));

beforeEach(async () => { jest.clearAllMocks(); await session.clear(); });

test('notification failure cannot prevent clearing the customer and stored credentials', async () => {
  const config: AuthConfig = { issuer: 'https://auth.tesserix.app', organizationId: 'org', projectId: 'project', clientIds: { ios: 'ios', android: 'android' }, providers: { google: 'g', facebook: 'f', apple: 'a' } };
  await session.accept({ accessToken: 'access', refreshToken: 'refresh', expiresIn: 600 }, { sub: 'a', email: 'a@example.com', name: 'A' }, config, 'ios');
  jest.mocked(Notifications.cancelAllScheduledNotificationsAsync).mockRejectedValue(new Error('unavailable'));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  try {
    await signOut();
    expect(session.current()).toBeNull();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledTimes(2);
    expect(alert).toHaveBeenCalled();
  } finally { alert.mockRestore(); }
});
