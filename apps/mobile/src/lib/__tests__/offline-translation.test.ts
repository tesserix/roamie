import { beforeEach, expect, jest, test } from '@jest/globals';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { localTextTranslation } from '../offline-translation';

jest.mock('expo-modules-core', () => ({
  ...jest.requireActual<object>('expo-modules-core'),
  requireOptionalNativeModule: jest.fn(),
}));

const native = {
  supportedTextLanguages: jest.fn(async () => ['en', 'fr', 'tl']),
  downloadedLanguages: jest.fn(async () => ['fr', 'tl']),
  isTranslationReady: jest.fn(async () => true),
  identifyLanguage: jest.fn(async () => 'en'),
  translate: jest.fn(async () => 'Bonjour'),
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(requireOptionalNativeModule).mockReturnValue(native);
  native.downloadedLanguages.mockResolvedValue(['fr', 'tl']);
  native.identifyLanguage.mockResolvedValue('en');
  native.translate.mockResolvedValue('Bonjour');
  native.isTranslationReady.mockResolvedValue(true);
});

test('downloaded text translates locally with no fabricated cloud pronunciation or alternatives', async () => {
  await expect(localTextTranslation('Hello', 'fr')).resolves.toEqual({
    detected: 'en', translation: 'Bonjour', romanized: '', sourceRomanized: '', alternatives: [], engine: 'device',
  });
  expect(native.translate).toHaveBeenCalledWith('Hello', 'en', 'fr');
});

test('a missing source pack cannot be mistaken for a usable pair', async () => {
  native.isTranslationReady.mockResolvedValue(false);
  await expect(localTextTranslation('Hallo', 'fr', 'de')).resolves.toBeNull();
  expect(native.translate).not.toHaveBeenCalled();
});

test('unsupported Odia never becomes an English fallback', async () => {
  await expect(localTextTranslation('Hello', 'or', 'en')).resolves.toBeNull();
  expect(native.translate).not.toHaveBeenCalled();
});

test('Filipino uses the provider model code while results retain the app language code', async () => {
  native.identifyLanguage.mockResolvedValue('tl');
  await expect(localTextTranslation('Kumusta', 'en')).resolves.toMatchObject({ detected: 'fil', engine: 'device' });
  expect(native.translate).toHaveBeenCalledWith('Kumusta', 'tl', 'en');
});

test('uncertain automatic detection asks for a language instead of guessing', async () => {
  native.identifyLanguage.mockResolvedValue('und');
  await expect(localTextTranslation('OK', 'fr')).resolves.toBeNull();
  expect(native.translate).not.toHaveBeenCalled();
});

test('cancelled inference cannot publish a late result', async () => {
  const controller = new AbortController();
  native.translate.mockImplementationOnce(async () => { controller.abort(); return 'Late'; });
  await expect(localTextTranslation('Hello', 'fr', 'en', controller.signal)).rejects.toThrow('cancelled');
});
