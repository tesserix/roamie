import { beforeEach, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Device from 'expo-device';
import * as Network from 'expo-network';
import { TurboModuleRegistry } from 'react-native';
import { HYMT_MODEL } from '../text-models';
import { saveTranslationPreferences, translationPreferences } from '../translation-preferences';
import { OfflineTools } from '../../components/offline-tools';
import { OfflineReadiness } from '../../components/offline-readiness';
import { SPEECH_MODELS } from '../speech-models';

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));
jest.mock('expo-device', () => ({ __esModule: true, totalMemory: 8 * 1024 ** 3 }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}) }));
jest.mock('expo-network', () => ({ getNetworkStateAsync: jest.fn(async () => ({ type: 'WIFI', isConnected: true, isInternetReachable: true })), NetworkStateType: { WIFI: 'WIFI' }, addNetworkStateListener: jest.fn(() => ({ remove() {} })) }));
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
        const { HYMT_MODEL } = jest.requireActual<typeof import('../text-models')>('../text-models');
        const artifact = [...Object.values(SPEECH_MODELS), HYMT_MODEL].find(model => url.endsWith(model.file))!;
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

test('compact status keeps download details behind the info button', async () => {
  await saveTranslationPreferences({ mode: 'auto' });
  await render(<OfflineReadiness mine="en" partner="vi" compact />);
  expect(await screen.findByText('Online')).toBeTruthy();
  expect(screen.queryByText('Offline on this phone')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Translation connection details' }));
  expect(await screen.findByText('Your phone has an internet connection. Automatic tries downloaded models first and uses the cloud when needed.')).toBeTruthy();
  expect(await screen.findByText('Speech detector · Not downloaded')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Close connection details' }));
  expect(screen.queryByText('Offline on this phone')).toBeNull();
});

test.each([
  { mode: 'offline' as const, state: { isConnected: true, isInternetReachable: true }, label: 'Offline', reason: 'Offline only is selected.' },
  { mode: 'auto' as const, state: { isConnected: false, isInternetReachable: false }, label: 'Offline', reason: 'Your phone cannot reach the internet.' },
  { mode: 'auto' as const, state: { isConnected: true }, label: 'Connection unknown', reason: 'Roamie could not confirm internet access.' },
])('compact status explains $mode / $label without claiming missing downloads are ready', async ({ mode, state, label, reason }) => {
  await saveTranslationPreferences({ mode });
  jest.mocked(Network.getNetworkStateAsync).mockResolvedValueOnce(state);
  await render(<OfflineReadiness mine="en" partner="vi" compact />);
  expect(await screen.findByText(label)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Translation connection details' }));
  expect(await screen.findByText(new RegExp(reason))).toBeTruthy();
  expect(await screen.findByText('Speech detector · Not downloaded')).toBeTruthy();
  expect(screen.queryByText('Offline conversation is ready')).toBeNull();
});

test('connection changes update the compact badge and a late initial check cannot overwrite them', async () => {
  await saveTranslationPreferences({ mode: 'auto' });
  let finish!: (state: Network.NetworkState) => void;
  jest.mocked(Network.getNetworkStateAsync).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const remove = jest.fn();
  jest.mocked(Network.addNetworkStateListener).mockReturnValueOnce({ remove });
  const view = await render(<OfflineReadiness mine="en" partner="vi" compact />);
  const change = jest.mocked(Network.addNetworkStateListener).mock.calls.at(-1)![0];
  await act(() => change({ isConnected: false, isInternetReachable: false }));
  expect(screen.getByText('Offline')).toBeTruthy();
  await act(() => finish({ isConnected: true, isInternetReachable: true }));
  expect(screen.getByText('Offline')).toBeTruthy();
  await act(() => change({ isConnected: true, isInternetReachable: true }));
  expect(screen.getByText('Online')).toBeTruthy();
  await view.unmount();
  expect(remove).toHaveBeenCalledTimes(1);
});

test('finishing a partial speech download reuses the verified model and downloads only its missing detector', async () => {
  await render(<OfflineTools mine="en" partner="vi" signedIn onClose={() => {}} />);
  expect(await screen.findByText('Small speech model · Downloaded and verified · 60 MB')).toBeTruthy();
  expect(screen.getByText('Speech detector · Not downloaded')).toBeTruthy();
  expect(screen.queryByText('Offline conversation is ready')).toBeNull();
  await fireEvent.press(await screen.findByRole('button', { name: 'Finish Small speech download' }));
  expect(await screen.findByText('Offline conversation is ready')).toBeTruthy();
  expect(screen.getByText('Speech detector · Downloaded and verified')).toBeTruthy();
  expect(FileSystem.createDownloadResumable).toHaveBeenCalledTimes(1);
  expect(FileSystem.createDownloadResumable).toHaveBeenCalledWith(expect.stringContaining(SPEECH_MODELS.vad.file), expect.any(String), expect.any(Object), expect.any(Function));
  expect(screen.getByRole('button', { name: 'Small selected' })).toBeTruthy();
});

test('legacy Cloud-only settings show Automatic and retain usable offline downloads', async () => {
  files.set(`file:///documents/offline-models/${SPEECH_MODELS.vad.file}`, { size: SPEECH_MODELS.vad.bytes, hash: SPEECH_MODELS.vad.sha256, modified: 1 });
  await saveTranslationPreferences({ mode: 'cloud' });
  await render(<OfflineReadiness mine="en" partner="vi" />);
  expect(await screen.findByText('Small speech model · Downloaded and verified · 60 MB')).toBeTruthy();
  expect(screen.getByText('Translation mode · Automatic')).toBeTruthy();
  expect(screen.getByText('Offline conversation is ready')).toBeTruthy();
});

test('Refresh updates both the status panel and the model controls from files on the device', async () => {
  await render(<OfflineTools mine="en" partner="vi" signedIn onClose={() => {}} />);
  await screen.findByRole('button', { name: 'Finish Small speech download' });
  files.set(`file:///documents/offline-models/${SPEECH_MODELS.vad.file}`, { size: SPEECH_MODELS.vad.bytes, hash: SPEECH_MODELS.vad.sha256, modified: 3 });
  await fireEvent.press(screen.getByRole('button', { name: 'Refresh offline status' }));
  expect(await screen.findByText('Offline conversation is ready')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Small selected' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Finish Small speech download' })).toBeNull();
});

test('a model with a missing detector can be removed and readiness updates immediately', async () => {
  await render(<OfflineTools mine="en" partner="vi" onClose={() => {}} />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Remove Small speech model' }));
  expect(await screen.findByText('Small speech model removed from this phone.')).toBeTruthy();
  expect(await screen.findByText('Small speech model · Not downloaded')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Download Small speech model' })).toBeTruthy();
  expect(files.has(`file:///documents/offline-models/${SPEECH_MODELS.base.file}`)).toBe(false);
});

test('a downloaded Medium model can still be removed on a phone with insufficient memory', async () => {
  files.set(`file:///documents/offline-models/${SPEECH_MODELS.small.file}`, { size: SPEECH_MODELS.small.bytes, hash: SPEECH_MODELS.small.sha256, modified: 1 });
  jest.replaceProperty(Device, 'totalMemory', 3 * 1024 ** 3);
  try {
    await render(<OfflineTools mine="en" partner="vi" onClose={() => {}} />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Remove Medium speech model' }));
    expect(await screen.findByText('Medium speech model removed from this phone.')).toBeTruthy();
    expect(files.has(`file:///documents/offline-models/${SPEECH_MODELS.small.file}`)).toBe(false);
    expect(files.has(`file:///documents/offline-models/${SPEECH_MODELS.base.file}`)).toBe(true);
  } finally { jest.restoreAllMocks(); }
});

test('Medium remains visible with a disabled download and reported memory on a lower-memory phone', async () => {
  jest.replaceProperty(Device, 'totalMemory', 4_000_000_000);
  try {
    await render(<OfflineTools mine="en" partner="vi" onClose={() => {}} />);
    const button = await screen.findByRole('button', { name: 'Download Medium speech model' });
    expect(button.props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText('Medium needs a phone with about 6 GB RAM. This phone reports 4.0 GB. Use Small.')).toBeTruthy();
  } finally { jest.restoreAllMocks(); }
});

test('removing speech models preserves a shared detector until the last model is removed', async () => {
  for (const model of ['small', 'vad'] as const) {
    files.set(`file:///documents/offline-models/${SPEECH_MODELS[model].file}`, { size: SPEECH_MODELS[model].bytes, hash: SPEECH_MODELS[model].sha256, modified: 1 });
  }
  await render(<OfflineTools mine="en" partner="vi" onClose={() => {}} />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Remove Small speech model' }));
  expect(await screen.findByText('Small speech model removed from this phone.')).toBeTruthy();
  expect(files.has(`file:///documents/offline-models/${SPEECH_MODELS.vad.file}`)).toBe(true);
  await fireEvent.press(screen.getByRole('button', { name: 'Remove Medium speech model' }));
  expect(await screen.findByText('Medium speech model removed from this phone.')).toBeTruthy();
  expect(files.has(`file:///documents/offline-models/${SPEECH_MODELS.vad.file}`)).toBe(false);
  expect(await screen.findByText('Speech detector · Not downloaded')).toBeTruthy();
});

test('an invalid model can be removed without redownloading it first', async () => {
  files.set(`file:///documents/offline-models/${SPEECH_MODELS.base.file}`, { size: 100, hash: 'invalid', modified: 2 });
  await render(<OfflineTools mine="en" partner="vi" onClose={() => {}} />);
  expect(await screen.findByText('Small speech model · Download incomplete or invalid')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Remove Small speech model' }));
  expect(await screen.findByText('Small speech model removed from this phone.')).toBeTruthy();
  expect(files.has(`file:///documents/offline-models/${SPEECH_MODELS.base.file}`)).toBe(false);
});

test('failed model removal reports the failure without claiming it was deleted', async () => {
  jest.mocked(FileSystem.deleteAsync).mockRejectedValueOnce(new Error('Storage could not remove the model.'));
  await render(<OfflineTools mine="en" partner="vi" onClose={() => {}} />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Remove Small speech model' }));
  expect(await screen.findByText('Storage could not remove the model.')).toBeTruthy();
  expect(screen.queryByText('Small speech model removed from this phone.')).toBeNull();
  expect(files.has(`file:///documents/offline-models/${SPEECH_MODELS.base.file}`)).toBe(true);
});


test('Hy-MT2 download and removal show verified device status and update the local engine choice', async () => {
  const original = TurboModuleRegistry.get;
  const capability = jest.spyOn(TurboModuleRegistry, 'get').mockImplementation(name => name === 'RNLlama' ? {} as never : original(name));
  try {
    await render(<OfflineTools mine="en" partner="vi" signedIn onClose={() => {}} />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Download Large model · 1.13 GB' }));
    expect(await screen.findByText('Downloaded and verified · 1.13 GB on this phone')).toBeTruthy();
    expect(translationPreferences().textModel).toBe('hymt');
    expect(screen.queryByRole('button', { name: 'Cloud' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Remove Large model' }));
    expect(await screen.findByText('Large model removed from this phone. Platform packs will be used when available.')).toBeTruthy();
    expect(translationPreferences().textModel).toBe('platform');
    expect(files.has(`file:///documents/offline-models/${HYMT_MODEL.file}`)).toBe(false);
  } finally { capability.mockRestore(); }
});
