import { expect, jest, test } from '@jest/globals';
import { act, render, screen } from '@testing-library/react-native';
import { OfflineTools } from '../../components/offline-tools';
import * as NativeBridge from '../../../modules/roamie-offline';

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'fr', regionCode: 'FR' }] }));
jest.mock('expo-device', () => ({ totalMemory: 8 * 1024 ** 3 }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}) }));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: 'file:///documents/', getInfoAsync: jest.fn(async () => ({ exists: false })) }));
jest.mock('../../../modules/roamie-offline', () => ({ __esModule: true, offlineNative: () => ({
  downloadedLanguages: async () => ['fr'],
  supportedTextLanguages: async () => ['en', 'fr'],
  isTranslationReady: async () => true,
  canRemoveLanguagePacks: async () => true,
  offlineVoices: async () => [{ identifier: 'en', language: 'en-US' }, { identifier: 'fr', language: 'fr-FR' }],
  ocrLanguages: async () => ['en', 'fr'],
}) }));

test('a French phone starts with a different partner language', async () => {
  await render(<OfflineTools onClose={() => {}} />);
  expect(screen.getByRole('button', { name: 'Your offline language: French' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Other offline language: English' })).toBeTruthy();
});

test('downloaded text does not claim microphone readiness without a speech model', async () => {
  await render(<OfflineTools mine="en" partner="fr" onClose={() => {}} />);
  expect(await screen.findByText('English ↔ French · Ready on this phone')).toBeTruthy();
  expect(screen.getByText('Small speech model · Not downloaded')).toBeTruthy();
  expect(screen.getByText('Speech detector · Not downloaded')).toBeTruthy();
  expect(screen.queryByText('Main translator preference')).toBeNull();
});

test('pending device checks do not label supported languages as unavailable', async () => {
  let finish!: (value: string[]) => void;
  const pending = new Promise<string[]>(resolve => { finish = resolve; });
  const native = NativeBridge.offlineNative()!;
  const spy = jest.spyOn(NativeBridge, 'offlineNative').mockReturnValue({ ...native, downloadedLanguages: () => pending });
  try {
    await render(<OfflineTools mine="en" partner="fr" onClose={() => {}} />);
    expect(screen.getByText('Checking offline assets…')).toBeTruthy();
    expect(screen.queryByText('This language needs cloud translation. Its offline text pack is not available on this device.')).toBeNull();
    await act(async () => { finish(['fr']); });
    expect(await screen.findByText('English ↔ French · Ready on this phone')).toBeTruthy();
  } finally { finish(['fr']); spy.mockRestore(); }
});
