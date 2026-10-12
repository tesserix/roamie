import { afterEach, expect, jest, test } from '@jest/globals';
import * as Speech from 'expo-speech';
import { synthesizeSpeech } from '../api';
import { createAudioPlayer } from 'expo-audio';
import { speak, stopSpeaking } from '../voice';

jest.mock('expo-speech', () => ({ stop: jest.fn(async () => {}), speak: jest.fn(), getAvailableVoicesAsync: jest.fn(async () => [{ identifier: 'english', language: 'en-US' }]) }));
jest.mock('../api', () => ({ synthesizeSpeech: jest.fn() }));
jest.mock('expo-audio', () => ({ createAudioPlayer: jest.fn(), setAudioModeAsync: jest.fn(async () => {}) }));
jest.mock('expo-file-system', () => ({ Paths: { cache: 'file:///cache/' }, File: class { uri = 'file:///cache/speech.wav'; exists = true; write() {} delete() {} } }));
afterEach(() => { stopSpeaking(); jest.clearAllMocks(); });

test('speech finishes only after playback completes, so listening cannot restart early', async () => {
  let completed = false;
  const playback = speak('Hello', 'en').then(result => { completed = true; return result; });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(Speech.speak).toHaveBeenCalledTimes(1);
  expect(completed).toBe(false);
  jest.mocked(Speech.speak).mock.calls[0][1]?.onDone?.();
  expect(await playback).toBe(true);
});

test('stopping speech releases the waiting conversation without reporting successful playback', async () => {
  const playback = speak('Hello', 'en');
  for (let i = 0; i < 10; i++) await Promise.resolve();
  stopSpeaking();
  expect(await playback).toBe(false);
});

test('Odia without a device voice uses generated audio and waits for the listener to hear it', async () => {
  jest.mocked(synthesizeSpeech).mockResolvedValue({ data: 'UklGRg==', mimeType: 'audio/wav' });
  let finish!: (status: { didJustFinish: boolean }) => void;
  const player = { addListener: jest.fn((_event: string, callback: typeof finish) => { finish = callback; return { remove: jest.fn() }; }), play: jest.fn(), pause: jest.fn(), remove: jest.fn() };
  jest.mocked(createAudioPlayer).mockReturnValue(player as never);
  let completed = false;
  const playback = speak('ଧନ୍ୟବାଦ', 'or').then(result => { completed = true; return result; });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(synthesizeSpeech).toHaveBeenCalledWith('ଧନ୍ୟବାଦ', 'or', undefined, expect.any(AbortSignal));
  expect(Speech.speak).not.toHaveBeenCalled();
  expect(player.play).toHaveBeenCalledTimes(1);
  expect(completed).toBe(false);
  finish({ didJustFinish: true });
  expect(await playback).toBe(true);
  expect(player.remove).toHaveBeenCalledTimes(1);
});


test('stopping a generated voice cancels synthesis and never plays its late response', async () => {
  let finish!: (result: { data: string; mimeType: 'audio/wav' }) => void;
  jest.mocked(synthesizeSpeech).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  jest.mocked(createAudioPlayer).mockClear();
  const playback = speak('ଧନ୍ୟବାଦ', 'or');
  for (let i = 0; i < 10; i++) await Promise.resolve();
  const signal = jest.mocked(synthesizeSpeech).mock.calls[0][3]!;
  stopSpeaking();
  expect(await playback).toBe(false);
  expect(signal.aborted).toBe(true);
  finish({ data: 'UklGRg==', mimeType: 'audio/wav' });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(createAudioPlayer).not.toHaveBeenCalled();
});
