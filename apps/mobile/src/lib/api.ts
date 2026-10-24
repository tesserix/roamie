import { ApiError as RequestError, apiRequest } from './trip-api';
import type { StatementLine } from './statement';
import { offlineStatus, offlineTurn, translateOffline } from './offline-translation';
const OFFLINE = "Can't reach Roamie. Check your connection and try again.";

export class ApiError extends Error {
  constructor(message: string, public readonly status?: number, public readonly code?: string) { super(message); }
  get retryable() {
    return this.status === undefined ? this.code === 'network' || this.code === 'timeout' : [408, 502, 503, 504].includes(this.status);
  }
}

async function call<T>(path: string, payload?: unknown, signal?: AbortSignal, milliseconds = 65000): Promise<T> {
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
  offline?: boolean;
  mine?: string;
  fromMe?: boolean;
  reviewRequired?: boolean;
  decisionModel?: string;
  detected: string;
  confidence: number;
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
  audio?: { data: string; mimeType: string };
  text?: string;
  history: { original: string; translation: string }[];
};

export async function talkTurn(req: TurnRequest, signal?: AbortSignal, onRetry?: () => void): Promise<TurnResponse> {
  if (signal?.aborted) throw new ApiError('Request cancelled.', undefined, 'cancelled');
  const local = async () => {
    try {
      const result = await offlineTurn(req, signal);
      if (signal?.aborted) throw new Error('Request cancelled.');
      return result;
    } catch (error) { throw new ApiError(error instanceof Error ? error.message : 'Offline translation could not finish.', undefined, 'offline'); }
  };
  if (!(await offlineStatus()).online) return local();
  const input = req.audio ? { ...req, history: [] } : req;
  const deadline = Date.now() + 90000;
  for (let attempt = 0; ; attempt++) {
    try {
      return await call<TurnResponse>('/v1/talk/turn', input, signal, Math.min(65000, Math.max(1, deadline - Date.now())));
    } catch (error) {
      if (!signal?.aborted && error instanceof ApiError && ['network', 'timeout'].includes(error.code ?? '') && !(await offlineStatus()).online) return local();
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

export type VoiceGender = 'female' | 'male';

export const synthesizeSpeech = (text: string, language: string, voice: VoiceGender | undefined, signal?: AbortSignal) =>
  call<{ data: string; mimeType: 'audio/wav' }>('/v1/talk/speech', { text, language, voice }, signal);

export type TextTranslation = {
  offline?: boolean;
  detected: string;
  translation: string;
  romanized: string;
  sourceRomanized: string;
  alternatives: string[];
};

export async function translateText(text: string, to: string, from?: string, signal?: AbortSignal): Promise<TextTranslation> {
  if (signal?.aborted) throw new ApiError('Request cancelled.', undefined, 'cancelled');
  const local = async (): Promise<TextTranslation> => {
    if (!from) throw new ApiError('Choose the source language to translate offline.', undefined, 'offline');
    try {
      const translation = await translateOffline(text, from, to, signal);
      if (signal?.aborted) throw new Error('Request cancelled.');
      return { offline: true, detected: from, translation, romanized: '', sourceRomanized: '', alternatives: [] };
    } catch (error) { throw new ApiError(error instanceof Error ? error.message : 'Offline translation could not finish.', undefined, 'offline'); }
  };
  if (!(await offlineStatus()).online) return local();
  try { return await call<TextTranslation>('/v1/translate/text', { text, to, from }, signal); }
  catch (error) {
    if (!signal?.aborted && error instanceof ApiError && ['network', 'timeout'].includes(error.code ?? '') && !(await offlineStatus()).online) return local();
    throw error;
  }
}

export type SignLine = {
  original: string;
  translation: string;
  romanized: string;
  box: { x: number; y: number; w: number; h: number };
};

export type DocumentSource = { ocrJobId: string; status: string; reviewRequired: boolean; decisionModel: string };

export const translateSign = (data: string, mimeType: string, to: string) =>
  call<{ detected: string; gist: string; lines: SignLine[]; reviewRequired?: boolean; ocrJobId?: string }>('/v1/signs/translate', { data, mimeType, to }, undefined, 95000);

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
