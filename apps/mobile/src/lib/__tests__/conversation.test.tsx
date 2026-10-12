import { afterEach, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { requestRecordingPermissionsAsync, useAudioRecorder } from 'expo-audio';
import { AppState } from 'react-native';
import * as Speech from 'expo-speech';
import Talk from '../../app/index';
import { StoreProvider, useStore } from '../store';
import { session } from '../auth-client';
import { AccessibilityProvider } from '../accessibility';

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(async () => {}) }));
jest.mock('expo-router', () => ({ useIsFocused: () => true }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('expo-location', () => ({ getForegroundPermissionsAsync: jest.fn(async () => ({ granted: false })) }));
jest.mock('expo-audio', () => {
  const recorder = { uri: 'file:///turn.m4a', prepareToRecordAsync: async () => {}, record: jest.fn(), stop: async () => {}, getStatus: () => ({ isRecording: true, durationMillis: 0, metering: -60, mediaServicesDidReset: false }) };
  return { RecordingPresets: { HIGH_QUALITY: {} }, requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: true })), setAudioModeAsync: jest.fn(async () => {}), useAudioRecorder: () => recorder };
});
jest.mock('expo/fetch', () => ({ fetch: (...args: Parameters<typeof global.fetch>) => global.fetch(...args) }));
jest.mock('expo-file-system', () => ({ File: class { exists = true; async base64() { return 'YXVkaW8='; } delete() {} } }));
jest.mock('expo-speech', () => ({ VoiceQuality: { Default: 'Default', Enhanced: 'Enhanced' }, stop: jest.fn(), speak: jest.fn(), getAvailableVoicesAsync: jest.fn(async () => [{ identifier: 'english', language: 'en-US' }, { identifier: 'com.apple.voice.compact.en-US.Samantha', language: 'en-US' }, { identifier: 'com.apple.voice.compact.en-GB.Daniel', language: 'en-GB' }, { identifier: 'hindi', language: 'hi-IN' }, { identifier: 'odia-test', language: 'or-IN' }]) }));
jest.mock('expo-notifications', () => ({ cancelAllScheduledNotificationsAsync: jest.fn(async () => {}) }));

function ReadyTalk() { return useStore().ready ? <Talk /> : null; }
async function open(talkLanguage?: string | null) {
  jest.spyOn(session, 'current').mockReturnValue({ sub: 'conversation-test', name: 'Test traveller', email: 'test@example.invalid' });
  jest.mocked(AsyncStorage.getItem).mockResolvedValue(JSON.stringify({ profile: { language: 'en', homeCurrency: 'USD', budgetMinor: 0, diet: 'none' }, partner: null, talkLanguage, expenses: [] }));
  await render(<StoreProvider accountId="conversation-test"><ReadyTalk /></StoreProvider>);
}
const originalFetch = global.fetch;
afterEach(() => { jest.restoreAllMocks(); global.fetch = originalFetch; });

test('microphone starts without a partner language or location permission', async () => {
  await open();
  await fireEvent.press(await screen.findByRole('button', { name: 'Start recording' }));
  expect(requestRecordingPermissionsAsync).toHaveBeenCalled();
  expect(await screen.findByRole('button', { name: 'Finish and translate' })).toBeTruthy();
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
  jest.mocked(AsyncStorage.getItem).mockImplementation(async key => key === 'roamie.accessibility.v1' ? JSON.stringify({ voice }) : JSON.stringify({ profile: { language: 'en', homeCurrency: 'USD', budgetMinor: 0, diet: 'none' }, partner: null, talkLanguage: null, expenses: [] }));
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
  global.fetch = jest.fn<typeof global.fetch>().mockResolvedValue({ ok: true, status: 200, json: async () => ({ detected: 'hi', partner: 'hi', target: 'en', transcript: 'नमस्ते', translation: 'Hello', sameLanguage: false }) } as Response);
  jest.mocked(Speech.speak).mockClear();
  await open();
  await fireEvent.press(await screen.findByRole('button', { name: 'Type instead' }));
  await fireEvent.changeText(screen.getByLabelText('Type something to translate'), 'नमस्ते');
  await fireEvent.press(screen.getByRole('button', { name: 'Translate' }));
  await waitFor(() => expect(Speech.speak).toHaveBeenCalled());
  await act(async () => { jest.mocked(Speech.speak).mock.calls[0][1]?.onError?.(new Error('unavailable')); });
  expect(await screen.findByText('The translation is ready, but speech could not play. Tap Read aloud to retry or use Show them.')).toBeTruthy();
  expect(screen.getByText('Hello')).toBeTruthy();
  expect(global.fetch).toHaveBeenCalledTimes(1);
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
