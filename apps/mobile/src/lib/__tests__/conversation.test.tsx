import { afterEach, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync, useAudioRecorder } from 'expo-audio';
import { AppState } from 'react-native';
import * as Speech from 'expo-speech';
import Talk from '../../app/index';
import { StoreProvider, useStore } from '../store';
import { session } from '../auth-client';
import { AccessibilityProvider } from '../accessibility';
import * as NativeBridge from '../../../modules/roamie-offline';
import * as LocalFiles from 'expo-file-system/legacy';
import { SPEECH_MODELS } from '../speech-models';

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(async () => {}) }));
jest.mock('expo-router', () => ({ useIsFocused: () => true }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('expo-location', () => ({ getForegroundPermissionsAsync: jest.fn(async () => ({ granted: false })) }));
jest.mock('expo-audio', () => {
  const recorder = { uri: 'file:///turn.m4a', prepareToRecordAsync: async () => {}, record: jest.fn(), stop: async () => {}, getStatus: () => ({ isRecording: true, durationMillis: 0, metering: -60, mediaServicesDidReset: false }) };
  return { RecordingPresets: { HIGH_QUALITY: {} }, getRecordingPermissionsAsync: jest.fn(async () => ({ granted: true })), requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: true })), setAudioModeAsync: jest.fn(async () => {}), useAudioRecorder: () => recorder };
});
jest.mock('expo/fetch', () => ({ fetch: (...args: Parameters<typeof global.fetch>) => global.fetch(...args) }));
jest.mock('expo-file-system', () => ({ File: class { exists = true; async base64() { return 'YXVkaW8='; } delete() {} } }));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: 'file:///documents/', getInfoAsync: jest.fn(async (uri: string) => ({ exists: false, isDirectory: false, uri })) }));
jest.mock('expo-speech', () => ({ VoiceQuality: { Default: 'Default', Enhanced: 'Enhanced' }, stop: jest.fn(), speak: jest.fn(), getAvailableVoicesAsync: jest.fn(async () => [{ identifier: 'english', language: 'en-US' }, { identifier: 'com.apple.voice.compact.en-US.Samantha', language: 'en-US' }, { identifier: 'com.apple.voice.compact.en-GB.Daniel', language: 'en-GB' }, { identifier: 'hindi', language: 'hi-IN' }, { identifier: 'odia-test', language: 'or-IN' }, { identifier: 'vietnamese-test', language: 'vi-VN' }, { identifier: 'thai-test', language: 'th-TH' }, { identifier: 'ja-test', language: 'ja-JP' }, { identifier: 'bn-test', language: 'bn-IN' }]) }));
jest.mock('expo-notifications', () => ({ cancelAllScheduledNotificationsAsync: jest.fn(async () => {}) }));

function ReadyTalk() { return useStore().ready ? <Talk /> : null; }
async function open(talkLanguage?: string | null) {
  AppState.currentState = 'active';
  jest.spyOn(session, 'current').mockReturnValue({ sub: 'conversation-test', name: 'Test traveller', email: 'test@example.invalid' });
  jest.mocked(AsyncStorage.getItem).mockImplementation(async key => key.startsWith('roamie.ai-consent.') ? 'allowed' : JSON.stringify({ profile: { language: 'en', homeCurrency: 'USD', budgetMinor: 0, diet: 'none' }, partner: null, talkLanguage, expenses: [] }));
  await render(<StoreProvider accountId="conversation-test"><ReadyTalk /></StoreProvider>);
}
const originalFetch = global.fetch;
const originalAppState = AppState.currentState;
afterEach(() => { jest.restoreAllMocks(); global.fetch = originalFetch; AppState.currentState = originalAppState; });

test('changing display size from Translate keeps settings open for another choice', async () => {
 jest.mocked(AsyncStorage.getItem).mockImplementation(async key => key === 'roamie.accessibility.v1' ? null : JSON.stringify({ profile: { language: 'en', homeCurrency: 'USD', budgetMinor: 0, diet: 'none' }, expenses: [] }));
 await render(<AccessibilityProvider><StoreProvider accountId="display-test"><ReadyTalk /></StoreProvider></AccessibilityProvider>);
 await fireEvent.press(await screen.findByRole('button', {name: 'Profile settings'}));
 await fireEvent.press(screen.getByRole('radio', {name: 'Large text'}));
 expect(screen.getByRole('radio', {name: 'Normal text'})).toBeTruthy();
 await fireEvent.press(screen.getByRole('button', {name: 'Reset display to normal'}));
 expect(screen.getByRole('radio', {name: 'Normal text'}).props.accessibilityState.checked).toBe(true);
});

test('microphone starts without a partner language or location permission', async () => {
  jest.mocked(getRecordingPermissionsAsync).mockResolvedValueOnce({ granted: false } as never);
  await open();
  await fireEvent.press(await screen.findByRole('button', { name: 'Start recording' }));
  expect(requestRecordingPermissionsAsync).toHaveBeenCalled();
  expect(await screen.findByRole('button', { name: 'Finish and translate' })).toBeTruthy();
});

