const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8080';
const OFFLINE = "Can't reach Roamie. Check your connection and try again.";

export class ApiError extends Error {}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
    });
  } catch {
    throw new ApiError(OFFLINE);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(body?.message ?? OFFLINE);
  return body as T;
}

export type TurnResponse = {
  detected: string;
  confidence: number;
  candidates: string[];
  transcript: string;
  translation: string;
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
