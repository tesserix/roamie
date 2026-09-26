import { fetch } from 'expo/fetch';
import { API_BASE, session } from './auth-client';
import { searchDestinations } from './trip-api';
import { stayDates, type Trip } from './trips';

export type PlanningFact = { id: string; name: string; source_url: string; observed_at: string;
  weather?: { coverage: string; local_date?: string | null; minimum_celsius?: number | null; maximum_celsius?: number | null; precipitation_percent?: number | null; missing_dates: string[]; suggestions: string[] } | null;
  entry?: { verification: string; checklist: string[]; missing_information: string[] } | null;
};
export type PlanningResponse = { response: { status: string; recommendations: PlanningFact[]; limitations: string[] }; profile_revision: string };
export type DestinationCheck = { destination: string; start: string; end: string; weather?: PlanningResponse; entry?: PlanningResponse; error?: string };
type Saved = { revision: string; preferences: Record<string, unknown> };

async function call<T>(path: string, method: string, payload: unknown, signal: AbortSignal): Promise<T | null> {
  const customer = session.current()?.sub;
  const token = await session.accessToken();
  const res = await fetch(API_BASE + path, { method, signal, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
  if (!customer || customer !== session.current()?.sub) throw new Error('Your account changed. Please retry.');
  if (method === 'GET' && res.status === 404) return null;
  if (res.status === 401) throw new Error('Sign in again to check your trip.');
  if (res.status === 409) throw new Error('Your trip preferences changed. Please retry.');
  if (!res.ok) throw new Error('Trip checks are unavailable. Please retry later.');
  return res.json();
}

export async function checkTripReadiness(trip: Trip, signal: AbortSignal): Promise<DestinationCheck[]> {
  if (!__DEV__ && !API_BASE.startsWith('https://')) throw new Error('A secure connection is required.');
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort);
  if (signal.aborted) abort();
  const timer = setTimeout(abort, 120000);
  try {
    const path = '/v1/trips/' + encodeURIComponent(trip.id) + '/profile';
    const previous = await call<Saved>(path, 'GET', undefined, controller.signal);
    const saved = await call<Saved>(path, 'PUT', { expected_revision: previous?.revision ?? null, preferences: { ...previous?.preferences, start_date: trip.startDate, end_date: trip.endDate, currency: trip.currency, budget_minor: trip.budgetMinor, diets: trip.diet === 'none' ? [] : [trip.diet] } }, controller.signal);
    if (!saved) throw new Error('Could not save your trip preferences.');
    const stays = trip.stays?.length ? trip.stays : trip.destinationDetails ? [{ destination: trip.destinationDetails, days: trip.days.length }] : [];
    if (!stays.length) throw new Error('Choose a destination from search before checking your trip.');
    const dates = stayDates(trip.startDate, stays.map(s => s.days));
    const checks: DestinationCheck[] = [];
    for (const [i, stay] of stays.entries()) {
      const range = dates[i];
      const result: DestinationCheck = { destination: stay.destination.label, ...range };
      try {
        const matches = await searchDestinations(stay.destination.label, controller.signal);
        const place = matches.find(p => p.placeId === stay.destination.placeId);
        const base = { prompt: 'Review weather and entry preparation for this destination and these dates. Preserve all missing information and official source links.', destination: stay.destination.label, destination_country: stay.destination.countryCode, start_date: range.start, end_date: range.end, currency: trip.currency };
        const send = (specialist: string, request: unknown) => call<PlanningResponse>('/v1/trip-manager', 'POST', { profile: { trip_id: trip.id, revision: saved.revision }, specialist, request }, controller.signal);
        const results = await Promise.allSettled([
          place?.latitude != null && place.longitude != null ? send('weather', { ...base, origin: { latitude: place.latitude, longitude: place.longitude } }) : Promise.resolve(null),
          send('entry-guidance', base),
        ]);
        result.weather = results[0].status === 'fulfilled' ? results[0].value ?? undefined : undefined;
        result.entry = results[1].status === 'fulfilled' ? results[1].value ?? undefined : undefined;
        if (controller.signal.aborted) throw new Error('Trip check cancelled or timed out.');
        if (!result.weather || !result.entry) result.error = 'Some trip checks are unavailable. Nothing missing has been verified; please retry.';
        if ([result.weather, result.entry].some(value => value && value.profile_revision !== saved.revision)) throw new Error('Your trip preferences changed. Please retry.');
      } catch (error) {
        if (controller.signal.aborted) throw error;
        result.error = error instanceof Error ? error.message : 'Could not check this destination.';
      }
      checks.push(result);
    }
    return checks;
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
}