test('opening Profile during hands-free stops listening and keeps offline settings accessible', async () => {
  await open();
  const recorder = useAudioRecorder({} as never);
  const stop = jest.spyOn(recorder, 'stop');
  await fireEvent.press(screen.getByRole('button', { name: 'Start hands-free conversation' }));
  expect(await screen.findByText('Listening · pause to translate')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Profile settings' }));
  expect(screen.getByRole('button', { name: 'Offline languages' })).toBeTruthy();
  await waitFor(() => expect(stop).toHaveBeenCalled());
  await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
  expect(await screen.findByRole('button', { name: 'Start hands-free conversation' })).toBeTruthy();
});

test('Translate confirms verified downloads and identifies a missing speech detector', async () => {
  let detectorDownloaded = false;
  jest.spyOn(NativeBridge, 'offlineNative').mockReturnValue({
    supportedTextLanguages: async () => ['en', 'vi'],
    downloadedLanguages: async () => [],
    isTranslationReady: async () => true,
    sha256: async uri => uri.includes('silero') ? SPEECH_MODELS.vad.sha256 : SPEECH_MODELS.base.sha256,
    canRemoveLanguagePacks: async () => true,
    downloadLanguage: async () => {}, removeLanguage: async () => {},
    identifyLanguage: async () => 'en', translate: async () => 'Hello',
    recognizeText: async () => [], offlineVoices: async () => [], ocrLanguages: async () => [],
    audioToWav: async uri => uri, availableMemory: async () => 8 * 1024 ** 3,
  });
  jest.spyOn(LocalFiles, 'getInfoAsync').mockImplementation(async uri => uri.includes('silero') && !detectorDownloaded ? { exists: false, isDirectory: false, uri } : { exists: true, isDirectory: false, uri, modificationTime: 1, size: uri.includes('silero') ? SPEECH_MODELS.vad.bytes : SPEECH_MODELS.base.bytes });
  await open();
  await fireEvent.press(screen.getByRole('button', { name: 'Their language: Auto-detect. Choose manually' }));
  await fireEvent.changeText(screen.getByLabelText('Search languages'), 'Vietnamese');
  await fireEvent.press(screen.getByRole('button', { name: 'Vietnamese' }));
  expect(await screen.findByText('English ↔ Vietnamese · Ready on this phone')).toBeTruthy();
  expect(screen.getByText('Base speech model · Downloaded and verified · 60 MB')).toBeTruthy();
  expect(screen.getByText('Speech detector · Not downloaded')).toBeTruthy();
  expect(screen.queryByText('Offline conversation is ready')).toBeNull();
  detectorDownloaded = true;
  await fireEvent.press(screen.getByRole('button', { name: 'Refresh offline status' }));
  expect(await screen.findByText('Offline conversation is ready')).toBeTruthy();
});

test('manual capture with granted permission does not open another Android permission request', async () => {
  await open();
  jest.mocked(requestRecordingPermissionsAsync).mockClear();
  await fireEvent.press(screen.getByRole('button', { name: 'Start recording' }));
  expect(getRecordingPermissionsAsync).toHaveBeenCalled();
  expect(requestRecordingPermissionsAsync).not.toHaveBeenCalled();
});

test('Hindi is detected first and an English reply uses the remembered Hindi target', async () => {
  jest.spyOn(session, 'accessToken').mockResolvedValue('test-token');
  const replies = [
    { detected: 'hi', partner: 'hi', target: 'en', transcript: 'नमस्ते', translation: 'Hello', romanized: '', sameLanguage: false },
    { detected: 'en', partner: 'hi', target: 'hi', transcript: 'Thank you', translation: 'धन्यवाद', romanized: 'Dhanyavaad', sameLanguage: false },
  ];
  const fetch = jest.fn<typeof global.fetch>().mockImplementation(async () => ({ ok: true, status: 200, json: async () => replies.shift() }) as Response);
  global.fetch = fetch;
  await open();
  await fireEvent.press(await screen.findByRole('button', { name: 'Type instead' }));
  await fireEvent.changeText(screen.getByLabelText('Type something to translate'), 'नमस्ते');
  await fireEvent.press(screen.getByRole('button', { name: 'Translate' }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  expect(await screen.findByRole('button', { name: 'Their language: Hindi. Change' })).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Show them' }));
  expect(screen.getAllByText('Hello')).toHaveLength(2);

  await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
  await fireEvent.changeText(screen.getByLabelText('Type something to translate'), 'Thank you');
  await fireEvent.press(screen.getByRole('button', { name: 'Translate' }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetch.mock.calls[0][1]?.body as string)).toMatchObject({ mine: 'en', partner: 'en' });
  expect(JSON.parse(fetch.mock.calls[1][1]?.body as string)).toMatchObject({ mine: 'en', partner: 'hi' });
  await waitFor(() => expect(Speech.speak).toHaveBeenCalledWith('धन्यवाद', expect.objectContaining({ language: 'hi' })));
  const actions = screen.getAllByRole('button', { name: 'Show them' });
  expect(actions).toHaveLength(2);
  await fireEvent.press(actions[1]);
  expect(screen.getAllByText('धन्यवाद')).toHaveLength(2);
  await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
});

test.each([
  ['matches the speaker', 'match', 'com.apple.voice.compact.en-GB.Daniel'],
  ['keeps a chosen female voice', 'female', 'com.apple.voice.compact.en-US.Samantha'],
])('translation playback %s', async (_, voice, want) => {
  jest.spyOn(session, 'accessToken').mockResolvedValue('test-token');
  global.fetch = jest.fn<typeof global.fetch>().mockResolvedValue({ ok: true, status: 200, json: async () => ({ detected: 'hi', partner: 'hi', target: 'en', transcript: 'नमस्ते', translation: 'Hello', romanized: '', sameLanguage: false, voice: 'male' }) } as Response);
  jest.spyOn(session, 'current').mockReturnValue({ sub: 'conversation-test', name: 'Test traveller', email: 'test@example.invalid' });
  jest.mocked(AsyncStorage.getItem).mockImplementation(async key => key.startsWith('roamie.ai-consent.') ? 'allowed' : key === 'roamie.accessibility.v1' ? JSON.stringify({ voice }) : JSON.stringify({ profile: { language: 'en', homeCurrency: 'USD', budgetMinor: 0, diet: 'none' }, partner: null, talkLanguage: null, expenses: [] }));
  await render(<AccessibilityProvider><StoreProvider accountId="conversation-test"><ReadyTalk /></StoreProvider></AccessibilityProvider>);
  await fireEvent.press(await screen.findByRole('button', { name: 'Type instead' }));
  await fireEvent.changeText(screen.getByLabelText('Type something to translate'), 'नमस्ते');
  await fireEvent.press(screen.getByRole('button', { name: 'Translate' }));
  await waitFor(() => expect(Speech.speak).toHaveBeenLastCalledWith('Hello', expect.objectContaining({ voice: want })));
});

test.each([
  { detected: 'hi', target: 'en', transcript: 'नमस्ते', translation: 'Hello', romanized: '' },
  { detected: 'en', target: 'hi', transcript: 'Thank you', translation: 'धन्यवाद', romanized: 'Dhanyavaad' },
])('Show them displays the translation in $target when the speaker uses $detected', async reply => {
  jest.spyOn(session, 'accessToken').mockResolvedValue('test-token');
  global.fetch = jest.fn<typeof global.fetch>().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ...reply, partner: 'hi', sameLanguage: false }) } as Response);
  await open('en');
  await fireEvent.press(await screen.findByRole('button', { name: 'Type instead' }));
  await fireEvent.changeText(screen.getByLabelText('Type something to translate'), reply.transcript);
  await fireEvent.press(screen.getByRole('button', { name: 'Translate' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Show them' }));
  const enlarged = screen.getByTestId('enlarged-conversation');
  expect(screen.getAllByText(reply.translation)).toHaveLength(2);
  expect(screen.getAllByText(reply.transcript)).toHaveLength(1);
  expect(within(enlarged).getByText(reply.translation).props.accessibilityLanguage).toBe(reply.target);
  if (reply.romanized) expect(within(enlarged).getByText(reply.romanized)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
});

test('a selected partner language stays fixed and a Japanese reply targets the last detected Bengali', async () => {
  jest.spyOn(session, 'accessToken').mockResolvedValue('test-token');
  jest.mocked(Speech.speak).mockImplementationOnce((_text, options) => { options?.onDone?.(); }).mockImplementationOnce((_text, options) => { options?.onDone?.(); });
  const replies = [
    { detected: 'bn', mine: 'bn', fromMe: true, partner: 'ja', target: 'ja', transcript: 'স্টেশনে কীভাবে যাব?', translation: '駅にはどう行けばいいですか。', sameLanguage: false },
    { detected: 'ja', mine: 'bn', fromMe: false, partner: 'ja', target: 'bn', transcript: 'まっすぐ行ってください。', translation: 'সোজা যান।', sameLanguage: false },
  ];
  const fetch = jest.fn<typeof global.fetch>().mockImplementation(async () => ({ ok: true, status: 200, json: async () => replies.shift() }) as Response);
  global.fetch = fetch;
  await open();
  await fireEvent.press(screen.getByRole('button', { name: 'Their language: Auto-detect. Choose manually' }));
  await fireEvent.changeText(screen.getByLabelText('Search languages'), 'Japanese');
  await fireEvent.press(screen.getByRole('button', { name: 'Japanese' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Type instead' }));
  for (const text of ['স্টেশনে কীভাবে যাব?', 'まっすぐ行ってください。']) {
    await fireEvent.changeText(screen.getByLabelText('Type something to translate'), text);
    await fireEvent.press(screen.getByRole('button', { name: 'Translate' }));
    await waitFor(() => expect(screen.queryByText('Finding the words…')).toBeNull());
  }
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetch.mock.calls[1][1]?.body as string)).toMatchObject({ mine: 'bn', partner: 'ja', partnerLocked: true, expectedSpeaker: 'mine' });
  expect(screen.getByRole('button', { name: 'Their language: Japanese. Change' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Your language: Auto-detect (Bengali). Change' })).toBeTruthy();
  expect(screen.getByText('সোজা যান।')).toBeTruthy();
});

test('speaking the preferred language first does not invent a partner language', async () => {
  jest.spyOn(session, 'accessToken').mockResolvedValue('test-token');
  global.fetch = jest.fn<typeof global.fetch>().mockResolvedValue({ ok: true, status: 200, json: async () => ({ detected: 'en', partner: 'en', target: 'en', transcript: 'Hello', translation: 'Hello', sameLanguage: true }) } as Response);
  await open();
  await fireEvent.press(await screen.findByRole('button', { name: 'Type instead' }));
  await fireEvent.changeText(screen.getByLabelText('Type something to translate'), 'Hello');
  await fireEvent.press(screen.getByRole('button', { name: 'Translate' }));
  expect(await screen.findByText('Let the other person speak once so we can detect their language, or choose it above.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Their language: Auto-detect. Choose manually' })).toBeTruthy();
});

test('a pending turn is visible and keyboard submit cannot queue duplicate translations', async () => {
  jest.spyOn(session, 'accessToken').mockResolvedValue('test-token');
  let finish!: (response: Response) => void;
  const fetch = jest.fn<typeof global.fetch>().mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  global.fetch = fetch;
  await open();
  await fireEvent.press(await screen.findByRole('button', { name: 'Type instead' }));
  const input = screen.getByLabelText('Type something to translate');
  await fireEvent.changeText(input, 'नमस्ते');
  await fireEvent(input, 'submitEditing');
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  expect(screen.getByText('नमस्ते')).toBeTruthy();
  expect(screen.getByText('Finding the words…')).toBeTruthy();
  await fireEvent.changeText(input, 'Next turn');
  await fireEvent(input, 'submitEditing');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('Type something to translate').props.value).toBe('Next turn');
  await act(async () => { finish({ ok: true, status: 200, json: async () => ({ detected: 'hi', partner: 'hi', target: 'en', transcript: 'नमस्ते', translation: 'Hello', sameLanguage: false }) } as Response); });
  expect(await screen.findByText('Hello')).toBeTruthy();
  expect(screen.queryByText('Finding the words…')).toBeNull();
});

test('a failed translation restores the submitted text for retry', async () => {
  jest.spyOn(session, 'accessToken').mockResolvedValue('test-token');
  global.fetch = jest.fn<typeof global.fetch>().mockRejectedValue(new Error('network unavailable'));
  await open();
  await fireEvent.press(await screen.findByRole('button', { name: 'Type instead' }));
  await fireEvent.changeText(screen.getByLabelText('Type something to translate'), 'Please help');
  await fireEvent.press(screen.getByRole('button', { name: 'Translate' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByLabelText('Type something to translate').props.value).toBe('Please help');
  expect(screen.queryByText('Finding the words…')).toBeNull();
});


test('hands-free has a persistent stop control that returns to manual recording', async () => {
  await open();
  expect(screen.getByText('Hands-free')).toBeTruthy();
  expect(screen.getByText('Type')).toBeTruthy();
  await fireEvent.press(await screen.findByRole('button', { name: 'Start hands-free conversation' }));
  expect(await screen.findByRole('button', { name: 'Stop hands-free conversation' })).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Stop hands-free conversation' }));
  expect(await screen.findByRole('button', { name: 'Start hands-free conversation' })).toBeTruthy();
});


test('hands-free detects Hindi, waits for speech playback, then translates an English reply to Hindi', async () => {
  jest.spyOn(session, 'accessToken').mockResolvedValue('test-token');
  const replies = [
    { detected: 'hi', partner: 'hi', target: 'en', transcript: 'नमस्ते', translation: 'Hello', sameLanguage: false },
    { detected: 'en', partner: 'hi', target: 'hi', transcript: 'Thank you', translation: 'धन्यवाद', sameLanguage: false },
  ];
  const fetch = jest.fn<typeof global.fetch>().mockImplementation(async () => ({ ok: true, status: 200, json: async () => replies.shift() }) as Response);
  global.fetch = fetch;
  const recorder = useAudioRecorder({} as never);
  let level = -20;
  jest.spyOn(recorder, 'getStatus').mockImplementation(() => ({ isRecording: true, canRecord: true, durationMillis: 0, metering: level, mediaServicesDidReset: false, url: recorder.uri }));
  jest.mocked(Speech.speak).mockClear();
  await open();
  jest.useFakeTimers();
  try {
    await fireEvent.press(screen.getByRole('button', { name: 'Start hands-free conversation' }));
    await act(async () => { await jest.advanceTimersByTimeAsync(500); });
    level = -60;
    await act(async () => { await jest.advanceTimersByTimeAsync(1300); });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(Speech.speak).toHaveBeenLastCalledWith('Hello', expect.objectContaining({ language: 'en' }));
    expect(screen.queryByText('Finding the words…')).toBeNull();
    await act(async () => { await jest.advanceTimersByTimeAsync(3000); });
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => { jest.mocked(Speech.speak).mock.calls[0][1]?.onDone?.(); await jest.advanceTimersByTimeAsync(400); });
    level = -20;
    await act(async () => { await jest.advanceTimersByTimeAsync(500); });
    level = -60;
    await act(async () => { await jest.advanceTimersByTimeAsync(1300); });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[1][1]?.body as string)).toMatchObject({ mine: 'en', partner: 'hi' });
    expect(Speech.speak).toHaveBeenLastCalledWith('धन्यवाद', expect.objectContaining({ language: 'hi' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Stop hands-free conversation' }));
    await act(async () => { await jest.advanceTimersByTimeAsync(500); });
    expect(screen.getByRole('button', { name: 'Start hands-free conversation' })).toBeTruthy();
  } finally { jest.useRealTimers(); }
});

test('backgrounding the app ends hands-free capture without restarting on foreground', async () => {
  const subscribe = jest.spyOn(AppState, 'addEventListener');
  await open();
  await fireEvent.press(screen.getByRole('button', { name: 'Start hands-free conversation' }));
  const listeners = subscribe.mock.calls.filter(([event]) => event === 'change').map(([, listener]) => listener);
  await act(async () => { listeners.forEach(listener => listener('background')); });
  expect(await screen.findByRole('button', { name: 'Start hands-free conversation' })).toBeTruthy();
  await act(async () => { listeners.forEach(listener => listener('active')); });
  expect(screen.queryByRole('button', { name: 'Stop hands-free conversation' })).toBeNull();
});

test('backgrounding cancels manual capture and returns ready without sending partial audio', async () => {
  const subscribe = jest.spyOn(AppState, 'addEventListener');
  const recorder = useAudioRecorder({} as never);
  const stop = jest.spyOn(recorder, 'stop');
  const fetch = jest.fn<typeof global.fetch>();
  global.fetch = fetch;
  await open();
  stop.mockClear();
  jest.mocked(recorder.record).mockClear();
  await fireEvent.press(screen.getByRole('button', { name: 'Start recording' }));
  expect(recorder.record).toHaveBeenCalledTimes(1);
  const listeners = subscribe.mock.calls.filter(([event]) => event === 'change').map(([, listener]) => listener);
  await act(async () => { AppState.currentState = 'background'; listeners.forEach(listener => listener('background')); });
  expect(stop).toHaveBeenCalledTimes(1);
  await act(async () => { AppState.currentState = 'active'; listeners.forEach(listener => listener('active')); });
  expect(screen.getByRole('button', { name: 'Start recording' }).props.accessibilityState.disabled).toBe(false);
  expect(recorder.record).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
});

test('returning from background cannot start a microphone that was still preparing', async () => {
  const subscribe = jest.spyOn(AppState, 'addEventListener');
  const recorder = useAudioRecorder({} as never);
  let prepare!: () => void;
  const preparing = jest.spyOn(recorder, 'prepareToRecordAsync').mockImplementationOnce(() => new Promise(resolve => { prepare = resolve; }));
  await open();
  preparing.mockClear();
  jest.mocked(recorder.record).mockClear();
  await fireEvent.press(screen.getByRole('button', { name: 'Start recording' }));
  await waitFor(() => expect(preparing).toHaveBeenCalledTimes(1));
  const listeners = subscribe.mock.calls.filter(([event]) => event === 'change').map(([, listener]) => listener);
  await act(async () => { AppState.currentState = 'background'; listeners.forEach(listener => listener('background')); });
  await act(async () => { AppState.currentState = 'active'; listeners.forEach(listener => listener('active')); prepare(); });
  expect(recorder.record).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Start recording' }).props.accessibilityState.disabled).toBe(false);
});

test('backgrounding while finishing capture does not stop the native recorder twice or send stale audio', async () => {
  const subscribe = jest.spyOn(AppState, 'addEventListener');
  const recorder = useAudioRecorder({} as never);
  let finish!: () => void;
  const stop = jest.spyOn(recorder, 'stop').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const fetch = jest.fn<typeof global.fetch>();
  global.fetch = fetch;
  await open();
  stop.mockClear();
  await fireEvent.press(screen.getByRole('button', { name: 'Start recording' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Finish and translate' }));
  const listeners = subscribe.mock.calls.filter(([event]) => event === 'change').map(([, listener]) => listener);
  await act(async () => { AppState.currentState = 'background'; listeners.forEach(listener => listener('background')); });
  expect(stop).toHaveBeenCalledTimes(1);
  await act(async () => { AppState.currentState = 'active'; listeners.forEach(listener => listener('active')); finish(); });
  expect(fetch).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Start recording' }).props.accessibilityState.disabled).toBe(false);
});

test('stopping hands-free discards a late translation without speaking or restarting', async () => {
  jest.spyOn(session, 'accessToken').mockResolvedValue('test-token');
  let finish!: (response: Response) => void;
  global.fetch = jest.fn<typeof global.fetch>().mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const recorder = useAudioRecorder({} as never);
  let level = -20;
  jest.spyOn(recorder, 'getStatus').mockImplementation(() => ({ isRecording: true, canRecord: true, durationMillis: 0, metering: level, mediaServicesDidReset: false, url: recorder.uri }));
  jest.mocked(Speech.speak).mockClear();
  await open();
  jest.useFakeTimers();
  try {
    await fireEvent.press(screen.getByRole('button', { name: 'Start hands-free conversation' }));
    await act(async () => { await jest.advanceTimersByTimeAsync(500); });
    level = -60;
    await act(async () => { await jest.advanceTimersByTimeAsync(1300); });
    await fireEvent.press(screen.getByRole('button', { name: 'Stop hands-free conversation' }));
    expect(jest.mocked(global.fetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
    await act(async () => { await jest.advanceTimersByTimeAsync(100); });
    expect(screen.getByRole('button', { name: 'Start hands-free conversation' }).props.accessibilityState.disabled).toBe(true);
    await act(async () => {
      finish({ ok: true, status: 200, json: async () => ({ detected: 'hi', partner: 'hi', target: 'en', transcript: 'नमस्ते', translation: 'Hello', sameLanguage: false }) } as Response);
    });
    expect(Speech.speak).not.toHaveBeenCalled();
    expect(screen.queryByText('Hello')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stop hands-free conversation' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Start hands-free conversation' }).props.accessibilityState.disabled).toBe(false);
  } finally { jest.useRealTimers(); }
});


test('a speech failure keeps the translated turn and tells the traveller how to retry playback', async () => {
  jest.spyOn(session, 'accessToken').mockResolvedValue('test-token');
  global.fetch = jest.fn<typeof global.fetch>().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ detected: 'hi', partner: 'hi', target: 'en', transcript: 'नमस्ते', translation: 'Hello', sameLanguage: false }) } as Response).mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ error: 'unavailable', message: 'Speech unavailable.' }) } as Response);
  jest.mocked(Speech.speak).mockClear();
  await open();
  await fireEvent.press(await screen.findByRole('button', { name: 'Type instead' }));
  await fireEvent.changeText(screen.getByLabelText('Type something to translate'), 'नमस्ते');
  await fireEvent.press(screen.getByRole('button', { name: 'Translate' }));
  await waitFor(() => expect(Speech.speak).toHaveBeenCalled());
  await act(async () => { jest.mocked(Speech.speak).mock.calls[0][1]?.onError?.(new Error('unavailable')); });
  expect(await screen.findByText('The translation is ready, but speech could not play. Tap Read aloud to retry or use Show them.')).toBeTruthy();
  expect(screen.getByText('Hello')).toBeTruthy();
  expect(global.fetch).toHaveBeenCalledTimes(2);
  expect(jest.mocked(global.fetch).mock.calls[1][0]).toContain('/v1/talk/speech');
});

test('a JEV review turn stays visible without speaking or remembering an uncertain new language', async () => {
  jest.spyOn(session, 'accessToken').mockResolvedValue('test-token');
  const fetch = jest.fn<typeof global.fetch>().mockResolvedValue({ ok: true, status: 200, json: async () => ({ detected: 'or', partner: 'or', target: 'en', transcript: 'ନମସ୍କାର', translation: 'Hello', reviewRequired: true, decisionModel: 'jev-1.13.0', sameLanguage: false }) } as Response);
  global.fetch = fetch;
  jest.mocked(Speech.speak).mockClear();
  await open();
  await fireEvent.press(await screen.findByRole('button', { name: 'Type instead' }));
  await fireEvent.changeText(screen.getByLabelText('Type something to translate'), 'ନମସ୍କାର');
  await fireEvent.press(screen.getByRole('button', { name: 'Translate' }));
  expect(await screen.findByText('Check this translation before using it. Clarify the phrase or choose the languages above.')).toBeTruthy();
  expect(screen.getByText('Hello')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Their language: Auto-detect. Choose manually' })).toBeTruthy();
  expect(Speech.speak).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('You Auto follows an accepted reply language and an explicit selection stays fixed', async () => {
  jest.spyOn(session, 'accessToken').mockResolvedValue('test-token');
  const replies = [
    { detected: 'or', mine: 'en', fromMe: false, partner: 'or', target: 'en', transcript: 'ନମସ୍କାର', translation: 'Hello', sameLanguage: false },
    { detected: 'hi', mine: 'hi', fromMe: true, partner: 'or', target: 'or', transcript: 'धन्यवाद', translation: 'ଧନ୍ୟବାଦ', sameLanguage: false },
    { detected: 'fr', mine: 'en', fromMe: false, partner: 'fr', target: 'en', transcript: 'Bonjour', translation: 'Good morning', sameLanguage: false },
  ];
  const fetch = jest.fn<typeof global.fetch>().mockImplementation(async () => ({ ok: true, status: 200, json: async () => replies.shift() }) as Response);
  global.fetch = fetch;
  jest.mocked(Speech.speak).mockImplementation((_text, options) => { options?.onDone?.(); });
  await open();
  expect(screen.getByRole('button', { name: 'Your language: Auto-detect (English). Change' })).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Type instead' }));
  async function submit(text: string, count: number) {
    await fireEvent.changeText(screen.getByLabelText('Type something to translate'), text);
    await fireEvent.press(screen.getByRole('button', { name: 'Translate' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(count));
  }
  await submit('ନମସ୍କାର', 1);
  await submit('धन्यवाद', 2);
  expect(JSON.parse(fetch.mock.calls[1][1]?.body as string)).toMatchObject({ mine: 'en', partner: 'or', autoMine: true, expectedSpeaker: 'mine', history: [{ original: 'ନମସ୍କାର', translation: 'Hello' }] });
  expect(await screen.findByRole('button', { name: 'Your language: Auto-detect (Hindi). Change' })).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Your language: Auto-detect (Hindi). Change' }));
  await fireEvent.press(screen.getByRole('button', { name: 'English' }));
  await submit('Bonjour', 3);
  expect(JSON.parse(fetch.mock.calls[2][1]?.body as string)).toMatchObject({ mine: 'en', partner: 'or', autoMine: false });
  expect(screen.getByRole('button', { name: 'Your language: English. Change' })).toBeTruthy();
  expect(await screen.findByRole('button', { name: 'Their language: French. Change' })).toBeTruthy();
});

test('clearing cancels a pending reply and forgets recent context and detected partner', async () => {
  jest.spyOn(session, 'accessToken').mockResolvedValue('test-token');
  let finish!: (response: Response) => void;
  const fetch = jest.fn<typeof global.fetch>()
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ detected: 'hi', partner: 'hi', target: 'en', transcript: 'नमस्ते', translation: 'Hello', sameLanguage: false }) } as Response)
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValue({ ok: true, status: 200, json: async () => ({ detected: 'en', partner: 'en', target: 'en', transcript: 'New conversation', translation: 'New conversation', sameLanguage: true }) } as Response);
  global.fetch = fetch;
  jest.mocked(Speech.speak).mockImplementation((_text, options) => { options?.onDone?.(); });
  await open();
  await fireEvent.press(screen.getByRole('button', { name: 'Type instead' }));
  await fireEvent.changeText(screen.getByLabelText('Type something to translate'), 'नमस्ते');
  await fireEvent.press(screen.getByRole('button', { name: 'Translate' }));
  await screen.findByText('Hello');
  await fireEvent.changeText(screen.getByLabelText('Type something to translate'), 'Thank you');
  await fireEvent.press(screen.getByRole('button', { name: 'Translate' }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  await fireEvent.press(screen.getByRole('button', { name: 'Clear conversation' }));
  expect((fetch.mock.calls[1][1]?.signal as AbortSignal).aborted).toBe(true);
  await act(async () => finish({ ok: true, status: 200, json: async () => ({ detected: 'en', partner: 'hi', target: 'hi', transcript: 'Late reply', translation: 'धन्यवाद', sameLanguage: false }) } as Response));
  expect(screen.queryByText('Late reply')).toBeNull();
  expect(screen.getByRole('button', { name: 'Their language: Auto-detect. Choose manually' })).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Type something to translate'), 'New conversation');
  await fireEvent.press(screen.getByRole('button', { name: 'Translate' }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  expect(JSON.parse(fetch.mock.calls[2][1]?.body as string)).toMatchObject({ mine: 'en', partner: 'en', history: [] });
});

test('reopening remembers detected Vietnamese without turning off auto-detection', async () => {
  jest.spyOn(session, 'accessToken').mockResolvedValue('test-token');
  jest.mocked(Speech.speak).mockImplementation((_text, options) => { options?.onDone?.(); });
  const fetch = jest.fn<typeof global.fetch>().mockResolvedValue({ ok: true, status: 200, json: async () => ({ detected: 'vi', partner: 'vi', target: 'en', transcript: 'Xin chào', translation: 'Hello', sameLanguage: false }) } as Response);
  global.fetch = fetch;
  await open();
  await fireEvent.press(screen.getByRole('button', { name: 'Type instead' }));
  await fireEvent.changeText(screen.getByLabelText('Type something to translate'), 'Xin chào');
  await fireEvent.press(screen.getByRole('button', { name: 'Translate' }));
  await screen.findByText('Hello');
  await waitFor(() => expect(AsyncStorage.setItem).toHaveBeenCalled());
  const saved = jest.mocked(AsyncStorage.setItem).mock.calls.at(-1)![1];
  await screen.unmount();
  jest.mocked(AsyncStorage.getItem).mockImplementation(async key => key.startsWith('roamie.ai-consent.') ? 'allowed' : saved);
  await render(<StoreProvider accountId="conversation-test"><ReadyTalk /></StoreProvider>);
  expect(await screen.findByRole('button', { name: 'Their language: Vietnamese. Change' })).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Type instead' }));
  await fireEvent.changeText(screen.getByLabelText('Type something to translate'), 'Cảm ơn');
  await fireEvent.press(screen.getByRole('button', { name: 'Translate' }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetch.mock.calls[1][1]?.body as string)).toMatchObject({ mine: 'en', partner: 'vi', partnerLocked: false });
  await waitFor(() => expect(screen.queryByText('Finding the words…')).toBeNull());
  expect(screen.queryByText(/did not match/)).toBeNull();
});

test('clearing keeps a manually chosen partner language locked', async () => {
  jest.spyOn(session, 'accessToken').mockResolvedValue('test-token');
  jest.mocked(Speech.speak).mockImplementation((_text, options) => { options?.onDone?.(); });
  const fetch = jest.fn<typeof global.fetch>().mockResolvedValue({ ok: true, status: 200, json: async () => ({ detected: 'ja', partner: 'ja', target: 'en', transcript: 'こんにちは', translation: 'Hello', sameLanguage: false }) } as Response);
  global.fetch = fetch;
  await open();
  await fireEvent.press(screen.getByRole('button', { name: 'Their language: Auto-detect. Choose manually' }));
  await fireEvent.changeText(screen.getByLabelText('Search languages'), 'Japanese');
  await fireEvent.press(screen.getByRole('button', { name: 'Japanese' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Type instead' }));
  await fireEvent.changeText(screen.getByLabelText('Type something to translate'), 'こんにちは');
  await fireEvent.press(screen.getByRole('button', { name: 'Translate' }));
  await screen.findByText('Hello');
  await fireEvent.press(screen.getByRole('button', { name: 'Clear conversation' }));
  expect(screen.getByRole('button', { name: 'Their language: Japanese. Change' })).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Type something to translate'), 'こんにちは');
  await fireEvent.press(screen.getByRole('button', { name: 'Translate' }));
  await screen.findByText('Hello');
  expect(JSON.parse(fetch.mock.calls[1][1]?.body as string)).toMatchObject({ mine: 'en', partner: 'ja', partnerLocked: true });
});

test('a partner saved by an older version opens on auto-detect', async () => {
  AppState.currentState = 'active';
  jest.spyOn(session, 'current').mockReturnValue({ sub: 'conversation-test', name: 'Test traveller', email: 'test@example.invalid' });
  jest.mocked(AsyncStorage.getItem).mockImplementation(async key => key.startsWith('roamie.ai-consent.') ? 'allowed' : JSON.stringify({ profile: { language: 'en', homeCurrency: 'USD', budgetMinor: 0, diet: 'none' }, partner: 'or', talkLanguage: null, expenses: [] }));
  await render(<StoreProvider accountId="conversation-test"><ReadyTalk /></StoreProvider>);
  expect(await screen.findByRole('button', { name: 'Their language: Auto-detect. Choose manually' })).toBeTruthy();
});

test('an explicit partner language remains fixed after reopening the app', async () => {
  await open();
  await fireEvent.press(screen.getByRole('button', { name: 'Their language: Auto-detect. Choose manually' }));
  await fireEvent.changeText(screen.getByLabelText('Search languages'), 'Japanese');
  await fireEvent.press(screen.getByRole('button', { name: 'Japanese' }));
  await waitFor(() => expect(JSON.parse(jest.mocked(AsyncStorage.setItem).mock.calls.at(-1)![1]).talkPartner).toBe('ja'));
});

test('an explicit You language remains fixed after reopening the app', async () => {
  await open('fr');
  expect(screen.getByRole('button', { name: 'Your language: French. Change' })).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Your language: French. Change' }));
  await fireEvent.press(screen.getByRole('button', { name: 'English' }));
  await waitFor(() => expect(JSON.parse(jest.mocked(AsyncStorage.setItem).mock.calls.at(-1)![1]).talkLanguage).toBe('en'));
});

test('manual Read aloud waits for playback and reports a failed retry', async () => {
  jest.spyOn(session, 'accessToken').mockResolvedValue('test-token');
  global.fetch = jest.fn<typeof global.fetch>().mockResolvedValue({ ok: true, status: 200, json: async () => ({ detected: 'hi', partner: 'hi', target: 'en', transcript: 'नमस्ते', translation: 'Hello', sameLanguage: false }) } as Response);
  jest.mocked(Speech.speak).mockImplementationOnce((_text, options) => { options?.onDone?.(); }).mockImplementation(() => {});
  await open();
  await fireEvent.press(screen.getByRole('button', { name: 'Type instead' }));
  await fireEvent.changeText(screen.getByLabelText('Type something to translate'), 'नमस्ते');
  await fireEvent.press(screen.getByRole('button', { name: 'Translate' }));
  await screen.findByText('Hello');
  await fireEvent.press(screen.getByRole('button', { name: 'Read translation aloud' }));
  expect(await screen.findByRole('button', { name: 'Stop speaking' })).toBeTruthy();
  await act(async () => { jest.mocked(Speech.speak).mock.calls.at(-1)![1]?.onError?.(new Error('unavailable')); });
  expect(await screen.findByText('The translation is ready, but speech could not play. Tap Read aloud to retry or use Show them.')).toBeTruthy();
  expect(screen.getByText('Hello')).toBeTruthy();
});

test('clearing a conversation stops an active manual recording', async () => {
  jest.spyOn(session, 'accessToken').mockResolvedValue('test-token');
  global.fetch = jest.fn<typeof global.fetch>().mockResolvedValue({ ok: true, status: 200, json: async () => ({ detected: 'en', partner: 'en', target: 'en', transcript: 'Hello', translation: 'Hello', sameLanguage: true }) } as Response);
  await open();
  await fireEvent.press(screen.getByRole('button', { name: 'Type instead' }));
  await fireEvent.changeText(screen.getByLabelText('Type something to translate'), 'Hello');
  await fireEvent.press(screen.getByRole('button', { name: 'Translate' }));
  await screen.findByText('Hello');
  await fireEvent.press(screen.getByRole('button', { name: 'Close keyboard' }));
  const stop = jest.spyOn(useAudioRecorder({} as never), 'stop');
  await fireEvent.press(screen.getByRole('button', { name: 'Start recording' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Clear conversation' }));
  await waitFor(() => expect(stop).toHaveBeenCalled());
  expect(screen.getByRole('button', { name: 'Start recording' })).toBeTruthy();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('clearing while microphone permission is pending prevents a late recording', async () => {
  jest.mocked(getRecordingPermissionsAsync).mockResolvedValueOnce({ granted: false } as never);
  jest.spyOn(session, 'accessToken').mockResolvedValue('test-token');
  global.fetch = jest.fn<typeof global.fetch>().mockResolvedValue({ ok: true, status: 200, json: async () => ({ detected: 'en', partner: 'en', target: 'en', transcript: 'Hello', translation: 'Hello', sameLanguage: true }) } as Response);
  await open();
  await fireEvent.press(screen.getByRole('button', { name: 'Type instead' }));
  await fireEvent.changeText(screen.getByLabelText('Type something to translate'), 'Hello');
  await fireEvent.press(screen.getByRole('button', { name: 'Translate' }));
  await screen.findByText('Hello');
  await fireEvent.press(screen.getByRole('button', { name: 'Close keyboard' }));
  let allow!: (result: never) => void;
  jest.mocked(requestRecordingPermissionsAsync).mockImplementationOnce(() => new Promise(resolve => { allow = resolve; }));
  const record = jest.mocked(useAudioRecorder({} as never).record);
  record.mockClear();
  await fireEvent.press(screen.getByRole('button', { name: 'Start recording' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Clear conversation' }));
  await act(async () => allow({ granted: true } as never));
  expect(record).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Start recording' })).toBeTruthy();
});

test('clearing while manual capture prepares cannot overlap a hands-free recorder', async () => {
  jest.spyOn(session, 'accessToken').mockResolvedValue('test-token');
  global.fetch = jest.fn<typeof global.fetch>().mockResolvedValue({ ok: true, status: 200, json: async () => ({ detected: 'en', partner: 'en', target: 'en', transcript: 'Hello', translation: 'Hello', sameLanguage: true }) } as Response);
  await open();
  await fireEvent.press(screen.getByRole('button', { name: 'Type instead' }));
  await fireEvent.changeText(screen.getByLabelText('Type something to translate'), 'Hello');
  await fireEvent.press(screen.getByRole('button', { name: 'Translate' }));
  await screen.findByText('Hello');
  await fireEvent.press(screen.getByRole('button', { name: 'Close keyboard' }));
  const recorder = useAudioRecorder({} as never);
  let prepare!: () => void;
  const preparing = jest.spyOn(recorder, 'prepareToRecordAsync').mockImplementationOnce(() => new Promise(resolve => { prepare = resolve; }));
  await fireEvent.press(screen.getByRole('button', { name: 'Start recording' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Clear conversation' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Start hands-free conversation' }));
  expect(preparing).toHaveBeenCalledTimes(1);
  await act(async () => prepare());
  await fireEvent.press(screen.getByRole('button', { name: 'Start hands-free conversation' }));
  await waitFor(() => expect(preparing).toHaveBeenCalledTimes(2));
  await fireEvent.press(screen.getByRole('button', { name: 'Stop hands-free conversation' }));
});

test('first manual permission waits for the iOS foreground transition before recording', async () => {
  const subscribe = jest.spyOn(AppState, 'addEventListener');
  jest.mocked(getRecordingPermissionsAsync).mockResolvedValueOnce({ granted: false } as never);
  jest.mocked(requestRecordingPermissionsAsync).mockImplementationOnce(async () => {
    const listeners = subscribe.mock.calls.filter(([event]) => event === 'change').map(([, listener]) => listener);
    AppState.currentState = 'inactive';
    listeners.forEach(listener => listener('inactive'));
    setTimeout(() => { AppState.currentState = 'active'; listeners.forEach(listener => listener('active')); }, 500);
    return { granted: true } as never;
  });
  try {
    await open();
    const recorder = useAudioRecorder({} as never);
    jest.mocked(recorder.record).mockClear();
    jest.useFakeTimers();
    await fireEvent.press(screen.getByRole('button', { name: 'Start recording' }));
    await act(async () => { await jest.advanceTimersByTimeAsync(200); });
    expect(recorder.record).not.toHaveBeenCalled();
    await act(async () => { await jest.advanceTimersByTimeAsync(500); });
    expect(recorder.record).toHaveBeenCalledTimes(1);
    const listeners = subscribe.mock.calls.filter(([event]) => event === 'change').map(([, listener]) => listener);
    await act(async () => { AppState.currentState = 'background'; listeners.forEach(listener => listener('background')); });
  } finally { jest.useRealTimers(); }
});

test('first hands-free permission activity returns to listening without a second tap', async () => {
  const subscribe = jest.spyOn(AppState, 'addEventListener');
  AppState.currentState = 'active';
  jest.mocked(getRecordingPermissionsAsync).mockResolvedValueOnce({ granted: false } as never);
  jest.mocked(requestRecordingPermissionsAsync).mockImplementationOnce(async () => {
    const listeners = subscribe.mock.calls.filter(([event]) => event === 'change').map(([, listener]) => listener);
    listeners.forEach(listener => listener('background'));
    listeners.forEach(listener => listener('active'));
    return { granted: true } as never;
  });
  await open();
  await fireEvent.press(screen.getByRole('button', { name: 'Start hands-free conversation' }));
  expect(await screen.findByText('Listening · pause to translate')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Stop hands-free conversation' }));
  expect(await screen.findByRole('button', { name: 'Start hands-free conversation' })).toBeTruthy();
});

async function startMeteredConversation(recorder: ReturnType<typeof useAudioRecorder>, talkLanguage?: string) {
  jest.spyOn(session, 'accessToken').mockResolvedValue('test-token');
  await open(talkLanguage);
  let level = -60;
  jest.spyOn(recorder, 'getStatus').mockImplementation(() => ({ isRecording: true, canRecord: true, durationMillis: 0, metering: level, mediaServicesDidReset: false, url: recorder.uri }));
  jest.mocked(recorder.record).mockClear();
  jest.useFakeTimers();
  await fireEvent.press(screen.getByRole('button', { name: 'Start hands-free conversation' }));
  return (next: number) => { level = next; };
}

async function finishRecordedPhrase(level: (next: number) => void) {
  level(-20);
  await act(async () => { await jest.advanceTimersByTimeAsync(500); });
  level(-60);
  await act(async () => { await jest.advanceTimersByTimeAsync(1300); });
}

test('unclear hands-free speech asks for repetition and resumes without a stuck request', async () => {
  global.fetch = jest.fn<typeof global.fetch>().mockResolvedValueOnce({ ok: false, status: 422, json: async () => ({ error: 'no_speech', message: "Didn't catch that." }) } as Response);
  try {
    const level = await startMeteredConversation(useAudioRecorder({} as never));
    await finishRecordedPhrase(level);
    await act(async () => { await jest.advanceTimersByTimeAsync(400); });
    expect(screen.getByRole('button', { name: 'Stop hands-free conversation' })).toBeTruthy();
    expect(screen.getByText('Still listening. Please repeat a little closer.')).toBeTruthy();
    expect(useAudioRecorder({} as never).record).toHaveBeenCalledTimes(2);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Stop hands-free conversation' }));
  } finally { jest.useRealTimers(); }
});

test('a forbidden hands-free response stops safely and releases the busy controls', async () => {
  global.fetch = jest.fn<typeof global.fetch>().mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ error: 'forbidden', message: 'Access denied.' }) } as Response);
  try {
    const level = await startMeteredConversation(useAudioRecorder({} as never));
    await finishRecordedPhrase(level);
    expect(screen.getByRole('button', { name: 'Start hands-free conversation' }).props.accessibilityState.disabled).toBe(false);
    expect(screen.getByText('Access denied.')).toBeTruthy();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  } finally { jest.useRealTimers(); }
});

test('unavailable speech playback keeps the translation visible and resumes hands-free', async () => {
  global.fetch = jest.fn<typeof global.fetch>().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ detected: 'ja', partner: 'ja', target: 'en', transcript: 'こんにちは', translation: 'Hello', sameLanguage: false }) } as Response);
  try {
    const level = await startMeteredConversation(useAudioRecorder({} as never));
    await finishRecordedPhrase(level);
    await act(async () => { jest.mocked(Speech.speak).mock.calls.at(-1)![1]?.onError?.(new Error('voice unavailable')); });
    await act(async () => { await jest.advanceTimersByTimeAsync(400); });
    expect(screen.getByText('Hello')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Stop hands-free conversation' })).toBeTruthy();
    expect(screen.getByText('Translation is on screen. Still listening.')).toBeTruthy();
    expect(useAudioRecorder({} as never).record).toHaveBeenCalledTimes(2);
    await fireEvent.press(screen.getByRole('button', { name: 'Stop hands-free conversation' }));
  } finally { jest.useRealTimers(); }
});

test('repeated unclear speech stays hands-free and accepts the next clear phrase after a cooldown', async () => {
  const unclear = { ok: false, status: 422, json: async () => ({ error: 'no_speech', message: "Didn't catch that." }) } as Response;
  global.fetch = jest.fn<typeof global.fetch>().mockResolvedValueOnce(unclear).mockResolvedValueOnce(unclear).mockResolvedValueOnce(unclear).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ detected: 'en', partner: 'ja', target: 'en', transcript: 'Please bring water.', translation: 'Please bring water.', sameLanguage: true }) } as Response);
  try {
    const level = await startMeteredConversation(useAudioRecorder({} as never));
    for (let i = 0; i < 3; i++) {
      await finishRecordedPhrase(level);
      await act(async () => { await jest.advanceTimersByTimeAsync(400); });
    }
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('button', { name: 'Stop hands-free conversation' })).toBeTruthy();
    expect(useAudioRecorder({} as never).record).toHaveBeenCalledTimes(3);
    await act(async () => { await jest.advanceTimersByTimeAsync(3000); });
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(useAudioRecorder({} as never).record).toHaveBeenCalledTimes(4);
    await finishRecordedPhrase(level);
    await act(async () => { await jest.advanceTimersByTimeAsync(400); });
    expect(screen.getAllByText('Please bring water.').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Stop hands-free conversation' })).toBeTruthy();
    expect(global.fetch).toHaveBeenCalledTimes(4);
    await fireEvent.press(screen.getByRole('button', { name: 'Stop hands-free conversation' }));
  } finally { jest.useRealTimers(); }
});

test('stop during unclear-speech cooldown prevents a late microphone restart', async () => {
  global.fetch = jest.fn<typeof global.fetch>().mockResolvedValue({ ok: false, status: 422, json: async () => ({ error: 'no_speech', message: "Didn't catch that." }) } as Response);
  try {
    const level = await startMeteredConversation(useAudioRecorder({} as never));
    for (let i = 0; i < 3; i++) {
      await finishRecordedPhrase(level);
      await act(async () => { await jest.advanceTimersByTimeAsync(400); });
    }
    expect(screen.getByText('Speech wasn’t clear. Please wait a moment…')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Stop hands-free conversation' }));
    await act(async () => { await jest.advanceTimersByTimeAsync(5000); });
    expect(useAudioRecorder({} as never).record).toHaveBeenCalledTimes(3);
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('button', { name: 'Start recording' }).props.accessibilityState.disabled).toBe(false);
  } finally { jest.useRealTimers(); }
});

test('repeated service failures stop gracefully rather than looping requests indefinitely', async () => {
  global.fetch = jest.fn<typeof global.fetch>().mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: 'unavailable', message: 'Temporarily unavailable.' }) } as Response);
  try {
    const level = await startMeteredConversation(useAudioRecorder({} as never));
    for (let i = 0; i < 3; i++) {
      await finishRecordedPhrase(level);
      await act(async () => { await jest.advanceTimersByTimeAsync(2400); });
    }
    expect(global.fetch).toHaveBeenCalledTimes(6);
    expect(screen.getByRole('button', { name: 'Start hands-free conversation' }).props.accessibilityState.disabled).toBe(false);
    expect(screen.getByText('Conversation paused after several attempts. Check your microphone or connection, then try again or use Type.')).toBeTruthy();
  } finally { jest.useRealTimers(); }
});

test('a pending permission preflight cannot start recording after leaving and returning', async () => {
  const subscribe = jest.spyOn(AppState, 'addEventListener');
  let finish!: (permission: Awaited<ReturnType<typeof getRecordingPermissionsAsync>>) => void;
  jest.mocked(getRecordingPermissionsAsync).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await open();
  const recorder = useAudioRecorder({} as never);
  jest.mocked(recorder.record).mockClear();
  await fireEvent.press(screen.getByRole('button', { name: 'Start recording' }));
  expect(recorder.record).not.toHaveBeenCalled();
  const listeners = subscribe.mock.calls.filter(([event]) => event === 'change').map(([, listener]) => listener);
  await act(async () => { AppState.currentState = 'background'; listeners.forEach(listener => listener('background')); });
  await act(async () => { AppState.currentState = 'active'; listeners.forEach(listener => listener('active')); finish({ granted: true } as never); });
  expect(recorder.record).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Start recording' }).props.accessibilityState.disabled).toBe(false);
});


test.each([
  { mine: 'en', partner: 'vi', original: 'Xin chào', translated: 'Hello', reply: 'Thank you', replyTranslation: 'Cảm ơn' },
  { mine: 'hi', partner: 'th', original: 'สวัสดี', translated: 'नमस्ते', reply: 'धन्यवाद', replyTranslation: 'ขอบคุณ' },
])('hands-free routes $mine ↔ $partner replies and waits for playback before listening', async ({ mine, partner, original, translated, reply, replyTranslation }) => {
  const replies = [
    { detected: partner, mine, fromMe: false, partner, target: mine, transcript: original, translation: translated, sameLanguage: false },
    { detected: mine, mine, fromMe: true, partner, target: partner, transcript: reply, translation: replyTranslation, sameLanguage: false },
  ];
  const fetch = jest.fn<typeof global.fetch>().mockImplementation(async () => ({ ok: true, status: 200, json: async () => replies.shift() }) as Response);
  global.fetch = fetch;
  jest.mocked(Speech.speak).mockClear().mockImplementation(() => {});
  const recorder = useAudioRecorder({} as never);
  try {
    const level = await startMeteredConversation(recorder, mine);
    for (const [index, [translation, target]] of [[translated, mine], [replyTranslation, partner]].entries()) {
      await finishRecordedPhrase(level);
      expect(fetch).toHaveBeenCalledTimes(index + 1);
      const sent = JSON.parse(fetch.mock.calls[index][1]?.body as string);
      expect(sent).toMatchObject({ mine, audio: { data: 'YXVkaW8=', mimeType: 'audio/mp4' }, history: [] });
      if (index) expect(sent.partner).toBe(partner);
      expect(screen.getByText(translation)).toBeTruthy();
      expect(Speech.speak).toHaveBeenLastCalledWith(translation, expect.objectContaining({ language: target }));
      await act(async () => { await jest.advanceTimersByTimeAsync(2000); });
      expect(recorder.record).toHaveBeenCalledTimes(index + 1);
      await act(async () => { jest.mocked(Speech.speak).mock.calls.at(-1)![1]?.onDone?.(); });
      await act(async () => { await jest.advanceTimersByTimeAsync(400); });
      expect(recorder.record).toHaveBeenCalledTimes(index + 2);
    }
    await fireEvent.press(screen.getByRole('button', { name: 'Stop hands-free conversation' }));
  } finally { jest.useRealTimers(); }
});
