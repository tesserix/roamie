import { afterEach, expect, jest, test } from '@jest/globals';
import * as Speech from 'expo-speech';
import { speak, stopSpeaking } from '../voice';

jest.mock('expo-speech', () => ({ stop: jest.fn(async () => {}), speak: jest.fn(), getAvailableVoicesAsync: jest.fn(async () => []) }));
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
