import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { TurboModuleRegistry } from 'react-native';
import * as Device from 'expo-device';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { initLlama } from 'llama.rn';
import { HYMT_MODEL, hymtUnavailableReason, removeTextModel } from '../text-models';
import { modelFilePath } from '../model-files';
import { translateHymt, releaseOfflineText } from '../offline-text';
import { saveTranslationPreferences, translationPreferences } from '../translation-preferences';
import { localTextTranslation, offlineTextStatus } from '../offline-translation';

jest.mock('expo-device', () => ({ __esModule: true, totalMemory: 8 * 1024 ** 3, isDevice: false, supportedCpuArchitectures: ['arm64'] }));
jest.mock('expo-modules-core', () => ({ ...jest.requireActual<object>('expo-modules-core'), requireOptionalNativeModule: jest.fn() }));
jest.mock('expo-file-system/legacy', () => {
  const files = new Map<string, number>();
  return { __files: files, documentDirectory: 'file:///documents/', getInfoAsync: jest.fn(async (uri: string) => files.has(uri) ? { exists: true, size: files.get(uri), modificationTime: 1 } : { exists: false }), deleteAsync: jest.fn(async (uri: string) => { files.delete(uri); }) };
});
jest.mock('llama.rn', () => ({ initLlama: jest.fn() }));
const files = jest.requireMock<{ __files: Map<string, number> }>('expo-file-system/legacy').__files;
const context = {
  getFormattedChat: jest.fn(async () => ({ prompt: 'formatted translation prompt' })),
  tokenize: jest.fn(async () => ({ tokens: [1, 2, 3] })),
  completion: jest.fn(async () => ({ text: 'Xin chào', content: 'Xin chào', truncated: false, stopped_limit: 0, context_full: false, interrupted: false, tool_calls: [], reasoning_content: '' })),
  stopCompletion: jest.fn(async () => {}), clearCache: jest.fn(async () => {}), release: jest.fn(async () => {}),
};
const native = {
  sha256: jest.fn(async () => HYMT_MODEL.sha256), availableMemory: jest.fn(async () => 8 * 1024 ** 3),
  supportedTextLanguages: jest.fn(async () => ['en', 'vi', 'th', 'ko']), isTranslationReady: jest.fn(async () => false),
  identifyLanguage: jest.fn(async () => 'en'), translate: jest.fn(async () => 'Native translation'),
};
beforeEach(async () => {
  await releaseOfflineText();
  jest.clearAllMocks(); files.clear();
  jest.spyOn(TurboModuleRegistry, 'get').mockReturnValue({} as never);
  jest.mocked(requireOptionalNativeModule).mockReturnValue(native);
  jest.mocked(initLlama).mockResolvedValue(context as never);
  context.tokenize.mockResolvedValue({ tokens: [1, 2, 3] });
  context.completion.mockResolvedValue({ text: 'Xin chào', content: 'Xin chào', truncated: false, stopped_limit: 0, context_full: false, interrupted: false, tool_calls: [], reasoning_content: '' });
  native.availableMemory.mockResolvedValue(8 * 1024 ** 3); native.isTranslationReady.mockResolvedValue(false);
  files.set(modelFilePath(HYMT_MODEL), HYMT_MODEL.bytes);
  await saveTranslationPreferences({ mode: 'auto', speechModel: 'base', textModel: 'hymt' });
});
afterEach(async () => { await releaseOfflineText(); jest.restoreAllMocks(); });

test.each(['vi', 'th', 'ko'])('a verified download translates %s on device with bounded context', async to => {
  expect(await translateHymt('Hello', to, 'en')).toBe('Xin chào');
  expect(initLlama).toHaveBeenCalledWith(expect.objectContaining({ model: modelFilePath(HYMT_MODEL), n_ctx: 2048, n_parallel: 1, use_mmap: true }));
  expect(context.completion).toHaveBeenCalledWith(expect.objectContaining({ n_predict: 512 }));
  expect(context.clearCache).toHaveBeenCalledWith(true);
});
test('oversized input and partial output are rejected rather than returned as translations', async () => {
  context.tokenize.mockResolvedValueOnce({ tokens: Array(1600).fill(1) });
  await expect(translateHymt('Long input', 'vi', 'en')).rejects.toThrow('shorter');
  expect(context.completion).not.toHaveBeenCalled();
  context.completion.mockResolvedValueOnce({ text: 'Partial', content: 'Partial', truncated: false, stopped_limit: 1, context_full: false, interrupted: false, tool_calls: [], reasoning_content: '' });
  await expect(translateHymt('Hello', 'vi', 'en')).rejects.toThrow('incomplete');
});
test('a cancelled native result cannot be published', async () => {
  const controller = new AbortController();
  context.completion.mockImplementationOnce(async () => { controller.abort(); return { text: 'Late', content: 'Late', truncated: false, stopped_limit: 0, context_full: false, interrupted: false, tool_calls: [], reasoning_content: '' }; });
  await expect(translateHymt('Hello', 'vi', 'en', controller.signal)).rejects.toThrow('cancelled');
  expect(context.stopCompletion).toHaveBeenCalled();
});
test('memory admission happens before loading the 1 GB model', async () => {
  native.availableMemory.mockResolvedValueOnce(500 * 1024 ** 2);
  await expect(translateHymt('Hello', 'vi', 'en')).rejects.toThrow('free memory');
  expect(initLlama).not.toHaveBeenCalled();
  jest.replaceProperty(Device, 'totalMemory', 4 * 1024 ** 3);
  expect(hymtUnavailableReason()).toContain('6 GB RAM');
});
test('Hy-MT2 readiness never claims that missing platform language packs are downloaded', async () => {
  expect(await offlineTextStatus('en', 'vi')).toMatchObject({ state: 'ready', provider: 'hymt' });
  expect(await localTextTranslation('Hello', 'vi', 'en')).toMatchObject({ translation: 'Xin chào', engine: 'device' });
  expect(native.translate).not.toHaveBeenCalled();
});
test('failed Hy-MT2 inference falls back to installed platform text packs before cloud is needed', async () => {
  native.isTranslationReady.mockResolvedValue(true);
  context.completion.mockRejectedValueOnce(new Error('Native model could not run'));
  expect(await localTextTranslation('Hello', 'vi', 'en')).toMatchObject({ translation: 'Native translation', engine: 'device' });
});
test('model deletion waits for inference, releases the context and selects the platform fallback', async () => {
  await translateHymt('Hello', 'vi', 'en');
  await removeTextModel();
  expect(context.release).toHaveBeenCalledTimes(1);
  expect(files.has(modelFilePath(HYMT_MODEL))).toBe(false);
  expect(translationPreferences().textModel).toBe('platform');
});


test('a phone advertised as 6 GB remains eligible while older native builds explain the missing runtime', () => {
  jest.replaceProperty(Device, 'totalMemory', 6_000_000_000);
  expect(hymtUnavailableReason()).toBeNull();
  jest.mocked(TurboModuleRegistry.get).mockReturnValue(null);
  expect(hymtUnavailableReason()).toContain('latest Roamie build');
});
