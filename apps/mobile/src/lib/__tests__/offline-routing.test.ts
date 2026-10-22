import { beforeEach, expect, jest, test } from '@jest/globals';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { fetch as mockFetch } from 'expo/fetch';
import { talkTurn, translateSign, translateText } from '../api';
import * as Network from 'expo-network';
import { session } from '../auth-client';
import { saveTranslationPreferences, translationPreferences } from '../translation-preferences';

jest.mock('expo-modules-core', () => {
  const actual = jest.requireActual<typeof import('expo-modules-core')>('expo-modules-core');
  return { ...actual, requireOptionalNativeModule: jest.fn(actual.requireOptionalNativeModule) };
});
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-network', () => ({ getNetworkStateAsync: jest.fn(async () => ({ isConnected: false, isInternetReachable: false })) }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async (key: string) => key.startsWith('roamie.ai-consent.') ? 'allowed' : null), setItem: jest.fn(async () => {}) }));
jest.mock('../auth-client', () => ({ API_BASE: 'https://example.test', session: { current: jest.fn(() => ({ sub: 'routing-qa' })), accessToken: jest.fn(async () => 'test-token') } }));

const native = {
  supportedTextLanguages: jest.fn(async () => ['en', 'fr', 'tl']),
  downloadedLanguages: jest.fn(async () => ['fr']),
  isTranslationReady: jest.fn(async () => true),
  identifyLanguage: jest.fn(async () => 'en'),
  translate: jest.fn(async () => 'Bonjour'),
  recognizeText: jest.fn(async () => [{ text: 'Hello', box: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 } }]),
};

beforeEach(async () => {
  jest.clearAllMocks();
  jest.mocked(Network.getNetworkStateAsync).mockReset().mockResolvedValue({ isConnected: false, isInternetReachable: false });
  jest.mocked(mockFetch).mockResolvedValue({ ok: true, status: 200, json: async () => ({ engine: 'cloud', translation: 'Cloud', lines: [] }) } as Awaited<ReturnType<typeof mockFetch>>);
  jest.mocked(session.current).mockReturnValue({ sub: 'routing-qa' } as ReturnType<typeof session.current>);
  native.downloadedLanguages.mockResolvedValue(['fr']);
  native.identifyLanguage.mockResolvedValue('en');
  native.supportedTextLanguages.mockResolvedValue(['en', 'fr', 'tl']);
  native.isTranslationReady.mockResolvedValue(true);
  jest.mocked(requireOptionalNativeModule).mockReturnValue(native);
  await saveTranslationPreferences({ mode: 'auto' });
});

test('offline-only mode never falls back to auth or cloud when a model is missing', async () => {
  native.isTranslationReady.mockResolvedValue(false);
  native.downloadedLanguages.mockResolvedValue([]);
  await saveTranslationPreferences({ mode: 'offline' });
  await expect(translateText('Hello', 'fr', 'en')).rejects.toMatchObject({ code: 'offline_unavailable' });
  expect(mockFetch).not.toHaveBeenCalled();
});

test('a disconnected device with missing packs reports preparation rather than retrying a server', async () => {
  native.isTranslationReady.mockResolvedValue(false);
  native.downloadedLanguages.mockResolvedValue([]);
  await expect(translateText('Hello', 'fr', 'en')).rejects.toMatchObject({ code: 'offline_unavailable' });
  expect(mockFetch).not.toHaveBeenCalled();
});

test('the explicit guest offline tool cannot use cloud even when the saved preference is cloud', async () => {
  await saveTranslationPreferences({ mode: 'cloud' });
  await expect(translateText('Hello', 'fr', 'en', undefined, true)).resolves.toMatchObject({ engine: 'device' });
  expect(mockFetch).not.toHaveBeenCalled();
});

