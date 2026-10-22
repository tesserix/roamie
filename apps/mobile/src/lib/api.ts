import { ApiError as RequestError, apiRequest } from './trip-api';
import type { StatementLine } from './statement';
import { offlineNative } from '../../modules/roamie-offline';
import { appLanguage, checkTranslationCanceled, localTextTranslation, supportsLocalText } from './offline-translation';
import { restoreTranslationPreferences, translationPreferences } from './translation-preferences';
const OFFLINE = "Can't reach Roamie. Check your connection and try again.";

export class ApiError extends Error {
  constructor(message: string, public readonly status?: number, public readonly code?: string) { super(message); }
  get retryable() {
    return this.status === undefined ? this.code === 'network' || this.code === 'timeout' : [408, 502, 503, 504].includes(this.status);
  }
}

async function call<T>(path: string, payload?: unknown, signal?: AbortSignal, milliseconds = 65000): Promise<T> {
  if (translationPreferences().mode === 'offline' && ['/v1/translate/text', '/v1/talk/turn', '/v1/talk/speech', '/v1/signs/translate'].includes(path)) {
    throw new ApiError('Offline mode is active. Download the required models or change the translation preference.', undefined, 'offline_unavailable');
  }
  try {
    return await apiRequest<T>(path, payload, async response => {
      const body = await response.json();
      if (body === null) throw new ApiError('Roamie returned an unreadable response. Please try again.');
      return body as T;
    }, milliseconds, signal, payload === undefined ? 'GET' : 'POST');
  } catch (error) {
    if (signal?.aborted) throw new ApiError('Request cancelled.', undefined, 'cancelled');
    if (error instanceof ApiError) throw error;
    if (error instanceof RequestError) throw new ApiError(error.message, error.status, error.code);
    if (error instanceof TypeError) throw new ApiError(OFFLINE, undefined, 'network');
    if (error instanceof Error && (error.name === 'AbortError' || error.message === 'Request cancelled or timed out.')) {
      throw new ApiError('This request took too long. Please try again.', 408, 'timeout');
    }
    throw new ApiError(error instanceof Error ? error.message : OFFLINE);
  }
}

export type TurnResponse = {
  engine?: 'device' | 'cloud';
  mine?: string;
  fromMe?: boolean;
  reviewRequired?: boolean;
  decisionModel?: string;
  detected: string;
  confidence?: number;
  candidates: string[];
  transcript: string;
  translation: string;
  romanized: string;
  target: string;
  partner: string;
  sameLanguage: boolean;
  voice?: VoiceGender;
};

export type TurnRequest = {
  mine: string;
  partner: string;
  autoMine?: boolean;
  partnerLocked?: boolean;
  expectedSpeaker?: 'mine' | 'partner';
  audio?: { data?: string; mimeType: string; uri?: string };
  offlineOnly?: boolean;
  text?: string;
  history: { original: string; translation: string }[];
};

async function cloudTalkTurn(req: TurnRequest, signal?: AbortSignal, onRetry?: () => void): Promise<TurnResponse> {
  const { offlineOnly: _offlineOnly, audio, ...rest } = req;
  let input: Omit<TurnRequest, 'offlineOnly'> = rest;
  if (audio) {
    const data = audio.data ?? (audio.uri ? await new (await import('expo-file-system')).File(audio.uri).base64() : undefined);
    if (!data) throw new ApiError('Record a phrase before translating.', 422);
    input = { ...rest, audio: { data, mimeType: audio.mimeType }, history: [] };
  }
  checkTranslationCanceled(signal);
  const deadline = Date.now() + (offlineNative() ? 20000 : 90000);
  for (let attempt = 0; ; attempt++) {
    try {
      return await call<TurnResponse>('/v1/talk/turn', input, signal, Math.min(65000, Math.max(1, deadline - Date.now())));
    } catch (error) {
      const temporary = error instanceof ApiError && error.retryable;
      if (!temporary || attempt >= 1 || signal?.aborted || Date.now() >= deadline) throw error;
      onRetry?.();
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new ApiError('Request cancelled.', undefined, 'cancelled')); };
        const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, 1000 + Math.random() * 400);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
      });
    }
  }
}

