import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { requireOptionalNativeModule } from 'expo-modules-core';
import * as Speech from 'expo-speech';
import { fetch as cloudFetch } from 'expo/fetch';
import { speak, stopSpeaking } from '../voice';
import { saveTranslationPreferences } from '../translation-preferences';

jest.mock('expo-modules-core', () => ({ ...jest.requireActual<object>('expo-modules-core'), requireOptionalNativeModule: jest.fn() }));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en', regionCode: 'US' }] }));
jest.mock('expo-speech', () => ({ stop: jest.fn(async () => {}), speak: jest.fn(), getAvailableVoicesAsync: jest.fn(async () => [{ identifier: 'english-offline', language: 'en-US' }, { identifier: 'french-network', language: 'fr-FR' }]) }));
jest.mock('expo-audio', () => ({ createAudioPlayer: jest.fn(), setAudioModeAsync: jest.fn(async () => {}) }));
jest.mock('expo-file-system', () => ({ Paths: { cache: 'file:///cache/' }, File: class {} }));
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}) }));
jest.mock('../auth-client', () => ({ API_BASE: 'https://example.test', session: { current: () => null, accessToken: jest.fn(async () => 'test-token') } }));

beforeEach(async () => {
  jest.clearAllMocks();
  jest.mocked(requireOptionalNativeModule).mockReturnValue({ offlineVoices: jest.fn(async () => [{ identifier: 'english-offline', language: 'en-US' }]) });
  await saveTranslationPreferences({ mode: 'auto' });
});
afterEach(() => { stopSpeaking(); });

test('a network-dependent installed voice is never used by the guest offline tool', async () => {
  await expect(speak('Bonjour', 'fr', undefined, undefined, true)).resolves.toBe(false);
  expect(Speech.speak).not.toHaveBeenCalled();
  expect(cloudFetch).not.toHaveBeenCalled();
});

test('an offline voice failure keeps the translation on screen instead of generating cloud audio', async () => {
  await saveTranslationPreferences({ mode: 'offline' });
  const playback = speak('Hello', 'en');
  for (let i = 0; i < 25; i++) await Promise.resolve();
  expect(Speech.speak).toHaveBeenCalledTimes(1);
  jest.mocked(Speech.speak).mock.calls[0][1]?.onError?.(new Error('Voice missing'));
  await expect(playback).resolves.toBe(false);
  expect(cloudFetch).not.toHaveBeenCalled();
});
