import { beforeEach, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { OfflineTools } from '../../components/offline-tools';
import { OfflineReadiness } from '../../components/offline-readiness';
import { SPEECH_MODELS } from '../speech-models';
import { saveTranslationPreferences } from '../translation-preferences';

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));
jest.mock('expo-device', () => ({ totalMemory: 8 * 1024 ** 3 }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}) }));
jest.mock('expo-network', () => ({ getNetworkStateAsync: async () => ({ type: 'WIFI', isConnected: true, isInternetReachable: true }), NetworkStateType: { WIFI: 'WIFI' }, addNetworkStateListener: () => ({ remove() {} }) }));
jest.mock('expo-notifications', () => ({ cancelAllScheduledNotificationsAsync: jest.fn(async () => {}) }));
jest.mock('expo-file-system/legacy', () => {
  const files = new Map<string, { size: number; hash: string; modified: number }>();
  return {
    __esModule: true, __files: files, documentDirectory: 'file:///documents/', FileSystemSessionType: { FOREGROUND: 0 },
    getInfoAsync: jest.fn(async (uri: string) => { const file = files.get(uri); return file ? { exists: true, isDirectory: false, uri, size: file.size, modificationTime: file.modified } : { exists: false, isDirectory: false, uri }; }),
    getFreeDiskStorageAsync: async () => 10 * 1024 ** 3,
    makeDirectoryAsync: async () => {},
    deleteAsync: jest.fn(async (uri: string) => { files.delete(uri); }),
    moveAsync: async ({ from, to }: { from: string; to: string }) => { const file = files.get(from); if (!file) throw new Error('Missing temporary download'); files.set(to, file); files.delete(from); },
    createDownloadResumable: jest.fn((url: string, uri: string) => ({
      downloadAsync: async () => {
        const { SPEECH_MODELS } = jest.requireActual<typeof import('../speech-models')>('../speech-models');
        const artifact = Object.values(SPEECH_MODELS).find(model => url.endsWith(model.file))!;
        files.set(uri, { size: artifact.bytes, hash: artifact.sha256, modified: 2 });
        return { status: 200 };
      },
      cancelAsync: async () => {},
    })),
  };
});
jest.mock('../../../modules/roamie-offline', () => ({ __esModule: true, offlineNative: () => ({
  supportedTextLanguages: async () => ['en', 'vi'], downloadedLanguages: async () => [],
  isTranslationReady: async () => true, canRemoveLanguagePacks: async () => false,
  offlineVoices: async () => [], ocrLanguages: async () => ['en', 'vi'],
  sha256: async (uri: string) => jest.requireMock<{ __files: Map<string, { hash: string }> }>('expo-file-system/legacy').__files.get(uri)?.hash,
}) }));

const files = jest.requireMock<{ __files: Map<string, { size: number; hash: string; modified: number }> }>('expo-file-system/legacy').__files;

beforeEach(async () => {
  files.clear(); jest.clearAllMocks();
  files.set(`file:///documents/offline-models/${SPEECH_MODELS.base.file}`, { size: SPEECH_MODELS.base.bytes, hash: SPEECH_MODELS.base.sha256, modified: 1 });
  await saveTranslationPreferences({ mode: 'offline', speechModel: 'base' });
});

test('finishing a partial speech download reuses the verified model and downloads only its missing detector', async () => {
  await render(<OfflineTools mine="en" partner="vi" signedIn onClose={() => {}} />);
  expect(await screen.findByText('Base speech model · Downloaded and verified · 60 MB')).toBeTruthy();
  expect(screen.getByText('Speech detector · Not downloaded')).toBeTruthy();
  expect(screen.queryByText('Offline conversation is ready')).toBeNull();
  await fireEvent.press(await screen.findByRole('button', { name: 'Finish Base speech download' }));
  expect(await screen.findByText('Offline conversation is ready')).toBeTruthy();
  expect(screen.getByText('Speech detector · Downloaded and verified')).toBeTruthy();
  expect(FileSystem.createDownloadResumable).toHaveBeenCalledTimes(1);
  expect(FileSystem.createDownloadResumable).toHaveBeenCalledWith(expect.stringContaining(SPEECH_MODELS.vad.file), expect.any(String), expect.any(Object), expect.any(Function));
  expect(screen.getByRole('button', { name: 'Base selected' })).toBeTruthy();
});

test('downloaded assets do not imply the main translator will work offline when Cloud mode is selected', async () => {
  files.set(`file:///documents/offline-models/${SPEECH_MODELS.vad.file}`, { size: SPEECH_MODELS.vad.bytes, hash: SPEECH_MODELS.vad.sha256, modified: 1 });
  await saveTranslationPreferences({ mode: 'cloud' });
  await render(<OfflineReadiness mine="en" partner="vi" />);
  expect(await screen.findByText('Base speech model · Downloaded and verified · 60 MB')).toBeTruthy();
  expect(screen.getByText('Translation mode · Cloud (internet required)')).toBeTruthy();
  expect(screen.queryByText('Offline conversation is ready')).toBeNull();
  expect(screen.getByText('Offline downloads are ready. Select Automatic or Offline only to use them.')).toBeTruthy();
});

test('Refresh updates both the status panel and the model controls from files on the device', async () => {
  await render(<OfflineTools mine="en" partner="vi" signedIn onClose={() => {}} />);
  await screen.findByRole('button', { name: 'Finish Base speech download' });
  files.set(`file:///documents/offline-models/${SPEECH_MODELS.vad.file}`, { size: SPEECH_MODELS.vad.bytes, hash: SPEECH_MODELS.vad.sha256, modified: 3 });
  await fireEvent.press(screen.getByRole('button', { name: 'Refresh offline status' }));
  expect(await screen.findByText('Offline conversation is ready')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Base selected' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Finish Base speech download' })).toBeNull();
});
