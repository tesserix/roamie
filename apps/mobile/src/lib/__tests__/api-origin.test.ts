import { afterEach, expect, jest, test } from '@jest/globals';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn() }));
jest.mock('expo-auth-session', () => ({}));
const previousUrl = process.env.EXPO_PUBLIC_API_URL;
const previousAuth = process.env.EXPO_PUBLIC_AUTH_ENABLED;
afterEach(() => {
  if (previousUrl === undefined) delete process.env.EXPO_PUBLIC_API_URL;
  else process.env.EXPO_PUBLIC_API_URL = previousUrl;
  if (previousAuth === undefined) delete process.env.EXPO_PUBLIC_AUTH_ENABLED;
  else process.env.EXPO_PUBLIC_AUTH_ENABLED = previousAuth;
  Object.defineProperty(globalThis, '__DEV__', { value: true, writable: true });
  jest.resetModules();
});
function config() {
  jest.resetModules();
  return jest.requireActual<typeof import('../auth-client')>('../auth-client');
}

test.each([true, false])('mobile defaults to the public API with authentication (development=%s)', development => {
  delete process.env.EXPO_PUBLIC_API_URL;
  delete process.env.EXPO_PUBLIC_AUTH_ENABLED;
  Object.defineProperty(globalThis, '__DEV__', { value: development, writable: true });
  const client = config();
  expect(client.API_BASE).toBe('https://roamie-api.tesserix.app');
  expect(client.developmentAuthDisabled()).toBe(false);
});

test('local development API and auth bypass require explicit configuration', () => {
  process.env.EXPO_PUBLIC_API_URL = 'http://127.0.0.1:8085';
  process.env.EXPO_PUBLIC_AUTH_ENABLED = 'false';
  const client = config();
  expect(client.API_BASE).toBe('http://127.0.0.1:8085');
  expect(client.developmentAuthDisabled()).toBe(true);
});

test('public API cannot be used with development authentication disabled', () => {
  delete process.env.EXPO_PUBLIC_API_URL;
  process.env.EXPO_PUBLIC_AUTH_ENABLED = 'false';
  expect(() => config().developmentAuthDisabled()).toThrow('local development API');
});
