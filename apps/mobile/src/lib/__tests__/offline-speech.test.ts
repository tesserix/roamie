import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { waitFor } from '@testing-library/react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import * as FileSystem from 'expo-file-system/legacy';
import { initWhisper, initWhisperVad } from 'whisper.rn/index';
import { transcribeOffline, releaseOfflineSpeech } from '../offline-speech';
import { SPEECH_MODELS } from '../speech-models';
import { talkTurn } from '../api';
import { fetch as cloudFetch } from 'expo/fetch';

jest.mock('expo-modules-core', () => ({ ...jest.requireActual<object>('expo-modules-core'), requireOptionalNativeModule: jest.fn() }));
jest.mock('expo-device', () => ({ totalMemory: 8 * 1024 ** 3, deviceYearClass: 2022, isDevice: true }));
jest.mock('expo-network', () => ({ getNetworkStateAsync: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })) }));
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async (key: string) => key.startsWith('roamie.ai-consent.') ? 'allowed' : null), setItem: jest.fn(async () => {}) }));
jest.mock('../auth-client', () => ({ API_BASE: 'https://example.test', session: { current: () => ({ sub: 'offline-audio-test' }), accessToken: jest.fn(async () => 'test-token') } }));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: 'file:///documents/', getInfoAsync: jest.fn(), deleteAsync: jest.fn(async () => {}) }));
jest.mock('whisper.rn/index', () => ({ initWhisper: jest.fn(), initWhisperVad: jest.fn() }));

const vad = { detectSpeech: jest.fn(async () => [{ t0: 0, t1: 1 }]), release: jest.fn(async () => {}) };
const context = { transcribe: jest.fn(), release: jest.fn(async () => {}) };

beforeEach(() => {
  jest.clearAllMocks();
  vad.detectSpeech.mockResolvedValue([{ t0: 0, t1: 1 }]);
  jest.mocked(requireOptionalNativeModule).mockReturnValue({
    sha256: jest.fn(async (uri: string) => uri.includes('silero') ? SPEECH_MODELS.vad.sha256 : SPEECH_MODELS.base.sha256),
    audioToWav: jest.fn(async () => 'file:///cache/converted.wav'),
    availableMemory: jest.fn(async () => 8 * 1024 ** 3),
    supportedTextLanguages: jest.fn(async () => ['en', 'fr']),
    isTranslationReady: jest.fn(async () => false),
  });
  jest.mocked(FileSystem.getInfoAsync).mockImplementation(async uri => ({ exists: true, isDirectory: false, uri, modificationTime: 1, size: uri.includes('silero') ? SPEECH_MODELS.vad.bytes : SPEECH_MODELS.base.bytes }));
  jest.mocked(initWhisperVad).mockResolvedValue(vad as never);
  jest.mocked(initWhisper).mockResolvedValue(context as never);
  context.transcribe.mockReturnValue({ stop: jest.fn(async () => {}), promise: Promise.resolve({ result: 'Bonjour', language: 'fr', isAborted: false }) });
});

test('memory pressure prevents loading a speech model rather than risking a process crash', async () => {
  const native = requireOptionalNativeModule<{ availableMemory(): Promise<number> }>('RoamieOffline')!;
  jest.spyOn(native, 'availableMemory').mockResolvedValue(100 * 1024 ** 2);
  await expect(transcribeOffline('file:///cache/recording.m4a')).rejects.toMatchObject({ code: 'speech_unavailable' });
  expect(initWhisper).not.toHaveBeenCalled();
});

test('a missing text pack sends the locally recognised text to cloud instead of uploading audio', async () => {
  jest.mocked(cloudFetch).mockResolvedValue({ ok: true, status: 200, json: async () => ({ detected: 'fr', transcript: 'Bonjour', translation: 'Hello', target: 'en', partner: 'fr', sameLanguage: false }) } as Awaited<ReturnType<typeof cloudFetch>>);
  await expect(talkTurn({ mine: 'en', partner: 'fr', partnerLocked: true, audio: { uri: 'file:///cache/recording.m4a', mimeType: 'audio/mp4' }, history: [] })).resolves.toMatchObject({ translation: 'Hello' });
  const payload = JSON.parse(jest.mocked(cloudFetch).mock.calls[0][1]?.body as string);
  expect(payload.text).toBe('Bonjour');
  expect(payload.audio).toBeUndefined();
  expect(payload.offlineOnly).toBeUndefined();
});

