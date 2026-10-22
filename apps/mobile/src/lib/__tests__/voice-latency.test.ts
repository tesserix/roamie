import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';

const mockSpeech = {
  stop: jest.fn<() => Promise<void>>(), speak: jest.fn(),
  getAvailableVoicesAsync: jest.fn<() => Promise<{ identifier: string; language: string }[]>>(),
};
const mockGenerate = jest.fn<() => Promise<{ data: string; mimeType: string }>>();
const mockNetwork = jest.fn<() => Promise<{ isConnected: boolean; isInternetReachable: boolean }>>();
const mockOfflineVoices = jest.fn<() => Promise<{ identifier: string; language: string }[]>>();
const mockPlayer = { play: jest.fn(), pause: jest.fn(), remove: jest.fn(), addListener: jest.fn() };
let mockMode = 'auto';

jest.mock('expo-speech', () => mockSpeech);
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en', regionCode: 'US' }] }));
jest.mock('expo-network', () => ({ getNetworkStateAsync: mockNetwork }));
jest.mock('expo-audio', () => ({ createAudioPlayer: () => mockPlayer, setAudioModeAsync: async () => {} }));
jest.mock('expo-file-system', () => ({ Paths: { cache: 'file:///cache/' }, File: class { uri = 'file:///speech.wav'; exists = true; write() {} delete() {} } }));
jest.mock('../../../modules/roamie-offline', () => ({ offlineNative: () => ({ offlineVoices: mockOfflineVoices }) }));
jest.mock('../translation-preferences', () => ({ restoreTranslationPreferences: async () => {}, translationPreferences: () => ({ mode: mockMode }) }));
jest.mock('../api', () => ({ synthesizeSpeech: mockGenerate }));

let voice: typeof import('../voice');
let finishPlayer: (status: { didJustFinish: boolean }) => void;
beforeEach(async () => {
  jest.resetModules(); jest.resetAllMocks(); jest.useFakeTimers(); mockMode = 'auto';
  mockSpeech.stop.mockResolvedValue();
  mockSpeech.getAvailableVoicesAsync.mockResolvedValue([{ identifier: 'english', language: 'en-US' }]);
  mockOfflineVoices.mockResolvedValue([{ identifier: 'english', language: 'en-US' }]);
  mockNetwork.mockResolvedValue({ isConnected: true, isInternetReachable: true });
  mockGenerate.mockResolvedValue({ data: 'UklGRg==', mimeType: 'audio/wav' });
  mockPlayer.addListener.mockImplementation((_event, callback) => { finishPlayer = callback as typeof finishPlayer; return { remove: jest.fn() }; });
  voice = await import('../voice');
});
afterEach(() => { voice.stopSpeaking(); jest.clearAllTimers(); jest.useRealTimers(); });

test('connected playback does not wait for the offline voice inventory', async () => {
  mockOfflineVoices.mockImplementationOnce(() => new Promise(() => {}));
  const playback = voice.speak('Hello', 'en');
  await jest.advanceTimersByTimeAsync(200);
  expect(mockSpeech.speak).toHaveBeenCalledTimes(1);
  expect(mockOfflineVoices).not.toHaveBeenCalled();
  const options = mockSpeech.speak.mock.calls[0][1] as { onDone: () => void };
  options.onDone(); expect(await playback).toBe(true);
});

test('a stalled platform voice list reaches generated speech within one second', async () => {
  mockSpeech.getAvailableVoicesAsync.mockImplementationOnce(() => new Promise(() => {}));
  const playback = voice.speak('Hello', 'en');
  await jest.advanceTimersByTimeAsync(900);
  expect(mockGenerate).toHaveBeenCalledTimes(1);
  finishPlayer({ didJustFinish: true }); expect(await playback).toBe(true);
});

test('a native voice that never starts falls back rather than holding hands-free for a minute', async () => {
  const playback = voice.speak('Hello', 'en');
  await jest.advanceTimersByTimeAsync(2300);
  expect(mockGenerate).toHaveBeenCalledTimes(1);
  const options = mockSpeech.speak.mock.calls[0][1] as { onDone: () => void };
  let settled = false; void playback.then(() => { settled = true; });
  options.onDone(); await Promise.resolve();
  expect(settled).toBe(false);
  finishPlayer({ didJustFinish: true }); expect(await playback).toBe(true);
});

test('a stalled network check and late native stop cannot cancel generated fallback', async () => {
  mockNetwork.mockImplementation(() => new Promise(() => {}));
  const playback = voice.speak('Hello', 'en');
  await jest.advanceTimersByTimeAsync(300);
  const options = mockSpeech.speak.mock.calls[0][1] as { onError: () => void; onStopped: () => void };
  options.onError(); options.onStopped();
  await jest.advanceTimersByTimeAsync(400);
  expect(mockGenerate).toHaveBeenCalledTimes(1);
  finishPlayer({ didJustFinish: true }); expect(await playback).toBe(true);
});

test('unresponsive generated speech releases hands-free within eight seconds and ignores late audio', async () => {
  let generated!: (audio: { data: string; mimeType: string }) => void;
  mockGenerate.mockImplementationOnce(() => new Promise(resolve => { generated = resolve; }));
  const playback = voice.speak('ଧନ୍ୟବାଦ', 'or');
  let result: boolean | undefined; void playback.then(value => { result = value; });
  await jest.advanceTimersByTimeAsync(8200);
  expect(result).toBe(false);
  generated({ data: 'UklGRg==', mimeType: 'audio/wav' });
  await jest.advanceTimersByTimeAsync(100);
  expect(mockPlayer.play).not.toHaveBeenCalled();
});

test('offline-only voice discovery is bounded and never generates cloud audio', async () => {
  mockMode = 'offline';
  mockOfflineVoices.mockImplementationOnce(() => new Promise(() => {}));
  const playback = voice.speak('Hello', 'en');
  let result: boolean | undefined; void playback.then(value => { result = value; });
  await jest.advanceTimersByTimeAsync(900);
  expect(result).toBe(false);
  expect(mockGenerate).not.toHaveBeenCalled();
});

test('new speech waits for the previous native stop before it can queue', async () => {
  let stopped!: () => void;
  mockSpeech.stop.mockImplementationOnce(() => new Promise(resolve => { stopped = resolve; }));
  const playback = voice.speak('Hello', 'en');
  await jest.advanceTimersByTimeAsync(200);
  expect(mockSpeech.speak).not.toHaveBeenCalled();
  stopped(); await jest.advanceTimersByTimeAsync(200);
  expect(mockSpeech.speak).toHaveBeenCalledTimes(1);
  voice.stopSpeaking(); expect(await playback).toBe(false);
});

test('a stalled offline voice is stopped before hands-free can resume listening', async () => {
  mockMode = 'offline';
  const playback = voice.speak('Hello', 'en');
  await jest.advanceTimersByTimeAsync(2300);
  await expect(playback).resolves.toBe(false);
  expect(mockSpeech.stop).toHaveBeenCalledTimes(2);
  expect(mockGenerate).not.toHaveBeenCalled();
});
