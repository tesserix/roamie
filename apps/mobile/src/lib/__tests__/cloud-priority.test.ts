import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { fetch as cloudFetch } from 'expo/fetch';
import * as Network from 'expo-network';
import { talkTurn, translateSign, translateText } from '../api';
import { saveTranslationPreferences } from '../translation-preferences';

jest.mock('expo-modules-core', () => ({ ...jest.requireActual<object>('expo-modules-core'), requireOptionalNativeModule: jest.fn() }));
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-network', () => ({ getNetworkStateAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({ File: class { async base64() { return 'audio'; } } }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async (key: string) => key.startsWith('roamie.ai-consent.') ? 'allowed' : null), setItem: jest.fn(async () => {}) }));
jest.mock('../auth-client', () => ({ API_BASE: 'https://example.test', session: { current: () => ({ sub: 'routing-test' }), accessToken: async () => 'test-token', revision: () => 0 } }));

const native = {
  supportedTextLanguages: jest.fn(async () => ['en', 'fr']),
  isTranslationReady: jest.fn(async () => true), translate: jest.fn(async () => 'Local'),
  identifyLanguage: jest.fn(async () => 'en'), recognizeText: jest.fn(async () => [{ text: 'Hello', box: {} }]),
};
const cloud = { engine: 'cloud', translation: 'Cloud', lines: [] };
const response = () => ({ ok: true, status: 200, json: async () => cloud }) as Awaited<ReturnType<typeof cloudFetch>>;
const untilAborted: typeof cloudFetch = (_url, options) => new Promise((_resolve, reject) => {
  const abort = () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
  options?.signal?.addEventListener('abort', abort, { once: true });
  if (options?.signal?.aborted) abort();
});
beforeEach(async () => {
  jest.clearAllMocks(); jest.useFakeTimers();
  native.isTranslationReady.mockReset().mockResolvedValue(true); native.translate.mockReset().mockResolvedValue('Local');
  jest.mocked(requireOptionalNativeModule).mockReturnValue(native);
  jest.mocked(Network.getNetworkStateAsync).mockReset().mockResolvedValue({ isConnected: true, isInternetReachable: true } as Network.NetworkState);
  jest.mocked(cloudFetch).mockReset().mockResolvedValue(response());
  await saveTranslationPreferences({ mode: 'auto' });
});
afterEach(() => { jest.useRealTimers(); });