async function routedTranslation<T>(local: () => Promise<T | null>, cloud: () => Promise<T>, signal?: AbortSignal, offlineOnly = false, missing = 'Download both languages in Offline languages, or connect to the internet.'): Promise<T> {
  checkTranslationCanceled(signal);
  const available = Boolean(offlineNative());
  if (available) await restoreTranslationPreferences();
  checkTranslationCanceled(signal);
  const mode = offlineOnly ? 'offline' : translationPreferences().mode;
  let localError: unknown;
  if (mode !== 'cloud') {
    try {
      const result = await local();
      if (result !== null) return result;
    } catch (error) {
      checkTranslationCanceled(signal);
      if (error instanceof ApiError && error.code === 'no_speech') throw error;
      localError = error;
    }
  }
  checkTranslationCanceled(signal);
  if (mode === 'offline') throw new ApiError(localError instanceof Error ? localError.message : missing, undefined, 'offline_unavailable');
  if (available) {
    const network = await (await import('expo-network')).getNetworkStateAsync().catch(() => null);
    checkTranslationCanceled(signal);
    if (network?.isConnected === false || network?.isInternetReachable === false) throw new ApiError(localError instanceof Error ? localError.message : missing, undefined, 'offline_unavailable');
  }
  if (translationPreferences().mode === 'offline') throw new ApiError(missing, undefined, 'offline_unavailable');
  return cloud();
}

export async function talkTurn(req: TurnRequest, signal?: AbortSignal, onRetry?: () => void): Promise<TurnResponse> {
  let cloudInput = req;
  return routedTranslation<TurnResponse>(async () => {
    if (!offlineNative()) return null;
    let text = req.text;
    let detected: string | undefined;
    if (req.audio) {
      if (!req.audio.uri || req.mine === 'or' || req.partner === 'or') return null;
      if (req.offlineOnly || translationPreferences().mode === 'offline') {
        const installed = new Set(['en', ...await offlineNative()!.downloadedLanguages()]);
        if (![req.mine, req.partner].every(language => supportsLocalText(language) && installed.has(language === 'fil' ? 'tl' : language))) return null;
      }
      const { transcribeOffline, LocalSpeechError } = await import('./offline-speech');
      try {
        const speech = await transcribeOffline(req.audio.uri, signal);
        if (!speech) return null;
        text = speech.text; detected = speech.language;
        cloudInput = { ...req, audio: undefined, text, history: [] };
      } catch (error) {
        if (error instanceof LocalSpeechError && error.code === 'no_speech') throw new ApiError(error.message, 422, 'no_speech');
        throw error;
      }
    }
    if (!text?.trim()) return null;
    detected ??= appLanguage(await offlineNative()!.identifyLanguage(text));
    checkTranslationCanceled(signal);
    if (!supportsLocalText(detected)) return null;
    const fromMe = req.partnerLocked && req.autoMine ? detected !== req.partner : detected === req.mine;
    const mine = req.autoMine && fromMe ? detected : req.mine;
    if (req.partnerLocked && !fromMe && detected !== req.partner) throw new Error('The speech did not match the chosen languages. Check the languages and try again.');
    const target = fromMe ? req.partner : mine;
    const result = await localTextTranslation(text, target, detected, signal);
    if (!result) return null;
    return { engine: 'device', fromMe, mine, detected, candidates: [detected], transcript: text, translation: result.translation, romanized: '', target, partner: fromMe ? req.partner : detected, sameLanguage: detected === target };
  }, () => cloudTalkTurn(cloudInput, signal, onRetry), signal, req.offlineOnly,
  'Offline conversation needs both language packs and a downloaded speech model. Open Offline languages to prepare them.');
}

export type VoiceGender = 'female' | 'male';

export const synthesizeSpeech = (text: string, language: string, voice: VoiceGender | undefined, signal?: AbortSignal) =>
  call<{ data: string; mimeType: 'audio/wav' }>('/v1/talk/speech', { text, language, voice }, signal);

export type TextTranslation = {
  engine?: 'device' | 'cloud';
  detected: string;
  translation: string;
  romanized: string;
  sourceRomanized: string;
  alternatives: string[];
};

