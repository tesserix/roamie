import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking, Platform } from 'react-native';
import { ProfileSettings } from '../../components/profile-settings';
import { AccessibilityProvider } from '../accessibility';
import { session, type AuthConfig } from '../auth-client';

jest.mock('@react-native-async-storage/async-storage', () => ({getItem:jest.fn(async()=>null),setItem:jest.fn(async()=>{})}));
jest.mock('expo-secure-store', () => ({getItemAsync:jest.fn(async()=>null),setItemAsync:jest.fn(async()=>{}),deleteItemAsync:jest.fn(async()=>{})}));
jest.mock('react-native-safe-area-context', () => ({useSafeAreaInsets:()=>({top:0,bottom:0,left:0,right:0})}));

const config: AuthConfig = {issuer:'https://auth.tesserix.app',organizationId:'org',projectId:'project',clientIds:{ios:'ios',android:'android'},providers:{google:'g',apple:'a'}};
const previousAuth = process.env.EXPO_PUBLIC_AUTH_ENABLED;

beforeEach(async () => {
  process.env.EXPO_PUBLIC_AUTH_ENABLED = 'true';
  await session.clear();
});
afterEach(async () => {
  await session.clear();
  jest.restoreAllMocks();
  if (previousAuth === undefined) delete process.env.EXPO_PUBLIC_AUTH_ENABLED;
  else process.env.EXPO_PUBLIC_AUTH_ENABLED = previousAuth;
});

test.each<typeof Platform.OS>(['ios', 'android'])('%s shows privacy actions only inside the signed-in profile', async platform => {
  jest.replaceProperty(Platform, 'OS', platform);
  await session.accept({accessToken:'access',refreshToken:'refresh',expiresIn:600}, {sub:'traveller',email:'traveller@example.test',name:'Traveller'}, config, platform as 'ios' | 'android');
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  await render(<AccessibilityProvider><ProfileSettings /></AccessibilityProvider>);
  expect(screen.queryByRole('link', {name:'Privacy policy'})).toBeNull();
  expect(screen.queryByRole('link', {name:'Delete my account'})).toBeNull();
  await fireEvent.press(screen.getByRole('button', {name:'Profile settings'}));
  await fireEvent.press(screen.getByRole('link', {name:'Privacy policy'}));
  expect(open).toHaveBeenLastCalledWith('https://roamie-api.tesserix.app/privacy');
  await fireEvent.press(screen.getByRole('link', {name:'Delete my account'}));
  expect(open).toHaveBeenLastCalledWith('https://roamie-api.tesserix.app/account-deletion');
  await act(async () => { await session.clear(); });
  await waitFor(() => expect(screen.queryByRole('link', {name:'Privacy policy'})).toBeNull());
  expect(screen.queryByRole('link', {name:'Delete my account'})).toBeNull();
});

test.each<typeof Platform.OS>(['ios', 'android'])('%s hides account privacy actions from signed-out settings', async platform => {
  jest.replaceProperty(Platform, 'OS', platform);
  await render(<AccessibilityProvider><ProfileSettings /></AccessibilityProvider>);
  await fireEvent.press(screen.getByRole('button', {name:'Profile settings'}));
  expect(screen.queryByRole('link', {name:'Privacy policy'})).toBeNull();
  expect(screen.queryByRole('link', {name:'Delete my account'})).toBeNull();
});