test('the legacy cloud-only preference migrates to Automatic with disconnected fallback', async () => {
  await saveTranslationPreferences({ mode: 'cloud' });
  expect(translationPreferences().mode).toBe('auto');
  await expect(translateText('Hello', 'fr', 'en')).resolves.toMatchObject({ engine: 'device' });
  expect(native.translate).toHaveBeenCalled();
  expect(mockFetch).not.toHaveBeenCalled();
});

test('an online phone prioritises cloud even when models are downloaded', async () => {
  jest.mocked(Network.getNetworkStateAsync).mockResolvedValueOnce({ isConnected: true, isInternetReachable: true });
  await expect(translateText('Hello', 'fr', 'en')).resolves.toMatchObject({ engine: 'cloud' });
  expect(native.translate).not.toHaveBeenCalled();
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

test('a local conversation retains speaker direction without inventing a confidence score', async () => {
  await expect(talkTurn({ mine: 'en', partner: 'fr', partnerLocked: true, text: 'Hello', history: [] })).resolves.toMatchObject({
    engine: 'device', fromMe: true, target: 'fr', partner: 'fr', translation: 'Bonjour',
  });
  const result = await talkTurn({ mine: 'en', partner: 'fr', text: 'Hello', history: [] });
  expect(result.confidence).toBeUndefined();
  expect(mockFetch).not.toHaveBeenCalled();
});

test('a locked partner language allows automatic recognition of the owner language', async () => {
  native.identifyLanguage.mockResolvedValue('de');
  native.supportedTextLanguages.mockResolvedValue(['en', 'fr', 'de']);
  await expect(talkTurn({ mine: 'en', partner: 'fr', partnerLocked: true, autoMine: true, text: 'Hallo', history: [], offlineOnly: true })).resolves.toMatchObject({
    fromMe: true, mine: 'de', detected: 'de', target: 'fr', partner: 'fr', engine: 'device',
  });
  expect(mockFetch).not.toHaveBeenCalled();
});

test('offline camera retains OCR boxes and asks users to check the original', async () => {
  await expect(translateSign('unused-image-data', 'image/jpeg', 'fr', { uri: 'file:///photo.jpg', from: 'en', offlineOnly: true })).resolves.toMatchObject({
    engine: 'device', reviewRequired: true,
    lines: [{ original: 'Hello', translation: 'Bonjour', box: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 } }],
  });
  expect(mockFetch).not.toHaveBeenCalled();
});

test('cancellation cannot trigger an automatic cloud fallback', async () => {
  const controller = new AbortController(); controller.abort();
  await expect(translateText('Hello', 'fr', 'en', controller.signal)).rejects.toThrow('cancelled');
  expect(mockFetch).not.toHaveBeenCalled();
});

test('unsupported offline language errors remain explicit even with a usable network', async () => {
  jest.mocked(Network.getNetworkStateAsync).mockResolvedValueOnce({ isConnected: true, isInternetReachable: true } as Network.NetworkState);
  await expect(translateText('Hello', 'or', 'en', undefined, true)).rejects.toThrow('not supported');
  expect(mockFetch).not.toHaveBeenCalled();
});

test('downloaded translation works without a customer or any cloud request', async () => {
  jest.mocked(session.current).mockReturnValue(null);
  await expect(translateText('Hello', 'fr', 'en')).resolves.toMatchObject({ translation: 'Bonjour', engine: 'device' });
  expect(mockFetch).not.toHaveBeenCalled();
});


test('online conversation and camera start cloud without local preparation', async () => {
  jest.mocked(Network.getNetworkStateAsync).mockResolvedValue({ isConnected: true, isInternetReachable: true });
  await expect(talkTurn({ mine: 'en', partner: 'fr', text: 'Hello', history: [] })).resolves.toMatchObject({ engine: 'cloud', translation: 'Cloud' });
  await expect(translateSign('unused-image-data', 'image/jpeg', 'fr', { uri: 'file:///photo.jpg', from: 'en' })).resolves.toMatchObject({ engine: 'cloud' });
  expect(native.recognizeText).not.toHaveBeenCalled();
  expect(mockFetch).toHaveBeenCalledTimes(2);
});
