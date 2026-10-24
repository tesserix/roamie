import { afterEach, expect, jest, test } from '@jest/globals';
import { Platform } from 'react-native';
import { waitFor } from '@testing-library/react-native';
import { cancelOfflineRecognition, offlineSpeechStatus, recognizeOffline } from '../offline-speech';
const mockVoices = jest.fn<() => Promise<{ identifier: string; language: string }[]>>(async () => []);
const mockListeners = new Map<string, (event: unknown) => void>();
const mockSpeech = {
  supportsOnDeviceRecognition: jest.fn(() => true),
  getSupportedLocales: jest.fn(async () => ({ locales: ['en-US', 'fr-FR'], installedLocales: ['en-US'] })),
  requestMicrophonePermissionsAsync: jest.fn(async () => ({ granted: true })),
  start: jest.fn(), abort: jest.fn(), stop: jest.fn(),
  addListener: jest.fn((name: string, handler: (event: unknown) => void) => { mockListeners.set(name, handler); return { remove: () => mockListeners.delete(name) }; }),
};
jest.mock('expo', () => ({ ...jest.requireActual<Record<string, unknown>>('expo'), requireOptionalNativeModule: (name: string) => name === 'ExpoSpeechRecognition' ? mockSpeech : { offlineVoices: mockVoices } }));
afterEach(() => { cancelOfflineRecognition(); jest.useRealTimers(); jest.restoreAllMocks(); jest.clearAllMocks(); });
test('offline dictation never starts when the speech language is not installed', async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  await expect(recognizeOffline('fr')).rejects.toThrow('speech');
  expect(mockSpeech.start).not.toHaveBeenCalled();
});
test('dictation requires local recognition and releases listeners after the final result', async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  const pending = recognizeOffline('en').then(value => ({ value }), error => ({ error }));
  await waitFor(() => expect(mockSpeech.start).toHaveBeenCalledWith(expect.objectContaining({ lang: 'en-US', requiresOnDeviceRecognition: true, continuous: false })));
  mockListeners.get('result')?.({ isFinal: true, results: [{ transcript: 'Where is the station?' }] });
  await expect(pending).resolves.toEqual({ value: 'Where is the station?' });
  expect(mockListeners.size).toBe(0);
  expect(mockSpeech.abort).toHaveBeenCalled();
});
test('closing while microphone permission is pending never starts recognition later', async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  let grant!: (permission: { granted: boolean }) => void;
  mockSpeech.requestMicrophonePermissionsAsync.mockImplementationOnce(() => new Promise(resolve => { grant = resolve; }));
  let settled: unknown;
  const pending = recognizeOffline('en').then(value => { settled = value; }, error => { settled = error.message; });
  await waitFor(() => expect(mockSpeech.requestMicrophonePermissionsAsync).toHaveBeenCalled());
  cancelOfflineRecognition(); grant({ granted: true });
  await waitFor(() => expect(settled).toMatch(/cancelled/));
  await pending;
  expect(mockSpeech.start).not.toHaveBeenCalled();
});

test.each(['voices', 'recognizer'])('unresponsive %s inventory does not block offline readiness indefinitely', async (provider) => {
  jest.useFakeTimers();
  jest.replaceProperty(Platform, 'OS', 'android');
  if (provider === 'voices') mockVoices.mockImplementationOnce(() => new Promise(() => {}));
  else mockSpeech.getSupportedLocales.mockImplementationOnce(() => new Promise(() => {}));
  let result: Awaited<ReturnType<typeof offlineSpeechStatus>> | undefined;
  void offlineSpeechStatus('en', 'fr').then(value => { result = value; });
  await jest.advanceTimersByTimeAsync(5000);
  expect(result).toEqual({ inputLocale: provider === 'voices' ? 'en-US' : null, downloadableLocale: provider === 'voices' ? 'en-US' : null, voice: null });
});
