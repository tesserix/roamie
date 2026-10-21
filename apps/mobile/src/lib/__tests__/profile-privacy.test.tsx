import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';
import { ProfileSettings } from '../../components/profile-settings';
import { AccessibilityProvider } from '../accessibility';
import { session, type AuthConfig } from '../auth-client';

jest.mock('@react-native-async-storage/async-storage', () => ({getItem:jest.fn(async()=>null),setItem:jest.fn(async()=>{})}));
jest.mock('expo-secure-store', () => ({getItemAsync:jest.fn(async()=>null),setItemAsync:jest.fn(async()=>{}),deleteItemAsync:jest.fn(async()=>{})}));
jest.mock('react-native-safe-area-context', () => ({useSafeAreaInsets:()=>({top:0,bottom:0,left:0,right:0})}));
jest.mock('expo-notifications', () => ({cancelAllScheduledNotificationsAsync:jest.fn(async()=>{})}));

const config: AuthConfig = {issuer:'https://auth.tesserix.app',organizationId:'org',projectId:'project',clientIds:{ios:'ios',android:'android'},providers:{google:'g',apple:'a'}};
const previousAuth = process.env.EXPO_PUBLIC_AUTH_ENABLED;
const originalFetch = global.fetch;

beforeEach(async () => {
  process.env.EXPO_PUBLIC_AUTH_ENABLED = 'true';
  await session.clear();
  jest.clearAllMocks();
  global.fetch = jest.fn<typeof fetch>().mockResolvedValue({ok:true} as Response);
});
afterEach(async () => {
  await session.clear();
  jest.restoreAllMocks();
  global.fetch = originalFetch;
  if (previousAuth === undefined) delete process.env.EXPO_PUBLIC_AUTH_ENABLED;
  else process.env.EXPO_PUBLIC_AUTH_ENABLED = previousAuth;
});

test.each<typeof Platform.OS>(['ios', 'android'])('%s signs out from the profile and revokes the saved session', async platform => {
  jest.replaceProperty(Platform, 'OS', platform);
  await session.accept({accessToken:'access',refreshToken:'refresh',expiresIn:600}, {sub:'traveller',email:'traveller@example.test',name:'Traveller'}, config, platform as 'ios' | 'android');
  await render(<AccessibilityProvider><ProfileSettings /></AccessibilityProvider>);
  expect(screen.queryByRole('button', {name:'Sign out'})).toBeNull();
  await fireEvent.press(screen.getByRole('button', {name:'Profile settings'}));
  expect(screen.getByRole('header', {name:'Account'})).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', {name:'Sign out'}));
  await waitFor(() => expect(session.current()).toBeNull());
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('roamie.auth.v1');
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('roamie.auth.pending.v1');
  expect(Notifications.cancelAllScheduledNotificationsAsync).toHaveBeenCalledTimes(1);
  expect(global.fetch).toHaveBeenCalledWith('https://auth.tesserix.app/oauth/v2/revoke', expect.objectContaining({
    method:'POST', body:expect.stringContaining(`client_id=${platform}`),
  }));
  expect(screen.queryByRole('button', {name:'Done'})).toBeNull();
});

test.each<typeof Platform.OS>(['ios', 'android'])('%s shows privacy actions only inside the signed-in profile', async platform => {
  jest.replaceProperty(Platform, 'OS', platform);
  await session.accept({accessToken:'access',refreshToken:'refresh',expiresIn:600}, {sub:'traveller',email:'traveller@example.test',name:'Traveller'}, config, platform as 'ios' | 'android');
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined).mockClear();
  await render(<AccessibilityProvider><ProfileSettings /></AccessibilityProvider>);
  expect(screen.queryByRole('link', {name:'Privacy policy'})).toBeNull();
  expect(screen.queryByRole('button', {name:'Delete my account'})).toBeNull();
  await fireEvent.press(screen.getByRole('button', {name:'Profile settings'}));
  await fireEvent.press(screen.getByRole('link', {name:'Privacy policy'}));
  expect(open).toHaveBeenLastCalledWith('https://roamie-api.tesserix.app/privacy');
  await fireEvent.press(screen.getByRole('button', {name:'Delete my account'}));
  expect(screen.getByText('Delete your Roamie account?')).toBeTruthy();
  expect(open).toHaveBeenCalledTimes(1);
  await act(async () => { await session.clear(); });
  await waitFor(() => expect(screen.queryByRole('link', {name:'Privacy policy'})).toBeNull());
  expect(screen.queryByRole('button', {name:'Delete my account'})).toBeNull();
});

test.each<typeof Platform.OS>(['ios', 'android'])('%s hides account privacy actions from signed-out settings', async platform => {
  jest.replaceProperty(Platform, 'OS', platform);
  await render(<AccessibilityProvider><ProfileSettings /></AccessibilityProvider>);
  await fireEvent.press(screen.getByRole('button', {name:'Profile settings'}));
  expect(screen.queryByRole('button', {name:'Sign out'})).toBeNull();
  expect(screen.queryByRole('header', {name:'Account'})).toBeNull();
  expect(screen.queryByRole('link', {name:'Privacy policy'})).toBeNull();
  expect(screen.queryByRole('button', {name:'Delete my account'})).toBeNull();
});
