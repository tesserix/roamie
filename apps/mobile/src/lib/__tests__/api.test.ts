import { beforeEach, expect, jest, test } from '@jest/globals';
import { fetch as mockExpoFetch } from 'expo/fetch';
import { session } from '../auth-client';
import { ApiError, talkTurn, translateText } from '../api';
import { requireOptionalNativeModule } from 'expo-modules-core';
import * as Network from 'expo-network';

jest.mock('@react-native-async-storage/async-storage', () => ({getItem:jest.fn(async (key: string)=>key.startsWith('roamie.ai-consent.') ? 'allowed' : null),setItem:jest.fn(async()=>{})}));
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-modules-core', () => ({ ...jest.requireActual<object>('expo-modules-core'), requireOptionalNativeModule: jest.fn(() => null) }));
jest.mock('expo-network', () => ({ getNetworkStateAsync: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })) }));
jest.mock('../auth-client', () => ({
  API_BASE: 'https://roamie-api.tesserix.app',
  authFetch: jest.fn((...args: Parameters<typeof mockExpoFetch>) => mockExpoFetch(...args)),
  session: { current: jest.fn(() => ({ sub: 'alice' })), revision: jest.fn(() => 1), accessToken: jest.fn(async () => 'token'), clear: jest.fn(async () => {}) },
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(requireOptionalNativeModule).mockReturnValue(null);
  jest.mocked(session.current).mockReturnValue({ sub: 'alice' } as ReturnType<typeof session.current>);
  jest.mocked(session.revision).mockReturnValue(1);
});

test('a late unauthorized response cannot clear a renewed login for the same account', async () => {
  jest.mocked(mockExpoFetch).mockImplementationOnce(async () => {
    jest.mocked(session.revision).mockReturnValue(2);
    return { ok: false, status: 401, json: async () => ({}) } as Awaited<ReturnType<typeof mockExpoFetch>>;
  });
  await expect(translateText('Hello', 'fr')).rejects.toThrow();
  expect(session.clear).not.toHaveBeenCalled();
});

test('a late unauthorized response cannot sign out the next account', async () => {
  jest.mocked(mockExpoFetch).mockImplementationOnce(async () => {
    jest.mocked(session.current).mockReturnValue({ sub: 'bob' } as ReturnType<typeof session.current>);
    return { ok: false, status: 401, json: async () => ({}) } as Awaited<ReturnType<typeof mockExpoFetch>>;
  });
  await expect(translateText('Hello', 'fr')).rejects.toThrow();
  expect(session.clear).not.toHaveBeenCalled();
});

test('discards successful data from a previous account', async () => {
  jest.mocked(mockExpoFetch).mockImplementationOnce(async () => {
    jest.mocked(session.current).mockReturnValue({ sub: 'bob' } as ReturnType<typeof session.current>);
    return { ok: true, status: 200, json: async () => ({ translation: 'private translation' }) } as Awaited<ReturnType<typeof mockExpoFetch>>;
  });
  await expect(translateText('Hello', 'fr')).rejects.toThrow('account changed');
});

test('a translation gateway timeout gives a relevant retry message', async () => {
  jest.mocked(mockExpoFetch).mockResolvedValueOnce({ ok: false, status: 504, json: async () => JSON.parse('<html>Gateway timeout</html>') } as Awaited<ReturnType<typeof mockExpoFetch>>);
  await expect(translateText('Hello', 'fr')).rejects.toThrow('This request took too long. Please try again.');
  expect(session.clear).not.toHaveBeenCalled();
});

test('AI translation remains available beyond the old fifteen-second timeout', async () => {
  jest.useFakeTimers();
  try {
    let finish!: (response: Awaited<ReturnType<typeof mockExpoFetch>>) => void;
    jest.mocked(mockExpoFetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = translateText('Hello', 'fr');
    await jest.advanceTimersByTimeAsync(45000);
    const signal = jest.mocked(mockExpoFetch).mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(false);
    finish({ ok: true, status: 200, json: async () => ({ translation: 'Bonjour' }) } as Awaited<ReturnType<typeof mockExpoFetch>>);
    await expect(pending).resolves.toEqual({ translation: 'Bonjour' });
  } finally { jest.useRealTimers(); }
});

test('speech errors preserve their machine-readable code so unclear speech can recover', async () => {
  jest.mocked(mockExpoFetch).mockResolvedValueOnce({ ok: false, status: 422, json: async () => ({ error: 'no_speech', message: "Didn't catch that." }) } as Awaited<ReturnType<typeof mockExpoFetch>>);
  await expect(talkTurn({ mine: 'en', partner: 'ja', text: 'Hello', history: [] })).rejects.toMatchObject({ status: 422, code: 'no_speech' });
  expect(mockExpoFetch).toHaveBeenCalledTimes(1);
});

test('audio requests exclude earlier utterances from recognition input while typed translation retains context', async () => {
  const history = [{ original: 'Please bring water and a receipt.', translation: '水と領収書をお願いします。' }];
  jest.mocked(mockExpoFetch).mockResolvedValue({ ok: true, status: 200, json: async () => ({ transcript: 'Hello', translation: 'こんにちは' }) } as Awaited<ReturnType<typeof mockExpoFetch>>);
  await talkTurn({ mine: 'en', partner: 'ja', audio: { data: 'YXVkaW8=', mimeType: 'audio/mp4' }, history });
  expect(JSON.parse(jest.mocked(mockExpoFetch).mock.calls[0][1]?.body as string)).toMatchObject({ audio: { data: 'YXVkaW8=' }, history: [] });
  await talkTurn({ mine: 'en', partner: 'ja', text: 'And another, please.', history });
  expect(JSON.parse(jest.mocked(mockExpoFetch).mock.calls[1][1]?.body as string)).toMatchObject({ text: 'And another, please.', history });
  expect(history).toEqual([{ original: 'Please bring water and a receipt.', translation: '水と領収書をお願いします。' }]);
});

test('a temporary translation outage retries once without duplicating the completed turn', async () => {
  jest.useFakeTimers();
  try {
    jest.mocked(mockExpoFetch).mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ error: 'unavailable', message: 'Try again.' }) } as Awaited<ReturnType<typeof mockExpoFetch>>)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ translation: 'こんにちは' }) } as Awaited<ReturnType<typeof mockExpoFetch>>);
    const onRetry = jest.fn();
    const pending = talkTurn({ mine: 'en', partner: 'ja', text: 'Hello', history: [] }, undefined, onRetry);
    await jest.advanceTimersByTimeAsync(1500);
    await expect(pending).resolves.toEqual({ translation: 'こんにちは' });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(mockExpoFetch).toHaveBeenCalledTimes(2);
  } finally { jest.useRealTimers(); }
});

