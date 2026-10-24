import { expect, jest, test } from '@jest/globals';
import { waitFor } from '@testing-library/react-native';
import * as Speech from 'expo-speech';
import { speak, stopSpeaking } from '../voice';
const mockNative = {
  status: async () => ({ online: false, wifi: false, supported: ['en'], downloaded: ['en'] }),
  offlineVoices: async () => [{ identifier: 'downloaded-english', language: 'en-US' }],
};
jest.mock('expo', () => ({ ...jest.requireActual<Record<string, unknown>>('expo'), requireOptionalNativeModule: (name: string) => name === 'RoamieOffline' ? mockNative : null }));
jest.mock('expo-speech', () => ({ stop: jest.fn(async () => {}), speak: jest.fn(), getAvailableVoicesAsync: jest.fn(async () => []) }));
test('airplane-mode playback chooses a verified device voice without cloud synthesis', async () => {
  const playback = speak('Hello', 'en');
  await waitFor(() => expect(Speech.speak).toHaveBeenCalledWith('Hello', expect.objectContaining({ voice: 'downloaded-english' })));
  jest.mocked(Speech.speak).mock.calls[0][1]?.onDone?.();
  await expect(playback).resolves.toBe(true);
  expect(Speech.getAvailableVoicesAsync).not.toHaveBeenCalled();
  stopSpeaking();
});
