import { expect, jest, test } from '@jest/globals';
import storage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => null as string | null), setItem: jest.fn(async () => {}) }));

test.each(['cloud', 'auto', 'offline'])('restores %s with local-first migration and keeps the selected model', async mode => {
  jest.mocked(storage.getItem).mockResolvedValueOnce(JSON.stringify({ mode, speechModel: 'small', textModel: 'hymt' }));
  await jest.isolateModulesAsync(async () => {
    const preferences = await import('../translation-preferences');
    await preferences.restoreTranslationPreferences();
    expect(preferences.translationPreferences()).toMatchObject({ mode: mode === 'offline' ? 'offline' : 'auto', textModel: 'hymt', speechModel: 'small', ready: true });
    await preferences.saveTranslationPreferences({ speechModel: 'base' });
    expect(JSON.parse(jest.mocked(storage.setItem).mock.calls.at(-1)![1])).toEqual({ mode: mode === 'offline' ? 'offline' : 'auto', textModel: 'hymt', speechModel: 'base' });
  });
});

test('an unreadable saved preference fails closed to Offline only', async () => {
  jest.mocked(storage.getItem).mockResolvedValueOnce('{broken');
  await jest.isolateModulesAsync(async () => {
    const preferences = await import('../translation-preferences');
    await preferences.restoreTranslationPreferences();
    expect(preferences.translationPreferences()).toMatchObject({ mode: 'offline', ready: true, error: expect.stringContaining('Offline mode is active') });
  });
});
