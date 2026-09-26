import type { MemoryOptions } from './memory-contract';
import { fetch } from 'expo/fetch';
import { API_BASE, session } from './auth-client';
import type { Destination, PlanRequest, PlanResponse } from './trip-contract';

async function request<T>(path: string, payload: unknown, read: (response: Response) => Promise<T>, milliseconds: number, signal?: AbortSignal): Promise<T> {
  if (!__DEV__ && !API_BASE.startsWith('https://')) throw new Error('A secure connection is required.');
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, milliseconds);
  signal?.addEventListener('abort', abort);
  if (signal?.aborted) abort();
  const customer = session.current()?.sub;
  try {
    const token = await session.accessToken();
    const response = await fetch(`${API_BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(payload), signal: controller.signal });
    if (response.status === 401) { await session.clear(); throw new Error('Sign in again to continue.'); }
    if (!response.ok) { const body = await response.json().catch(() => null); throw new Error(body?.message ?? 'Roamie could not finish that. Please try again.'); }
    const data = await read(response);
    if (signal?.aborted || controller.signal.aborted) throw new Error('Request cancelled or timed out.');
    if (!customer || session.current()?.sub !== customer) throw new Error('The account changed. Please try again.');
    return data;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
export const planTrip = (trip: PlanRequest, signal?: AbortSignal) => request<PlanResponse>('/v1/trips/plan', trip, res => res.json(), 60000, signal);
export type { MemoryOptions } from './memory-contract';
export const memoryCapabilities = (signal?: AbortSignal) => request<{editorVersion:number;maxAudioBytes:number}>('/v1/memories/capabilities', {}, res => res.json(), 12000, signal);
export const renderMemory = (title: string, durationSeconds: 60 | 90, images: string[], captions: string[], signal?: AbortSignal, options?: MemoryOptions) => request('/v1/memories/render', { title: title.slice(0, 80), durationSeconds, images, captions, options }, async res => {
  if (!res.headers.get('content-type')?.startsWith('video/mp4')) throw new Error('The video response was not valid.');
  const bytes = await res.bytes();
  if (!bytes.length || bytes.length > 30_000_000) throw new Error('The video could not be downloaded.');
  return bytes;
}, 125000, signal);

export const searchDestinations = (query: string, signal?: AbortSignal) => request<Destination[]>('/v1/destinations/search', { query }, res => res.json(), 12000, signal);
