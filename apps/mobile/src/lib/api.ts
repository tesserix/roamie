import { authFetch, session } from './auth-client';
const OFFLINE = "Can't reach Roamie. Check your connection and try again.";

export class ApiError extends Error {}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    const token = await session.accessToken();
    res = await authFetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers, Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new ApiError(OFFLINE);
  }
  const body = await res.json().catch(() => null);
  if (res.status === 401) {
    await session.clear();
    throw new ApiError('Sign in again to continue.');
  }
  if (!res.ok) throw new ApiError(body?.message ?? OFFLINE);
  return body as T;
}

export type TurnResponse = {
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
  audio?: { data: string; mimeType: string };
  text?: string;
  history: { original: string; translation: string }[];
};

export const talkTurn = (req: TurnRequest) =>
  call<TurnResponse>('/v1/talk/turn', { method: 'POST', body: JSON.stringify(req) });

export type TextTranslation = {
  detected: string;
  translation: string;
  romanized: string;
  sourceRomanized: string;
  alternatives: string[];
};

export const translateText = (text: string, to: string, from?: string) =>
  call<TextTranslation>('/v1/translate/text', { method: 'POST', body: JSON.stringify({ text, to, from }) });

export type SignLine = {
  original: string;
  translation: string;
  romanized: string;
  box: { x: number; y: number; w: number; h: number };
};

export const translateSign = (data: string, mimeType: string, to: string) =>
  call<{ detected: string; gist: string; lines: SignLine[] }>('/v1/signs/translate', {
    method: 'POST',
    body: JSON.stringify({ data, mimeType, to }),
  });

export type Receipt = {
  merchant: string;
  amountMinor: number | null;
  currency: string | null;
  date: string | null;
  category: string;
  confidence: number;
};

export const readReceipt = (data: string, mimeType: string, localCurrency?: string) =>
  call<Receipt>('/v1/receipts/extract', {
    method: 'POST',
    body: JSON.stringify({ data, mimeType, localCurrency }),
  });

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

export const nearby = (lat: number, lng: number, kind: Kind, diet: string) =>
  call<{ places: Place[]; relaxed: string[] }>(
    `/v1/nearby?lat=${lat}&lng=${lng}&kind=${kind}&diet=${diet}`,
  );

export const fxRates = (base: string) =>
  call<{ base: string; asOf: string; rates: Record<string, number> }>(`/v1/fx?base=${base}`);
