import { afterEach, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { requestRecordingPermissionsAsync } from 'expo-audio';
import * as Speech from 'expo-speech';
import Talk from '../../app/index';
import { StoreProvider, useStore } from '../store';
import { session } from '../auth-client';

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(async () => {}) }));
jest.mock('expo-router', () => ({ useIsFocused: () => true }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('expo-location', () => ({ getForegroundPermissionsAsync: jest.fn(async () => ({ granted: false })) }));
jest.mock('expo-audio', () => ({ RecordingPresets: { HIGH_QUALITY: {} }, requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: true })), setAudioModeAsync: jest.fn(async () => {}), useAudioRecorder: () => ({ prepareToRecordAsync: async () => {}, record: jest.fn(), stop: async () => {} }) }));
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
