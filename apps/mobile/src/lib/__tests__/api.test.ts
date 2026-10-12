import { beforeEach, expect, jest, test } from '@jest/globals';
import { fetch as mockExpoFetch } from 'expo/fetch';
import { session } from '../auth-client';
import { translateText } from '../api';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('../auth-client', () => ({
  API_BASE: 'https://roamie-api.tesserix.app',
  authFetch: jest.fn((...args: Parameters<typeof mockExpoFetch>) => mockExpoFetch(...args)),
  session: { current: jest.fn(() => ({ sub: 'alice' })), revision: jest.fn(() => 1), accessToken: jest.fn(async () => 'token'), clear: jest.fn(async () => {}) },
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(session.current).mockReturnValue({ sub: 'alice' } as ReturnType<typeof session.current>);
  jest.mocked(session.revision).mockReturnValue(1);
});

test('a late unauthorized response cannot clear a renewed login for the same account', async () => {
  jest.mocked(mockExpoFetch).mockImplementationOnce(async () => {
    jest.mocked(session.revision).mockReturnValue(2);
    return { ok: false, status: 401, json: async () => ({}) } as Awaited<ReturnType<typeof mockExpoFetch>>;
  });
  await expect(translateText('Hello', 'fr')).rejects.toThrow();
  expect(session.clear).not.toHaveBeenCalled();
});

test('a late unauthorized response cannot sign out the next account', async () => {
  jest.mocked(mockExpoFetch).mockImplementationOnce(async () => {
    jest.mocked(session.current).mockReturnValue({ sub: 'bob' } as ReturnType<typeof session.current>);
    return { ok: false, status: 401, json: async () => ({}) } as Awaited<ReturnType<typeof mockExpoFetch>>;
  });
  await expect(translateText('Hello', 'fr')).rejects.toThrow();
  expect(session.clear).not.toHaveBeenCalled();
});

test('discards successful data from a previous account', async () => {
  jest.mocked(mockExpoFetch).mockImplementationOnce(async () => {
    jest.mocked(session.current).mockReturnValue({ sub: 'bob' } as ReturnType<typeof session.current>);
    return { ok: true, status: 200, json: async () => ({ translation: 'private translation' }) } as Awaited<ReturnType<typeof mockExpoFetch>>;
  });
  await expect(translateText('Hello', 'fr')).rejects.toThrow('account changed');
});

test('a translation gateway timeout gives a relevant retry message', async () => {
  jest.mocked(mockExpoFetch).mockResolvedValueOnce({ ok: false, status: 504, json: async () => JSON.parse('<html>Gateway timeout</html>') } as Awaited<ReturnType<typeof mockExpoFetch>>);
  await expect(translateText('Hello', 'fr')).rejects.toThrow('This request took too long. Please try again.');
  expect(session.clear).not.toHaveBeenCalled();
});

test('AI translation remains available beyond the old fifteen-second timeout', async () => {
  jest.useFakeTimers();
  try {
    let finish!: (response: Awaited<ReturnType<typeof mockExpoFetch>>) => void;
    jest.mocked(mockExpoFetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = translateText('Hello', 'fr');
    await jest.advanceTimersByTimeAsync(45000);
    const signal = jest.mocked(mockExpoFetch).mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(false);
    finish({ ok: true, status: 200, json: async () => ({ translation: 'Bonjour' }) } as Awaited<ReturnType<typeof mockExpoFetch>>);
    await expect(pending).resolves.toEqual({ translation: 'Bonjour' });
  } finally { jest.useRealTimers(); }
});
