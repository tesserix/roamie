import type { TextTranslation } from './api';
import { offlineNative } from '../../modules/roamie-offline';

const SUPPORTED = new Set('af ar be bg bn ca cs cy da de el en eo es et fa fi fr ga gl gu he hi hr ht hu id is it ja ka kn ko lt lv mk mr ms mt nl no pl pt ro ro ru sk sl sq sv sw ta te th tl tr uk ur vi zh'.split(' '));

export const modelLanguage = (language: string) => language === 'fil' ? 'tl' : language;
export const appLanguage = (language: string) => language === 'tl' ? 'fil' : language;
export const supportsLocalText = (language: string, supported?: string[]) => supported ? supported.includes(modelLanguage(language)) : SUPPORTED.has(modelLanguage(language));

export type OfflineTextStatus = { state: 'ready' | 'missing' | 'unsupported' | 'unavailable' | 'choose_languages'; unsupported: string[] };

export async function offlineTextStatus(from: string, to: string | null): Promise<OfflineTextStatus> {
  const native = offlineNative();
  if (!native) return { state: 'unavailable', unsupported: [] };
  if (!to || from === to) return { state: 'choose_languages', unsupported: [] };
  const supported = await native.supportedTextLanguages();
  const unsupported = [from, to].filter(language => !supportsLocalText(language, supported));
  if (unsupported.length) return { state: 'unsupported', unsupported };
  const directions = await Promise.all([
    native.isTranslationReady(modelLanguage(from), modelLanguage(to)),
    native.isTranslationReady(modelLanguage(to), modelLanguage(from)),
  ]);
  return { state: directions.every(Boolean) ? 'ready' : 'missing', unsupported: [] };
}

export function checkTranslationCanceled(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('Translation cancelled.');
}

export async function localTextTranslation(text: string, to: string, from?: string, signal?: AbortSignal): Promise<TextTranslation | null> {
  checkTranslationCanceled(signal);
  const native = offlineNative();
  if (!native) return null;
  const supported = await native.supportedTextLanguages();
  if (!supportsLocalText(to, supported)) return null;
  const detected = from ?? appLanguage(await native.identifyLanguage(text));
  checkTranslationCanceled(signal);
  if (!supportsLocalText(detected, supported)) return null;
  if (detected === to) return { detected, translation: text, romanized: '', sourceRomanized: '', alternatives: [], engine: 'device' };
  if (!await native.isTranslationReady(modelLanguage(detected), modelLanguage(to))) return null;
  checkTranslationCanceled(signal);
  const translation = await native.translate(text, modelLanguage(detected), modelLanguage(to));
  checkTranslationCanceled(signal);
  if (!translation.trim()) throw new Error('The device could not translate this text. Try a shorter phrase.');
  return { detected, translation, romanized: '', sourceRomanized: '', alternatives: [], engine: 'device' };
}
