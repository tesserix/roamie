import { Platform, TurboModuleRegistry } from 'react-native';
import * as Device from 'expo-device';
import { supportsLargeOfflineModels, largeModelMemoryReason } from './offline-device';
import { downloadModelFile, hasPartialModelFile, modelFileStatus, removeModelFile, withModelDownloadNetwork, type ModelFile } from './model-files';
import { saveTranslationPreferences, translationPreferences } from './translation-preferences';
import { withOfflineInference } from './offline-inference';

export const HYMT_MODEL: ModelFile = {
  file: 'Hy-MT2-1.8B-Q4_K_M.gguf', bytes: 1133080448,
  sha256: 'dc5f44fcf1fa496ee7ad725982c0c8c553a4de00259b53af84c4b89fb0c06699',
  repository: 'tencent/Hy-MT2-1.8B-GGUF', revision: 'a0c709d9fac510f2c807aa3af52872340dc37a4a', resumable: true,
};
const LANGUAGES = new Set('zh en fr pt es ja tr ru ar ko th it de vi ms id fil hi pl cs nl km my fa gu ur te mr he bn ta uk bo kk mn ug yue zh-Hant'.split(' '));
export const supportsHymt = (language: string) => LANGUAGES.has(language === 'tl' ? 'fil' : language);

export function hymtUnavailableReason(): string | null {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return 'The Large model is available in the iOS and Android apps.';
  if (Device.supportedCpuArchitectures?.length && !Device.supportedCpuArchitectures.some(architecture => architecture.includes('64'))) return 'The Large model needs a 64-bit phone. Use platform language packs on this device.';
  if (!supportsLargeOfflineModels()) return largeModelMemoryReason('The Large model');
  if (!TurboModuleRegistry.get('RNLlama')) return 'Install the latest Roamie build to use The Large model. Platform language packs are still available.';
  return null;
}

export const textModelStatus = () => modelFileStatus(HYMT_MODEL);
export const hasPartialTextModel = () => hasPartialModelFile(HYMT_MODEL);

export async function downloadTextModel(cellular: boolean, progress: (fraction: number) => void, signal?: AbortSignal) {
  const problem = hymtUnavailableReason();
  if (problem) throw new Error(problem);
  await withModelDownloadNetwork(cellular, signal, active => downloadModelFile(HYMT_MODEL, progress, active));
  if (signal?.aborted) throw new Error('Model download cancelled.');
  await saveTranslationPreferences({ textModel: 'hymt' });
}

export async function removeTextModel() {
  await withOfflineInference('text', async () => {
    await (await import('./offline-text')).releaseOfflineText();
    await removeModelFile(HYMT_MODEL);
    if (translationPreferences().textModel === 'hymt') await saveTranslationPreferences({ textModel: 'platform' });
  });
}
