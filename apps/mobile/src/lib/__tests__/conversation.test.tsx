import { afterEach, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { requestRecordingPermissionsAsync, useAudioRecorder } from 'expo-audio';
import { AppState } from 'react-native';
import * as Speech from 'expo-speech';
import Talk from '../../app/index';
import { StoreProvider, useStore } from '../store';
import { session } from '../auth-client';

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(async () => {}) }));
jest.mock('expo-router', () => ({ useIsFocused: () => true }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('expo-location', () => ({ getForegroundPermissionsAsync: jest.fn(async () => ({ granted: false })) }));
jest.mock('expo-audio', () => {
  const recorder = { uri: 'file:///turn.m4a', prepareToRecordAsync: async () => {}, record: jest.fn(), stop: async () => {}, getStatus: () => ({ isRecording: true, durationMillis: 0, metering: -60, mediaServicesDidReset: false }) };
  return { RecordingPresets: { HIGH_QUALITY: {} }, requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: true })), setAudioModeAsync: jest.fn(async () => {}), useAudioRecorder: () => recorder };
});
jest.mock('expo-file-system', () => ({ File: class { exists = true; async base64() { return 'YXVkaW8='; } delete() {} } }));
jest.mock('expo-speech', () => ({ stop: jest.fn(), speak: jest.fn(), getAvailableVoicesAsync: jest.fn(async () => []) }));
jest.mock('expo-notifications', () => ({ cancelAllScheduledNotificationsAsync: jest.fn(async () => {}) }));

function ReadyTalk() { return useStore().ready ? <Talk /> : null; }
async function open() {
  jest.mocked(AsyncStorage.getItem).mockResolvedValue(JSON.stringify({ profile: { language: 'en', homeCurrency: 'USD', budgetMinor: 0, diet: 'none' }, partner: null, expenses: [] }));
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
  expect(screen.getAllByText('नमस्ते')).toHaveLength(2);

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