test.each(['text', 'talk', 'camera'])('%s starts healthy cloud without checking or loading downloaded models', async surface => {
  native.isTranslationReady.mockImplementationOnce(() => new Promise(() => {}));
  const pending = surface === 'text' ? translateText('Hello', 'fr', 'en')
    : surface === 'talk' ? talkTurn({ mine: 'en', partner: 'fr', text: 'Hello', history: [] })
      : translateSign('image', 'image/jpeg', 'fr', { uri: 'file:///photo.jpg', from: 'en' });
  await jest.advanceTimersByTimeAsync(100);
  await expect(pending).resolves.toMatchObject({ engine: 'cloud' });
  expect(native.isTranslationReady).not.toHaveBeenCalled();
  expect(native.identifyLanguage).not.toHaveBeenCalled();
  expect(native.recognizeText).not.toHaveBeenCalled();
  expect(native.translate).not.toHaveBeenCalled();
  expect(cloudFetch).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test('a ready local model can win after cloud becomes slow and cancels the cloud request', async () => {
  jest.mocked(cloudFetch).mockImplementationOnce(untilAborted);
  const pending = translateText('Hello', 'fr', 'en');
  await jest.advanceTimersByTimeAsync(1900);
  expect(cloudFetch).toHaveBeenCalledTimes(1);
  expect(native.translate).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(300);
  await expect(pending).resolves.toMatchObject({ engine: 'device', translation: 'Local' });
  expect(jest.mocked(cloudFetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
});

test('cloud can win while a slow local fallback runs and its late result is ignored', async () => {
  let finishCloud!: (value: Awaited<ReturnType<typeof cloudFetch>>) => void;
  let finishLocal!: (value: string) => void;
  jest.mocked(cloudFetch).mockImplementationOnce(() => new Promise(resolve => { finishCloud = resolve; }));
  native.translate.mockImplementationOnce(() => new Promise(resolve => { finishLocal = resolve; }));
  const pending = translateText('Hello', 'fr', 'en');
  await jest.advanceTimersByTimeAsync(2200);
  expect(native.translate).toHaveBeenCalledTimes(1);
  finishCloud(response()); await expect(pending).resolves.toMatchObject({ engine: 'cloud' });
  finishLocal('Late local'); await jest.advanceTimersByTimeAsync(1);
  expect(cloudFetch).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
});

test('missing models cannot cancel a cloud request that is still making progress', async () => {
  let finish!: (value: Awaited<ReturnType<typeof cloudFetch>>) => void;
  native.isTranslationReady.mockResolvedValue(false);
  jest.mocked(cloudFetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = translateText('Hello', 'fr', 'en');
  let settled = false; void pending.then(() => { settled = true; });
  await jest.advanceTimersByTimeAsync(3000);
  expect(settled).toBe(false); expect(native.translate).not.toHaveBeenCalled();
  finish(response()); await expect(pending).resolves.toMatchObject({ engine: 'cloud' });
});

test('a network failure starts compatible local fallback immediately', async () => {
  jest.mocked(cloudFetch).mockRejectedValueOnce(new TypeError('Network request failed'));
  const pending = translateText('Hello', 'fr', 'en');
  await jest.advanceTimersByTimeAsync(100);
  await expect(pending).resolves.toMatchObject({ engine: 'device' });
  expect(cloudFetch).toHaveBeenCalledTimes(1);
});

test('an authorization failure remains visible and cannot be hidden by local fallback', async () => {
  jest.mocked(cloudFetch).mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) } as Awaited<ReturnType<typeof cloudFetch>>);
  await expect(translateText('Hello', 'fr', 'en')).rejects.toMatchObject({ status: 403 });
  expect(native.translate).not.toHaveBeenCalled();
});

test.each(['offline-only', 'disconnected'])('%s uses installed models without uploading', async mode => {
  if (mode === 'offline-only') await saveTranslationPreferences({ mode: 'offline' });
  else jest.mocked(Network.getNetworkStateAsync).mockResolvedValue({ isConnected: false, isInternetReachable: false } as Network.NetworkState);
  await expect(translateText('Hello', 'fr', 'en')).resolves.toMatchObject({ engine: 'device' });
  expect(cloudFetch).not.toHaveBeenCalled();
});

test('switching to Offline only cancels an in-flight cloud request and prevents retries', async () => {
  jest.mocked(cloudFetch).mockImplementationOnce(untilAborted);
  const pending = translateText('Hello', 'fr', 'en');
  const rejected = expect(pending).rejects.toMatchObject({ code: 'offline_unavailable' });
  await jest.advanceTimersByTimeAsync(100);
  await saveTranslationPreferences({ mode: 'offline' });
  await rejected;
  expect(jest.mocked(cloudFetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
  await jest.advanceTimersByTimeAsync(10000);
  expect(cloudFetch).toHaveBeenCalledTimes(1); expect(native.translate).not.toHaveBeenCalled();
});

test('cancel during a cloud/local race promptly settles and prevents late results', async () => {
  jest.mocked(cloudFetch).mockImplementationOnce(untilAborted);
  let finishLocal!: (value: string) => void;
  native.translate.mockImplementationOnce(() => new Promise(resolve => { finishLocal = resolve; }));
  const controller = new AbortController();
  const pending = translateText('Hello', 'fr', 'en', controller.signal);
  const rejected = expect(pending).rejects.toThrow('cancelled');
  await jest.advanceTimersByTimeAsync(2200); controller.abort();
  await rejected; finishLocal('Late local'); await jest.advanceTimersByTimeAsync(1);
  expect(jest.mocked(cloudFetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
});
