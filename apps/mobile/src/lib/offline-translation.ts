import type { TextTranslation } from './api';
import { offlineNative } from '../../modules/roamie-offline';
import { hymtUnavailableReason, supportsHymt, textModelStatus } from './text-models';
import { translateHymt } from './offline-text';
import { restoreTranslationPreferences, translationPreferences } from './translation-preferences';

const SUPPORTED = new Set('af ar be bg bn ca cs cy da de el en eo es et fa fi fr ga gl gu he hi hr ht hu id is it ja ka kn ko lt lv mk mr ms mt nl no pl pt ro ro ru sk sl sq sv sw ta te th tl tr uk ur vi zh'.split(' '));

export const modelLanguage = (language: string) => language === 'fil' ? 'tl' : language;
export const appLanguage = (language: string) => language === 'tl' ? 'fil' : language;
export const supportsLocalText = (language: string, supported?: string[]) => supported ? supported.includes(modelLanguage(language)) : SUPPORTED.has(modelLanguage(language)) || supportsHymt(language);

export type OfflineTextStatus = { state: 'ready' | 'missing' | 'unsupported' | 'unavailable' | 'choose_languages'; unsupported: string[]; provider?: 'platform' | 'hymt' };

export async function platformTextStatus(from: string, to: string | null): Promise<OfflineTextStatus> {
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

export async function offlineTextStatus(from: string, to: string | null): Promise<OfflineTextStatus> {
  const platform = await platformTextStatus(from, to).catch((): OfflineTextStatus => ({ state: 'unavailable', unsupported: [] }));
  if (platform.state === 'ready' && translationPreferences().textModel !== 'hymt') return { ...platform, provider: 'platform' };
  const compatible = to && from !== to && supportsHymt(from) && supportsHymt(to) && !hymtUnavailableReason();
  const hymt = compatible && await textModelStatus() === 'ready';
  if (hymt && (translationPreferences().textModel === 'hymt' || platform.state !== 'ready')) return { state: 'ready', unsupported: [], provider: 'hymt' };
  if (platform.state === 'ready') return { ...platform, provider: 'platform' };
  return compatible && platform.state === 'unsupported' ? { state: 'missing', unsupported: [], provider: 'hymt' } : platform;
}

export function checkTranslationCanceled(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('Translation cancelled.');
}

export async function localTextTranslation(text: string, to: string, from?: string, signal?: AbortSignal): Promise<TextTranslation | null> {
  checkTranslationCanceled(signal);
  await restoreTranslationPreferences();
  const native = offlineNative();
  const detected = from ?? (native ? appLanguage(await native.identifyLanguage(text)) : undefined);
  checkTranslationCanceled(signal);
  if (!detected || !supportsLocalText(detected) || !supportsLocalText(to)) return null;
  if (detected === to) return { detected, translation: text, romanized: '', sourceRomanized: '', alternatives: [], engine: 'device' };
  const providers = translationPreferences().textModel === 'hymt' ? ['hymt', 'platform'] : ['platform', 'hymt'];
  let problem: unknown;
  for (const provider of providers) {
    try {
      let translation: string | null = null;
      if (provider === 'hymt') translation = await translateHymt(text, to, detected, signal);
      else if (native) {
        const supported = await native.supportedTextLanguages();
        if (supportsLocalText(to, supported) && supportsLocalText(detected, supported) && await native.isTranslationReady(modelLanguage(detected), modelLanguage(to))) {
          checkTranslationCanceled(signal);
          translation = await native.translate(text, modelLanguage(detected), modelLanguage(to));
        }
      }
      checkTranslationCanceled(signal);
      if (translation === null) continue;
      if (!translation.trim()) throw new Error('The device could not translate this text. Try a shorter phrase.');
      return { detected, translation, romanized: '', sourceRomanized: '', alternatives: [], engine: 'device' };
    } catch (error) { checkTranslationCanceled(signal); problem = error; }
  }
  if (problem) throw problem;
  return null;
}
