import { beforeEach, expect, jest, test } from '@jest/globals';
import { requireOptionalNativeModule } from 'expo-modules-core';
import * as FileSystem from 'expo-file-system/legacy';
import { downloadSpeechModel } from '../speech-models';
import * as Network from 'expo-network';
import * as Device from 'expo-device';

jest.mock('expo-modules-core', () => ({ ...jest.requireActual<object>('expo-modules-core'), requireOptionalNativeModule: jest.fn() }));
jest.mock('expo-network', () => ({ getNetworkStateAsync: jest.fn(async () => ({ type: 'WIFI', isConnected: true, isInternetReachable: true })), addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })), NetworkStateType: { WIFI: 'WIFI' } }));
jest.mock('expo-device', () => ({ __esModule: true, totalMemory: 8 * 1024 ** 3 }));
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/',
  FileSystemSessionType: { FOREGROUND: 0 },
  getInfoAsync: jest.fn(async () => ({ exists: true, size: 59707625 })),
  getFreeDiskStorageAsync: jest.fn(async () => 10 * 1024 ** 3),
  makeDirectoryAsync: jest.fn(async () => {}),
  deleteAsync: jest.fn(async () => {}),
  moveAsync: jest.fn(async () => {}),
  createDownloadResumable: jest.fn(() => ({ downloadAsync: jest.fn(async () => ({ status: 200 })), cancelAsync: jest.fn(async () => {}) })),
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(requireOptionalNativeModule).mockReturnValue({ sha256: jest.fn(async () => 'wrong-checksum') });
});

test('a corrupt downloaded model is removed and never promoted to an installed model', async () => {
  jest.mocked(requireOptionalNativeModule).mockReturnValue({ sha256: jest.fn(async () => 'wrong-checksum') });
  await expect(downloadSpeechModel('base')).rejects.toThrow('verification');
  expect(FileSystem.moveAsync).not.toHaveBeenCalled();
  expect(FileSystem.deleteAsync).toHaveBeenCalledWith(expect.stringContaining('.download'), { idempotent: true });
});

test('Wi-Fi-only downloads reject mobile data before writing a file', async () => {
  jest.mocked(Network.getNetworkStateAsync).mockResolvedValueOnce({ type: 'CELLULAR', isConnected: true } as Network.NetworkState);
  await expect(downloadSpeechModel('base')).rejects.toThrow('Wi-Fi');
  expect(FileSystem.createDownloadResumable).not.toHaveBeenCalled();
});

test('Small is not loaded or downloaded on a low-memory device', async () => {
  jest.replaceProperty(Device, 'totalMemory', 3 * 1024 ** 3);
  try { await expect(downloadSpeechModel('small')).rejects.toThrow('Use Base'); }
  finally { jest.restoreAllMocks(); }
  expect(FileSystem.createDownloadResumable).not.toHaveBeenCalled();
});

test('downloads monitor a Wi-Fi-only session so a network change can cancel it', async () => {
  await expect(downloadSpeechModel('base')).rejects.toThrow('verification');
  expect(Network.addNetworkStateListener).toHaveBeenCalledTimes(1);
});

test('the visible cancellable download uses a foreground session', async () => {
  await expect(downloadSpeechModel('base')).rejects.toThrow('verification');
  expect(FileSystem.createDownloadResumable).toHaveBeenCalledWith(expect.any(String), expect.any(String), { sessionType: FileSystem.FileSystemSessionType.FOREGROUND }, expect.any(Function));
});
