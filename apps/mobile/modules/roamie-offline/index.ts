import { requireOptionalNativeModule } from 'expo';

export type OcrLine = { text: string; box: { x: number; y: number; w: number; h: number } };
export type OfflineNative = {
  supportedTextLanguages(): Promise<string[]>;
  canRemoveLanguagePacks(): Promise<boolean>;
  downloadedLanguages(): Promise<string[]>;
  isTranslationReady(from: string, to: string): Promise<boolean>;
  downloadLanguage(language: string, cellular: boolean): Promise<void>;
  removeLanguage(language: string): Promise<void>;
  identifyLanguage(text: string): Promise<string>;
  translate(text: string, from: string, to: string): Promise<string>;
  recognizeText(uri: string, language: string): Promise<OcrLine[]>;
  offlineVoices(): Promise<{ identifier: string; language: string }[]>;
  ocrLanguages(): Promise<string[]>;
  sha256(uri: string): Promise<string>;
  audioToWav(uri: string): Promise<string>;
  availableMemory(): Promise<number>;
};

export function offlineNative(): OfflineNative | null {
  return requireOptionalNativeModule<OfflineNative>('RoamieOffline');
}