afterEach(async () => { await releaseOfflineSpeech(); });

test('silence is rejected before loading the much larger speech model', async () => {
  vad.detectSpeech.mockResolvedValue([]);
  await expect(transcribeOffline('file:///cache/recording.m4a')).rejects.toMatchObject({ code: 'no_speech' });
  expect(initWhisper).not.toHaveBeenCalled();
  expect(FileSystem.deleteAsync).toHaveBeenCalledWith('file:///cache/converted.wav', { idempotent: true });
});

test('clear speech is recognised locally with its language and temporary audio is removed', async () => {
  await expect(transcribeOffline('file:///cache/recording.m4a')).resolves.toEqual({ text: 'Bonjour', language: 'fr' });
  expect(context.transcribe).toHaveBeenCalledWith('file:///cache/converted.wav', expect.objectContaining({ language: 'auto', translate: false }));
  expect(FileSystem.deleteAsync).toHaveBeenCalledWith('file:///cache/converted.wav', { idempotent: true });
});

test('offline conversation trusts the installed pair when the downloaded-language list is incomplete', async () => {
  const native = requireOptionalNativeModule<Record<string, unknown>>('RoamieOffline')!;
  native.downloadedLanguages = jest.fn(async () => []);
  native.isTranslationReady = jest.fn(async () => true);
  native.translate = jest.fn(async () => 'Hello');
  await expect(talkTurn({ mine: 'en', partner: 'fr', partnerLocked: true, audio: { uri: 'file:///cache/recording.m4a', mimeType: 'audio/mp4' }, history: [], offlineOnly: true })).resolves.toMatchObject({
    engine: 'device', transcript: 'Bonjour', translation: 'Hello', target: 'en',
  });
  expect(cloudFetch).not.toHaveBeenCalled();
});

test('offline conversation identifies a missing selected speech model without blaming installed languages', async () => {
  const native = requireOptionalNativeModule<Record<string, unknown>>('RoamieOffline')!;
  native.isTranslationReady = jest.fn(async () => true);
  jest.mocked(FileSystem.getInfoAsync).mockImplementation(async uri => ({ exists: false, isDirectory: false, uri }));
  await expect(talkTurn({ mine: 'en', partner: 'fr', partnerLocked: true, audio: { uri: 'file:///cache/recording.m4a', mimeType: 'audio/mp4' }, history: [], offlineOnly: true })).rejects.toThrow('Base speech model is not downloaded');
  expect(cloudFetch).not.toHaveBeenCalled();
});

test('offline conversation names the language pair that is not ready', async () => {
  await expect(talkTurn({ mine: 'en', partner: 'fr', partnerLocked: true, audio: { uri: 'file:///cache/recording.m4a', mimeType: 'audio/mp4' }, history: [], offlineOnly: true })).rejects.toThrow('English ↔ French language packs are not ready');
  expect(cloudFetch).not.toHaveBeenCalled();
});

test('aborting a turn stops inference and cannot return a late transcript', async () => {
  let complete!: (result: { result: string; language: string; isAborted: boolean }) => void;
  const promise = new Promise(resolve => { complete = resolve; });
  const stop = jest.fn(async () => { complete({ result: 'Late', language: 'en', isAborted: true }); });
  context.transcribe.mockReturnValue({ promise, stop });
  const controller = new AbortController();
  const operation = transcribeOffline('file:///cache/recording.m4a', controller.signal);
  const assertion = expect(operation).rejects.toThrow('cancelled');
  await waitFor(() => expect(context.transcribe).toHaveBeenCalled());
  controller.abort();
  await assertion;
  expect(stop).toHaveBeenCalled();
});
