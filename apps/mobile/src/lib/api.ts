import { apiRequest } from './trip-api';
import type { StatementLine } from './statement';
const OFFLINE = "Can't reach Roamie. Check your connection and try again.";

export class ApiError extends Error {}

async function call<T>(path: string, payload?: unknown, signal?: AbortSignal, milliseconds = 65000): Promise<T> {
  try {
    return await apiRequest<T>(path, payload, async response => {
      const body = await response.json();
      if (body === null) throw new ApiError('Roamie returned an unreadable response. Please try again.');
      return body as T;
    }, milliseconds, signal, payload === undefined ? 'GET' : 'POST');
  } catch (error) {
    throw new ApiError(error instanceof TypeError ? OFFLINE : error instanceof Error ? error.message : OFFLINE);
  }
}

export type TurnResponse = {
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
};

export type TurnRequest = {
  mine: string;
  partner: string;
  autoMine?: boolean;
  expectedSpeaker?: 'mine' | 'partner';
  audio?: { data: string; mimeType: string };
  text?: string;
  history: { original: string; translation: string }[];
};

export const talkTurn = (req: TurnRequest, signal?: AbortSignal) =>
  call<TurnResponse>('/v1/talk/turn', req, signal);

export const synthesizeSpeech = (text: string, language: string, signal?: AbortSignal) =>
  call<{ data: string; mimeType: 'audio/wav' }>('/v1/talk/speech', { text, language }, signal);

export type TextTranslation = {
  detected: string;
  translation: string;
  romanized: string;
  sourceRomanized: string;
  alternatives: string[];
};

export const translateText = (text: string, to: string, from?: string, signal?: AbortSignal) =>
  call<TextTranslation>('/v1/translate/text', { text, to, from }, signal);

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
