import { expect, jest, test } from '@jest/globals';
import { fetch as cloudFetch } from 'expo/fetch';
import { translateText } from '../api';
import { installedSpeechModels } from '../speech-models';

jest.mock('../../../modules/roamie-offline', () => ({ offlineNative: () => null }));
jest.mock('expo-network', () => { throw new Error('ExpoNetwork is not installed in older binaries'); });
jest.mock('expo-device', () => ({ totalMemory: 4 * 1024 ** 3 }));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: 'file:///documents/', getInfoAsync: jest.fn(async () => ({ exists: false })) }));
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('../auth-client', () => ({ API_BASE: 'https://example.test', session: { current: () => ({ sub: 'legacy-user' }), accessToken: jest.fn(async () => 'test-token') } }));

test('a binary without new native modules can check packs and continue using cloud translation', async () => {
  jest.mocked(cloudFetch).mockResolvedValue({ ok: true, status: 200, json: async () => ({ detected: 'en', translation: 'Bonjour', romanized: '', sourceRomanized: '', alternatives: [] }) } as Awaited<ReturnType<typeof cloudFetch>>);
  await expect(installedSpeechModels()).resolves.toEqual([]);
  await expect(translateText('Hello', 'fr', 'en')).resolves.toMatchObject({ translation: 'Bonjour' });
  expect(cloudFetch).toHaveBeenCalledTimes(1);
});