export const translateText = (text: string, to: string, from?: string, signal?: AbortSignal, offlineOnly = false) =>
  routedTranslation(() => localTextTranslation(text, to, from, signal), () => call<TextTranslation>('/v1/translate/text', { text, to, from }, signal, offlineNative() ? 12000 : 65000), signal, offlineOnly,
    !supportsLocalText(to) || (from && !supportsLocalText(from)) ? 'This language pair is not supported on this device. Connect to the internet to translate it.' : 'Download both languages in Offline languages. For short phrases, choose the source language instead of automatic detection.');

export type SignLine = {
  original: string;
  translation: string;
  romanized: string;
  box: { x: number; y: number; w: number; h: number };
};

export type DocumentSource = { ocrJobId: string; status: string; reviewRequired: boolean; decisionModel: string };

export type SignTranslation = { detected: string; gist: string; lines: SignLine[]; engine?: 'device' | 'cloud'; reviewRequired?: boolean; ocrJobId?: string };
export const translateSign = (data: string, mimeType: string, to: string, photo?: { uri: string; from?: string; signal?: AbortSignal; offlineOnly?: boolean }) =>
  routedTranslation<SignTranslation>(async () => {
    const native = offlineNative();
    if (!native || !photo || !supportsLocalText(to) || (photo.from && !supportsLocalText(photo.from))) return null;
    const read = await native.recognizeText(photo.uri, photo.from ?? 'auto');
    checkTranslationCanceled(photo.signal);
    if (!read.length) throw new Error('No text was found. Choose the sign language, take a clearer photo, or type the text.');
    const detected = photo.from ?? appLanguage(await native.identifyLanguage(read.map(line => line.text).join(' ').slice(0, 5000)));
    const lines: SignLine[] = [];
    for (const line of read.slice(0, 80)) {
      const result = await localTextTranslation(line.text, to, detected, photo.signal);
      if (!result) return null;
      lines.push({ original: line.text, translation: result.translation, romanized: '', box: line.box });
    }
    return { detected, gist: lines.map(line => line.translation).join(' '), lines, engine: 'device', reviewRequired: true };
  }, async () => {
    const image = data || (photo ? await new (await import('expo-file-system')).File(photo.uri).base64() : '');
    checkTranslationCanceled(photo?.signal);
    return call<SignTranslation>('/v1/signs/translate', { data: image, mimeType, to }, photo?.signal, offlineNative() ? 20000 : 95000);
  }, photo?.signal, photo?.offlineOnly,
  'Offline photos need a supported sign language and both translation packs. Choose the sign language or type the text instead.');

export type Receipt = {
  merchant: string;
  amountMinor: number | null;
  currency: string | null;
  date: string | null;
  category: string;
  confidence: number;
  source?: DocumentSource;
};

export const readReceipt = (data: string, mimeType: string, localCurrency?: string) =>
  call<Receipt>('/v1/receipts/extract', { data, mimeType, localCurrency }, undefined, 95000);

export type Statement = { transactions: StatementLine[]; outsideTrip: number; unreadable: number; source?: DocumentSource };

export const readStatement = (data: string, mimeType: string, from: string, to: string) =>
  call<Statement>('/v1/statements/extract', { data, mimeType, from, to }, undefined, 95000);

export type Place = {
  id: string;
  name: string;
  address: string;
  mapsUri: string;
  distanceM: number;
  rating: number | null;
  priceLevel?: number | null;
  lat?: number;
  lng?: number;
  openNow: boolean | null;
  why: string;
};

export type Kind = 'food' | 'pharmacy' | 'atm' | 'sights';

export const nearby = (lat: number, lng: number, kind: Kind, diet: string, signal?: AbortSignal) =>
  call<{ places: Place[]; relaxed: string[] }>(
    `/v1/nearby?lat=${lat}&lng=${lng}&kind=${kind}&diet=${diet}`, undefined, signal,
  );

export const fxRates = (base: string) =>
  call<{ base: string; asOf: string; rates: Record<string, number> }>(`/v1/fx?base=${base}`);
