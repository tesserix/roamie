import { afterEach, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { useAudioRecorder } from 'expo-audio';
import * as Speech from 'expo-speech';
import Talk from '../../app/index';
import { StoreProvider, useStore, accountStorageKey } from '../store';
import { session } from '../auth-client';
import { LANGUAGES } from '../languages';

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(async () => {}) }));
jest.mock('expo-router', () => ({ useIsFocused: () => true }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('expo-location', () => ({ getForegroundPermissionsAsync: jest.fn(async () => ({ granted: false })) }));
jest.mock('expo-audio', () => {
  const recorder = { uri: 'file:///turn.m4a', prepareToRecordAsync: async () => {}, record: jest.fn(), stop: async () => {}, getStatus: () => ({ isRecording: true, durationMillis: 0, metering: -60, mediaServicesDidReset: false }) };
  return { RecordingPresets: { HIGH_QUALITY: {} }, getRecordingPermissionsAsync: jest.fn(async () => ({ granted: true })), requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: true })), setAudioModeAsync: jest.fn(async () => {}), useAudioRecorder: () => recorder };
});
jest.mock('expo/fetch', () => ({ fetch: (...args: Parameters<typeof global.fetch>) => global.fetch(...args) }));
jest.mock('expo-file-system', () => ({ File: class { exists = true; uri: string; constructor(uri: string) { this.uri = uri; } async base64() { return Buffer.from(this.uri).toString('base64'); } delete() {} } }));
jest.mock('expo-speech', () => ({ VoiceQuality: { Default: 'Default', Enhanced: 'Enhanced' }, stop: jest.fn(), speak: jest.fn(), getAvailableVoicesAsync: jest.fn(async () => Object.keys(jest.requireActual<{ LANGUAGES: Record<string, string> }>('../languages').LANGUAGES).map(language => ({ identifier: `test-${language}`, language }))) }));
jest.mock('expo-notifications', () => ({ cancelAllScheduledNotificationsAsync: jest.fn(async () => {}) }));

const originalFetch = global.fetch;
afterEach(() => { jest.restoreAllMocks(); jest.clearAllMocks(); global.fetch = originalFetch; });
function ReadyTalk() { return useStore().ready ? <Talk /> : null; }

const languagePairs = Object.keys(LANGUAGES).flatMap(mine => Object.keys(LANGUAGES).filter(partner => partner !== mine).map(partner => [mine, partner]));

test.each(languagePairs)('%s / %s survives reopening and translates the other speaker back to the remembered source', async (mine, partner) => {
  AppState.currentState = 'active';
  jest.spyOn(session, 'current').mockReturnValue({ sub: 'conversation-test', name: 'Test traveller', email: 'test@example.invalid' });
  jest.spyOn(session, 'accessToken').mockResolvedValue('test-token');
  const key = accountStorageKey('conversation-test');
  const storage = new Map([[key, JSON.stringify({ profile: { language: partner, homeCurrency: 'INR', budgetMinor: 0, diet: 'none' }, talkPartner: partner, talkLanguage: null, expenses: [] })]]);
  jest.mocked(AsyncStorage.getItem).mockImplementation(async name => name.startsWith('roamie.ai-consent.') ? 'allowed' : storage.get(name) ?? null);
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (name, value) => { storage.set(name, value); });
  jest.mocked(Speech.speak).mockImplementation((_text, options) => { options?.onDone?.(); });
  const replies = [
    { detected: mine, mine, fromMe: true, partner, target: partner, transcript: `first turn in ${mine}`, translation: `translated first turn in ${partner}`, reviewRequired: false, sameLanguage: false },
    { detected: partner, mine, fromMe: false, partner, target: mine, transcript: `reply in ${partner}`, translation: `translated reply in ${mine}`, reviewRequired: false, sameLanguage: false },
  ];
  const fetch = jest.fn<typeof global.fetch>().mockImplementation(async () => ({ ok: true, status: 200, json: async () => replies.shift() }) as Response);
  global.fetch = fetch;
  const app = await render(<StoreProvider accountId="conversation-test"><ReadyTalk /></StoreProvider>);
  await fireEvent.press(await screen.findByRole('button', { name: 'Type instead' }));
  await fireEvent.changeText(screen.getByLabelText('Type something to translate'), `first turn in ${mine}`);
  await fireEvent.press(screen.getByRole('button', { name: 'Translate' }));
  await screen.findByRole('button', { name: `Your language: Auto-detect (${LANGUAGES[mine]}). Change` });
  await act(async () => {});
  await app.unmount();
  await render(<StoreProvider accountId="conversation-test"><ReadyTalk /></StoreProvider>);
  expect(await screen.findByRole('button', { name: `Your language: Auto-detect (${LANGUAGES[mine]}). Change` })).toBeTruthy();
  expect(screen.getByRole('button', { name: `Their language: ${LANGUAGES[partner]}. Change` })).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Type instead' }));
  await fireEvent.changeText(screen.getByLabelText('Type something to translate'), `reply in ${partner}`);
  await fireEvent.press(screen.getByRole('button', { name: 'Translate' }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetch.mock.calls[1][1]?.body as string)).toMatchObject({ mine, partner });
  await waitFor(() => expect(Speech.speak).toHaveBeenLastCalledWith(`translated reply in ${mine}`, expect.objectContaining({ language: mine })));
});

