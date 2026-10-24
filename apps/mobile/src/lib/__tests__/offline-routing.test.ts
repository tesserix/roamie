import { expect, jest, test } from '@jest/globals';
import { fetch as mockExpoFetch } from 'expo/fetch';
import { talkTurn, translateText } from '../api';
import { session } from '../auth-client';
const mockNative = {
  isOnline: undefined as undefined | (() => Promise<boolean>),
  status: jest.fn(async () => ({ online: false, wifi: false, supported: ['en', 'fr'], downloaded: ['en', 'fr'] })),
  translate: jest.fn(async () => 'Bonjour'),
};
jest.mock('expo', () => ({ ...jest.requireActual<Record<string, unknown>>('expo'), requireOptionalNativeModule: () => mockNative }));
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('../auth-client', () => ({ API_BASE: 'https://roamie-api.tesserix.app', session: { current: jest.fn(() => null), accessToken: jest.fn(async () => 'test-token') } }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => 'allowed'), setItem: jest.fn(async () => {}) }));
test('airplane-mode talk uses downloaded models without sign-in or cloud retries', async () => {
  const onRetry = jest.fn();
  await expect(talkTurn({ text: 'Hello', mine: 'en', partner: 'fr', autoMine: false, partnerLocked: true, history: [] }, undefined, onRetry)).resolves.toMatchObject({ translation: 'Bonjour', offline: true });
  expect(mockExpoFetch).not.toHaveBeenCalled();
  expect(onRetry).not.toHaveBeenCalled();
});
test('network loss during a cloud request switches to installed models before retrying', async () => {
  jest.mocked(session.current).mockReturnValue({ sub: 'test-user' } as ReturnType<typeof session.current>);
  mockNative.status.mockResolvedValueOnce({ online: true, wifi: true, supported: ['en', 'fr'], downloaded: ['en', 'fr'] });
  jest.mocked(mockExpoFetch).mockRejectedValueOnce(new TypeError('Network request failed'));
  const retry = jest.fn();
  await expect(talkTurn({ text: 'Hello', mine: 'en', partner: 'fr', autoMine: false, partnerLocked: true, history: [] }, undefined, retry)).resolves.toMatchObject({ offline: true, translation: 'Bonjour' });
  expect(mockExpoFetch).toHaveBeenCalledTimes(1);
  expect(retry).not.toHaveBeenCalled();
});

test('online Talk and Type do not wait for the downloaded-model inventory', async () => {
  jest.mocked(session.current).mockReturnValue({ sub: 'test-user' } as ReturnType<typeof session.current>);
  mockNative.isOnline = async () => true;
  mockNative.status.mockClear();
  mockNative.status.mockImplementation(async () => { throw new Error('Model inventory should not be on the online path'); });
  jest.mocked(mockExpoFetch).mockResolvedValue({ ok: true, status: 200, json: async () => ({ translation: 'Bonjour' }) } as Awaited<ReturnType<typeof mockExpoFetch>>);
  await expect(talkTurn({ text: 'Hello', mine: 'en', partner: 'fr', history: [] })).resolves.toMatchObject({ translation: 'Bonjour' });
  await expect(translateText('Hello', 'fr', 'en')).resolves.toMatchObject({ translation: 'Bonjour' });
  expect(mockNative.status).not.toHaveBeenCalled();
});