test('stopping during reconnect cancels the retry before another request is sent', async () => {
  jest.useFakeTimers();
  try {
    jest.mocked(mockExpoFetch).mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ error: 'unavailable', message: 'Try again.' }) } as Awaited<ReturnType<typeof mockExpoFetch>>);
    const controller = new AbortController();
    const pending = talkTurn({ mine: 'en', partner: 'ja', text: 'Hello', history: [] }, controller.signal);
    const rejected = expect(pending).rejects.toBeInstanceOf(ApiError);
    await jest.advanceTimersByTimeAsync(1);
    controller.abort();
    await jest.advanceTimersByTimeAsync(2000);
    await rejected;
    expect(mockExpoFetch).toHaveBeenCalledTimes(1);
  } finally { jest.useRealTimers(); }
});

test.each([[401, 'no_speech'], [403, 'network'], [429, 'timeout'], [422, 'no_speech']])('HTTP %s is never automatically retried', async (status, code) => {
  jest.mocked(mockExpoFetch).mockResolvedValueOnce({ ok: false, status, json: async () => ({ error: code, message: 'Unable to continue.' }) } as Awaited<ReturnType<typeof mockExpoFetch>>);
  await expect(talkTurn({ mine: 'en', partner: 'ja', text: 'Hello', history: [] })).rejects.toBeInstanceOf(ApiError);
  expect(mockExpoFetch).toHaveBeenCalledTimes(1);
});

test('persistent outages stop after two attempts within the total ninety-second budget', async () => {
  jest.useFakeTimers();
  try {
    jest.mocked(mockExpoFetch).mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })), { once: true });
    }));
    const pending = talkTurn({ mine: 'en', partner: 'ja', text: 'Hello', history: [] });
    const rejected = expect(pending).rejects.toMatchObject({ code: 'timeout' });
    await jest.advanceTimersByTimeAsync(90001);
    await rejected;
    expect(mockExpoFetch).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
  } finally { jest.mocked(mockExpoFetch).mockReset(); jest.useRealTimers(); }
});


test('Automatic falls back to the existing cloud API only after a local translation failure', async () => {
  const translate = jest.fn(async () => { throw new Error('Platform translation unavailable'); });
  jest.mocked(requireOptionalNativeModule).mockReturnValue({
    supportedTextLanguages: async () => ['en', 'fr'], isTranslationReady: async () => true, translate,
  });
  jest.mocked(mockExpoFetch).mockImplementationOnce(async () => {
    expect(translate).toHaveBeenCalledTimes(1);
    return { ok: true, status: 200, json: async () => ({ translation: 'Bonjour from cloud', engine: 'cloud' }) } as Awaited<ReturnType<typeof mockExpoFetch>>;
  });
  await expect(translateText('Hello', 'fr', 'en')).resolves.toMatchObject({ translation: 'Bonjour from cloud', engine: 'cloud' });
  expect(Network.getNetworkStateAsync).toHaveBeenCalled();
  expect(mockExpoFetch).toHaveBeenCalledTimes(1);
});