test.each(['tap-to-talk', 'hands-free'])('%s keeps English and Bengali through six distinct recordings and two screen restarts', async mode => {
  jest.spyOn(session, 'current').mockReturnValue({ sub: 'conversation-test', name: 'Test traveller', email: 'test@example.invalid' });
  jest.spyOn(session, 'accessToken').mockResolvedValue('test-token');
  const storage = new Map([[accountStorageKey('conversation-test'), JSON.stringify({ profile: { language: 'bn', homeCurrency: 'INR', budgetMinor: 0, diet: 'none' }, talkPartner: 'bn', talkLanguage: null, expenses: [] })]]);
  jest.mocked(AsyncStorage.getItem).mockImplementation(async name => name.startsWith('roamie.ai-consent.') ? 'allowed' : storage.get(name) ?? null);
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (name, value) => { storage.set(name, value); });
  const phrases = [
    ['en', 'Where is the station?', 'স্টেশন কোথায়?'],
    ['bn', 'স্টেশন বাঁদিকে।', 'The station is on the left.'],
    ['en', 'I need two tickets.', 'আমার দুটি টিকিট লাগবে।'],
    ['bn', 'দুটি টিকিটের দাম পাঁচশো টাকা।', 'Two tickets cost five hundred taka.'],
    ['en', 'Does it leave at four?', 'এটি কি চারটায় ছাড়বে?'],
    ['bn', 'হ্যাঁ, ট্রেন চারটায় ছাড়বে।', 'Yes, the train leaves at four.'],
  ];
  let response = 0;
  const fetch = jest.fn<typeof global.fetch>().mockImplementation(async () => {
    const [detected, transcript, translation] = phrases[response++];
    return { ok: true, status: 200, json: async () => ({ detected, transcript, translation, mine: 'en', partner: 'bn', fromMe: detected === 'en', target: detected === 'en' ? 'bn' : 'en', sameLanguage: false, reviewRequired: false }) } as Response;
  });
  global.fetch = fetch;
  jest.mocked(Speech.speak).mockImplementation((_text, options) => { options?.onDone?.(); });
  const recorder = useAudioRecorder({} as never);
  let level = -60, file = 0;
  jest.spyOn(recorder, 'prepareToRecordAsync').mockImplementation(async () => { Object.defineProperty(recorder, 'uri', { configurable: true, value: `file:///turn-${++file}.m4a` }); });
  jest.spyOn(recorder, 'getStatus').mockImplementation(() => ({ isRecording: true, canRecord: true, durationMillis: 0, metering: level, mediaServicesDidReset: false, url: recorder.uri }));
  let app = await render(<StoreProvider accountId="conversation-test"><ReadyTalk /></StoreProvider>);
  await screen.findByRole('button', { name: 'Start recording' });
  jest.useFakeTimers();
  try {
    for (let i = 0; i < phrases.length; i++) {
      if (mode === 'hands-free') {
        if (i % 2 === 0) await fireEvent.press(screen.getByRole('button', { name: 'Start hands-free conversation' }));
        level = -20;
        await act(async () => { await jest.advanceTimersByTimeAsync(600); });
        level = -60;
        await act(async () => { await jest.advanceTimersByTimeAsync(1300); });
      } else {
        await fireEvent.press(screen.getByRole('button', { name: 'Start recording' }));
        await act(async () => { await jest.advanceTimersByTimeAsync(600); });
        await fireEvent.press(screen.getByRole('button', { name: 'Finish and translate' }));
      }
      await act(async () => { await jest.advanceTimersByTimeAsync(400); });
      expect(fetch).toHaveBeenCalledTimes(i + 1);
      expect(Speech.speak).toHaveBeenLastCalledWith(phrases[i][2], expect.objectContaining({ language: i % 2 === 0 ? 'bn' : 'en' }));
      expect(screen.getByRole('button', { name: 'Your language: Auto-detect (English). Change' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Their language: Bengali. Change' })).toBeTruthy();
      if (i % 2 === 1 && i < phrases.length - 1) {
        if (mode === 'hands-free') await fireEvent.press(screen.getByRole('button', { name: 'Stop hands-free conversation' }));
        await app.unmount();
        app = await render(<StoreProvider accountId="conversation-test"><ReadyTalk /></StoreProvider>);
        await act(async () => {});
        expect(screen.getByRole('button', { name: 'Your language: Auto-detect (English). Change' })).toBeTruthy();
      }
    }
    if (mode === 'hands-free') await fireEvent.press(screen.getByRole('button', { name: 'Stop hands-free conversation' }));
    const payloads = fetch.mock.calls.map(([, init]) => JSON.parse(init?.body as string));
    expect(new Set(payloads.map(body => body.audio.data)).size).toBe(6);
    expect(payloads.slice(1).every(body => body.mine === 'en' && body.partner === 'bn')).toBe(true);
  } finally { await app.unmount(); jest.useRealTimers(); }
});

test.each<[string, string | null, number]>([['selected', 'bn', 0], ['not yet detected', null, 1]])('identical languages with %s source require correction instead of echoing Bengali', async (_name, talkLanguage, calls) => {
  jest.spyOn(session, 'current').mockReturnValue({ sub: 'conversation-test', name: 'Test traveller', email: 'test@example.invalid' });
  jest.spyOn(session, 'accessToken').mockResolvedValue('test-token');
  jest.mocked(AsyncStorage.getItem).mockImplementation(async name => name.startsWith('roamie.ai-consent.') ? 'allowed' : JSON.stringify({ profile: { language: 'bn', homeCurrency: 'INR', budgetMinor: 0, diet: 'none' }, talkPartner: 'bn', talkLanguage, expenses: [] }));
  const fetch = jest.fn<typeof global.fetch>().mockResolvedValue({ ok: true, status: 200, json: async () => ({ mine: 'bn', partner: 'bn', detected: 'bn', fromMe: true, transcript: 'স্টেশন কোথায়?', translation: 'স্টেশন কোথায়?', target: 'bn', sameLanguage: true }) } as Response);
  global.fetch = fetch;
  jest.mocked(Speech.speak).mockClear();
  await render(<StoreProvider accountId="conversation-test"><ReadyTalk /></StoreProvider>);
  await fireEvent.press(await screen.findByRole('button', { name: 'Type instead' }));
  await fireEvent.changeText(screen.getByLabelText('Type something to translate'), 'স্টেশন কোথায়?');
  await fireEvent.press(screen.getByRole('button', { name: 'Translate' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Choose two different conversation languages above, then try again.');
  expect(fetch).toHaveBeenCalledTimes(calls);
  expect(Speech.speak).not.toHaveBeenCalled();
});
