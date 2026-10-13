import type { MemoryOptions } from './memory-contract';
import { fetch } from 'expo/fetch';
import { API_BASE, session } from './auth-client';
import type { Destination, PlanRequest, PlanResponse } from './trip-contract';

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}

export async function apiRequest<T>(path: string, payload: unknown, read: (response: Response) => Promise<T>, milliseconds: number, signal?: AbortSignal, method: 'GET' | 'PUT' | 'POST' | 'DELETE' = 'POST'): Promise<T> {
  if (!__DEV__ && !API_BASE.startsWith('https://')) throw new Error('A secure connection is required.');
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, milliseconds);
  signal?.addEventListener('abort', abort);
  if (signal?.aborted) abort();
  const customer = session.current()?.sub;
  const revision = session.revision?.();
  const changed = () => session.current()?.sub !== customer || session.revision?.() !== revision;
  try {
    const token = await session.accessToken();
    if (!customer || changed()) throw new Error('The account changed. Please try again.');
    if (controller.signal.aborted) throw new Error('Request cancelled or timed out.');
    const response = await fetch(`${API_BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: method === 'GET' ? undefined : JSON.stringify(payload), signal: controller.signal });
    if (!customer || changed()) throw new Error('The account changed. Please try again.');
    if (response.status === 401) { if (!changed()) await session.clear(); throw new Error('Sign in again to continue.'); }
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const fallback = response.status === 504
        ? path === '/v1/trip-manager'
          ? 'This request took too long. Your saved trip is still available. Please try again.'
          : 'This request took too long. Please try again.'
        : 'Roamie could not finish that. Please try again.';
      throw new ApiError(response.status, body?.error ?? 'unavailable', body?.message ?? fallback);
    }
    const data = await read(response);
    if (signal?.aborted || controller.signal.aborted) throw new Error('Request cancelled or timed out.');
    if (!customer || changed()) throw new Error('The account changed. Please try again.');
    return data;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
export const planTrip = (trip: PlanRequest, signal?: AbortSignal) => apiRequest<PlanResponse>('/v1/trips/plan', trip, res => res.json(), 60000, signal);
export type { MemoryOptions } from './memory-contract';
export const memoryCapabilities = (signal?: AbortSignal) => apiRequest<{editorVersion:number;maxAudioBytes:number}>('/v1/memories/capabilities', {}, res => res.json(), 12000, signal);
export const renderMemory = (title: string, durationSeconds: 60 | 90, images: string[], captions: string[], signal?: AbortSignal, options?: MemoryOptions) => apiRequest('/v1/memories/render', { title: title.slice(0, 80), durationSeconds, images, captions, options }, async res => {
  if (!res.headers.get('content-type')?.startsWith('video/mp4')) throw new Error('The video response was not valid.');
  const bytes = await res.bytes();
  if (!bytes.length || bytes.length > 30_000_000) throw new Error('The video could not be downloaded.');
  return bytes;
}, 125000, signal);

export const searchDestinations = (query: string, signal?: AbortSignal) => apiRequest<Destination[]>('/v1/destinations/search', { query }, res => res.json(), 12000, signal);

export async function resolveDestination(destination: Destination, signal: AbortSignal): Promise<Destination & { latitude: number; longitude: number }> {
  if (signal.aborted) throw new Error('Request cancelled or timed out.');
  const located = (place?: Destination): place is Destination & { latitude: number; longitude: number } =>
    typeof place?.latitude === 'number' && Math.abs(place.latitude) <= 90 &&
    typeof place.longitude === 'number' && Math.abs(place.longitude) <= 180;
  if (located(destination)) return destination;
  const place = (await searchDestinations(destination.label, signal)).find(item => item.placeId === destination.placeId);
  if (!located(place)) throw new Error('Choose this destination again from search so we can check its weather and entry guidance.');
  return place;
}
