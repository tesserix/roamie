import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { ProfileSettings } from '../../components/profile-settings';
import { AccessibilityProvider } from '../accessibility';
import { offlineNative } from '../../../modules/roamie-offline';
import * as NativeBridge from '../../../modules/roamie-offline';

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en', regionCode: 'AU' }] }));
jest.mock('expo-device', () => ({ totalMemory: 8 * 1024 ** 3 }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: 'file:///documents/', getInfoAsync: jest.fn(async () => ({ exists: false })) }));
jest.mock('expo-network', () => ({ getNetworkStateAsync: async () => ({ type: 'WIFI' }), NetworkStateType: { WIFI: 'WIFI' } }));
jest.mock('expo-notifications', () => ({ cancelAllScheduledNotificationsAsync: jest.fn(async () => {}) }));
jest.mock('../../../modules/roamie-offline', () => {
  const downloaded = new Set<string>();
  const native = {
    downloadedLanguages: async () => [...downloaded],
    supportedTextLanguages: async () => ['en', 'fr', 'vi', 'th', 'ko'],
    isTranslationReady: async (from: string, to: string) => [from, to].every(language => language === 'en' || downloaded.has(language)),
    canRemoveLanguagePacks: async () => true,
    offlineVoices: async () => [],
    ocrLanguages: async () => ['en', 'fr', 'vi', 'ko'],
    downloadLanguage: jest.fn(async (language: string) => { downloaded.add(language); }),
    removeLanguage: jest.fn(async (language: string) => { downloaded.delete(language); }),
  };
  return { __esModule: true, offlineNative: () => native };
});

beforeEach(async () => {
  for (const language of await offlineNative()!.downloadedLanguages()) await offlineNative()!.removeLanguage(language);
  jest.clearAllMocks();
});
afterEach(() => { jest.restoreAllMocks(); });

test('the offline shortcut opens downloads directly and closes back to Translate', async () => {
  const onOpenChange = jest.fn();
  await render(<AccessibilityProvider><ProfileSettings entryPoint="offline" mine="en" partner="vi" onOpenChange={onOpenChange} /></AccessibilityProvider>);
  await fireEvent.press(screen.getByRole('button', { name: 'Open offline languages' }));
  expect(await screen.findByRole('header', { name: 'Offline translation' })).toBeTruthy();
  expect(onOpenChange).toHaveBeenLastCalledWith(true);
  await fireEvent.press(screen.getByRole('button', { name: 'Close offline translation' }));
  expect(screen.queryByRole('header', { name: 'Profile & settings' })).toBeNull();
  expect(screen.queryByRole('header', { name: 'Offline translation' })).toBeNull();
  expect(onOpenChange).toHaveBeenLastCalledWith(false);
});

test.each<typeof Platform.OS>(['ios', 'android'])('%s opens Offline languages inside Profile and returns to settings', async platform => {
  jest.replaceProperty(Platform, 'OS', platform);
  await render(<AccessibilityProvider><ProfileSettings /></AccessibilityProvider>);
  expect(screen.queryByRole('button', { name: 'Offline languages' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Profile settings' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Offline languages' }));
  expect(await screen.findByRole('header', { name: 'Offline translation' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Your offline language: English' })).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Close offline translation' }));
  expect(screen.getByRole('header', { name: 'Profile & settings' })).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
  expect(screen.queryByRole('button', { name: 'Offline languages' })).toBeNull();
});

test.each(['ios', 'android'].flatMap(platform => [['vi', 'Vietnamese'], ['th', 'Thai'], ['ko', 'Korean']].map(([code, name]) => [platform, code, name])))('%s selects and downloads %s from Profile', async (platform, code, name) => {
  jest.replaceProperty(Platform, 'OS', platform as typeof Platform.OS);
  await render(<AccessibilityProvider><ProfileSettings /></AccessibilityProvider>);
  await fireEvent.press(screen.getByRole('button', { name: 'Profile settings' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Offline languages' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Other offline language: French' }));
  await fireEvent.changeText(screen.getByLabelText('Search languages'), name);
  await fireEvent.press(screen.getByRole('button', { name }));
  const download = await screen.findByRole('button', { name: `Download ${name}${platform === 'android' ? ' · about 30 MB' : ''}` });
  expect(download).toBeEnabled();
  await fireEvent.press(download);
  expect(await screen.findByText('Text pack downloaded')).toBeTruthy();
  expect(await screen.findByText(`English ↔ ${name} · Ready on this phone`)).toBeTruthy();
  expect(offlineNative()!.downloadLanguage).toHaveBeenCalledWith(code, false);
});

test('a failed download explains the problem and can be retried from Profile', async () => {
  jest.spyOn(offlineNative()!, 'downloadLanguage').mockRejectedValueOnce(new Error('The download was interrupted. Please retry.'));
  await render(<AccessibilityProvider><ProfileSettings mine="en" partner="vi" /></AccessibilityProvider>);
  await fireEvent.press(screen.getByRole('button', { name: 'Profile settings' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Offline languages' }));
  const label = `Download Vietnamese${Platform.OS === 'android' ? ' · about 30 MB' : ''}`;
  await fireEvent.press(await screen.findByRole('button', { name: label }));
  expect(await screen.findByRole('alert')).toHaveTextContent('The download was interrupted. Please retry.');
  expect(screen.getByRole('button', { name: label })).toBeEnabled();
  await fireEvent.press(screen.getByRole('button', { name: label }));
  expect(await screen.findByText('English ↔ Vietnamese · Ready on this phone')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

test('an older installation explains why downloads are unavailable and can return to Profile', async () => {
  jest.spyOn(NativeBridge, 'offlineNative').mockReturnValue(null);
  await render(<AccessibilityProvider><ProfileSettings /></AccessibilityProvider>);
  await fireEvent.press(screen.getByRole('button', { name: 'Profile settings' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Offline languages' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Offline models need a new Roamie app build. This installation cannot download or run them yet.');
  expect(screen.getByRole('button', { name: 'Download Small speech model' })).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: 'Close offline translation' }));
  expect(screen.getByRole('header', { name: 'Profile & settings' })).toBeTruthy();
});
