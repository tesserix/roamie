import { beforeEach, expect, jest, test } from '@jest/globals';
import { translateOffline, downloadOfflinePair, offlineTurn, removeOfflineLanguage } from '../offline-translation';
const mockNative = {
  status: jest.fn(async () => ({ online: false, wifi: false, supported: ['en', 'fr', 'tl'], downloaded: ['en', 'fr'] })),
  translate: jest.fn(async () => 'Bonjour'),
  download: jest.fn(async () => {}),
  remove: jest.fn(async () => {}),
};
jest.mock('expo', () => ({ requireOptionalNativeModule: () => mockNative }));
beforeEach(() => { jest.clearAllMocks(); });
test('translates using installed native models without calling the network', async () => {
  const fetchSpy = jest.spyOn(global, 'fetch');
  await expect(translateOffline('Hello', 'en', 'fr')).resolves.toBe('Bonjour');
  expect(mockNative.translate).toHaveBeenCalledWith('Hello', 'en', 'fr');
  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockRestore();
});
test('missing language fails before inference instead of downloading silently', async () => {
  await expect(translateOffline('Hello', 'en', 'tl')).rejects.toThrow('Download');
  expect(mockNative.translate).not.toHaveBeenCalled();
  expect(mockNative.download).not.toHaveBeenCalled();
});
test('downloads the whole pair only with connectivity and explicit cellular consent', async () => {
  await expect(downloadOfflinePair('en', 'fr')).rejects.toThrow('Connect');
  expect(mockNative.download).not.toHaveBeenCalled();
  mockNative.status.mockResolvedValueOnce({ online: true, wifi: false, supported: ['en', 'fr'], downloaded: [] });
  await expect(downloadOfflinePair('en', 'fr')).rejects.toThrow('Wi-Fi');
  mockNative.status.mockResolvedValueOnce({ online: true, wifi: false, supported: ['en', 'fr'], downloaded: [] });
  await downloadOfflinePair('en', 'fr', true);
  expect(mockNative.download).toHaveBeenCalledWith('en', 'fr', true);
});
test('validates unsupported languages and oversized input before inference', async () => {
  await expect(translateOffline('Hello', 'en', 'or')).rejects.toThrow('not supported');
  await expect(translateOffline('x'.repeat(2001), 'en', 'fr')).rejects.toThrow('2000');
  await expect(translateOffline('  ', 'en', 'fr')).rejects.toThrow('Enter');
  expect(mockNative.translate).not.toHaveBeenCalled();
});
test('offline talk preserves explicit language direction without claiming language detection', async () => {
  const result = await offlineTurn({ text: 'Hello', mine: 'en', partner: 'fr', autoMine: false, partnerLocked: true, history: [] });
  expect(result).toMatchObject({ transcript: 'Hello', translation: 'Bonjour', detected: 'en', target: 'fr', fromMe: true, offline: true });
  await expect(offlineTurn({ text: 'Hello', mine: 'en', partner: 'fr', autoMine: true, history: [] })).rejects.toThrow('Choose');
  expect(mockNative.translate).toHaveBeenCalledTimes(1);
});
test('does not run a second inference or delete a model during active inference', async () => {
  let complete!: (value: string) => void;
  mockNative.translate.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const active = translateOffline('Hello', 'en', 'fr');
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  await expect(translateOffline('Second', 'en', 'fr')).rejects.toThrow('busy');
  await expect(removeOfflineLanguage('fr')).rejects.toThrow('busy');
  complete('Bonjour');
  await expect(active).resolves.toBe('Bonjour');
  await removeOfflineLanguage('fr');
  expect(mockNative.remove).toHaveBeenCalledWith('fr');
});
test('cancelled text never starts native inference', async () => {
  const controller = new AbortController(); controller.abort();
  await expect(translateOffline('Hello', 'en', 'fr', controller.signal)).rejects.toThrow('cancelled');
  expect(mockNative.translate).not.toHaveBeenCalled();
});
test('latest typed request waits for the previous inference and discards cancelled output', async () => {
  let complete!: (value: string) => void;
  mockNative.translate.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const oldController = new AbortController();
  const first = translateOffline('Old', 'en', 'fr', oldController.signal).catch(error => error.message);
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  oldController.abort();
  const next = translateOffline('Latest', 'en', 'fr', new AbortController().signal).catch(error => error.message);
  complete('Old output');
  await expect(first).resolves.toContain('cancelled');
  await expect(next).resolves.toBe('Bonjour');
  expect(mockNative.translate).toHaveBeenLastCalledWith('Latest', 'en', 'fr');
});
