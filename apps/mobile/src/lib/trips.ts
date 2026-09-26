import type { Destination, PlanRequest, TripDay, TripStop, TravelMode } from './trip-contract';
import { FOOD_PREFERENCES, TRIP_STYLES } from './trip-contract';
export type { PlanRequest, TripDay, TripStop, TravelMode } from './trip-contract';
export type MemoryPhoto = { id: string; uri: string; width: number; height: number; caption: string; creationTime: number };
export type Trip = PlanRequest & { id: string; destinationDetails?: Destination; days: TripDay[]; photos: MemoryPhoto[]; notice: string; updatedAt: string };
export const tripStorageKey = (account: string) => `roamie.trips.v1.${encodeURIComponent(account)}`;
export const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

export function tripDates(start: string, end: string): string[] {
  const parse = (s: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('Use dates like 2026-09-11.');
    const t = Date.parse(`${s}T12:00:00Z`);
    if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== s) throw new Error('Choose a valid calendar date.');
    return t;
  };
  const from = parse(start), to = parse(end), count = Math.round((to - from) / 86400000) + 1;
  if (count < 1 || count > 14) throw new Error('Choose a trip of 1–14 days.');
  return Array.from({ length: count }, (_, i) => new Date(from + i * 86400000).toISOString().slice(0, 10));
}
export function stayDates(start: string, durations: number[]): { start: string; end: string }[] {
  tripDates(start, start);
  if (!durations.length || durations.length > 4 || durations.some(days => !Number.isInteger(days) || days < 1) || durations.reduce((sum, days) => sum + days, 0) > 14) throw new Error('Choose 1–14 days across up to 4 destinations.');
  let offset = 0;
  const date = (days: number) => new Date(Date.parse(start + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10);
  return durations.map(days => { const range = { start: date(offset), end: date(offset + days - 1) }; offset += days; return range; });
}
export const tripRoute = (trip: PlanRequest) => trip.stays?.map(stay => stay.destination.label).join(' → ') ?? trip.destination;
export function createTrip(request: PlanRequest): Trip {
  const p = request.preferences;
  if (p && (!Number.isInteger(p.adults) || p.adults < 1 || !Number.isInteger(p.children) || p.children < 0 || p.adults + p.children !== request.travellers || !Number.isInteger(p.luggage) || p.luggage < 0 || p.luggage > 24 || p.styles.length > TRIP_STYLES.length || p.foodPreferences.length > FOOD_PREFERENCES.length || p.styles.some(s => !(TRIP_STYLES as readonly string[]).includes(s)) || p.foodPreferences.some(s => !(FOOD_PREFERENCES as readonly string[]).includes(s)))) throw new Error('Check the adults, children, luggage and trip preferences.');
  const dates = tripDates(request.startDate, request.endDate);
  if (request.stays && (request.stays.length < 1 || request.stays.length > 4 || request.stays.some(stay => !Number.isInteger(stay.days) || stay.days < 1 || stay.days > 14 || !stay.destination.placeId || !stay.destination.label.trim() || stay.destination.label.length > 160 || !/^[A-Z]{2}$/.test(stay.destination.countryCode)) || request.stays.reduce((sum, stay) => sum + stay.days, 0) !== dates.length)) throw new Error('Destination durations must cover the trip: up to 4 destinations and 14 days total.');
  const destinations = request.stays?.flatMap(stay => Array<string>(stay.days).fill(stay.destination.label)) ?? dates.map(() => request.destination);
  const days = dates.map((date, i) => ({ date, destination: destinations[i], stops: [] }));
  if (!request.title.trim() || request.title.length > 120 || !request.destination.trim() || request.destination.length > 160 || !/^[A-Z]{3}$/.test(request.currency) || !Number.isSafeInteger(request.budgetMinor) || request.budgetMinor < 0 || request.budgetMinor > 1e9 || !Number.isInteger(request.travellers) || request.travellers < 1 || request.travellers > 12 || request.interests.length > 600) throw new Error('Check the trip name, destination, budget and travellers.');
  return { ...request, title: request.title.trim(), destination: request.destination.trim(), id: newId(), days, photos: [], notice: 'Your own plan. Add stops, or ask Roamie for a draft.', updatedAt: new Date().toISOString() };
}
function minute(time: string): number {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Use a time like 09:30.');
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
}
export function updateStop(trip: Trip, dayIndex: number, stop: TripStop): Trip {
  if (!trip.days[dayIndex]) throw new Error('Choose a trip day.');
  if (!stop.title.trim() || stop.title.length > 120 || stop.note.length > 500 || !Number.isInteger(stop.minutes) || stop.minutes < 15 || stop.minutes > 240 || !Number.isSafeInteger(stop.costMinor) || stop.costMinor < 0 || stop.costMinor > 1e9) throw new Error('Check the stop name, duration and estimated cost.');
  const stops = [...trip.days[dayIndex].stops.filter(s => s.id !== stop.id), stop].sort((a, b) => minute(a.time) - minute(b.time));
  if (stops.length > 12) throw new Error('Keep each day to 12 stops or fewer.');
  let end = 0;
  for (const s of stops) {
    const start = minute(s.time);
    if (start < end || start + s.minutes > 1440) throw new Error('These times overlap or run past midnight. Leave time to travel.');
    end = start + s.minutes;
  }
  return { ...trip, days: trip.days.map((d, i) => i === dayIndex ? { ...d, stops } : d), updatedAt: new Date().toISOString() };
}
export function validatePhotos(ids: string[]) {
  if (ids.length < 1 || ids.length > 15 || new Set(ids).size !== ids.length) throw new Error('Choose 1–15 different photos.');
}
export function selectMemories<T extends { id: string; creationTime: number; width: number; height: number }>(photos: T[], limit = 15): T[] {
  const unique = new Map<string, T>();
  const days = new Map<string, T[]>();
  for (const photo of photos) if (photo.width > 0 && photo.height > 0 && Number.isFinite(photo.creationTime)) unique.set(photo.id, photo);
  for (const photo of [...unique.values()].sort((a, b) => a.creationTime - b.creationTime)) {
    const key = new Date(photo.creationTime).toISOString().slice(0, 10);
    const group = days.get(key) ?? [];
    if (!group.some(p => Math.abs(p.creationTime - photo.creationTime) < 10000 && p.width === photo.width && p.height === photo.height)) group.push(photo);
    days.set(key, group);
  }
  const result: T[] = [];
  const cap = Math.min(15, Math.max(1, Math.trunc(limit)));
  while (result.length < cap) {
    let added = false;
    for (const group of days.values()) { const next = group.shift(); if (next && result.length < cap) { result.push(next); added = true; } }
    if (!added) break;
  }
  return result.sort((a, b) => a.creationTime - b.creationTime);
}
export const modeName: Record<TravelMode, string> = { taxi: 'Taxi', bicycle: 'Bike hire', rentalCar: 'Car hire', publicTransport: 'Public transport', walk: 'Walk' };
export const tripTotal = (trip: Trip) => trip.days.reduce((total, day) => total + day.stops.reduce((sum, stop) => sum + stop.costMinor, 0), 0);
