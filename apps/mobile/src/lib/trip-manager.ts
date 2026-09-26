import { apiRequest, ApiError } from './trip-api';
import { tripDates, type Trip } from './trips';
import type { TripOption } from './planning-contract';
export type { TripOption } from './planning-contract';

export const SPECIALISTS = { 'trip-planner': 'Trip planning', food: 'Food', routes: 'Routes', activities: 'Activities', shopping: 'Shopping', 'currency-exchange': 'Currency exchange', memories: 'Memories' } as const;
export type Specialist = keyof typeof SPECIALISTS;
export type TravelPreferences = {
  allergies: string[]; diets: string[]; budget_minor: number | null; currency: string;
  accessibility_requirements: string[]; preferences: string[]; language: string;
  start_date: string | null; end_date: string | null; photo_consent: boolean; selected_photo_ids: string[];
};
export type SavedTravelProfile = { trip_id: string; revision: string; preferences: TravelPreferences };
export type ManagerRequest = { prompt: string; plan_options?:boolean; stays?:{destination:string;days:number}[]; travellers?:number; origin?: {latitude:number;longitude:number}; destination?:string; exchange_amount_minor?:number; exchange_destination_currency?:string };
export type Advice = {
  manager_id: string; profile_revision: string; review_run_ids: [string,string];
  response: { trip_options?: TripOption[]; status: 'ok' | 'unavailable' | 'no_matches'; specialist: Specialist; limitations: string[];
    recommendations: {id:string;name:string;source_url:string;observed_at:string;maps_url:string|null;cost_minor:number|null;currency:string|null;duration_seconds:number|null;warnings:string[]}[];
  };
};
export function initialPreferences(trip: Trip, language: string): TravelPreferences {
  return { allergies: [], diets: [...new Set([...(trip.diet === 'none' ? [] : [trip.diet]), ...(trip.preferences?.foodPreferences ?? [])])], budget_minor: trip.budgetMinor || null, currency: trip.currency,
    accessibility_requirements: trip.preferences?.styles.includes('Step-free') ? ['Step-free'] : [],
    preferences: [`Party: ${trip.travellers} travellers; ${trip.preferences?.adults ?? trip.travellers} adults; children ${trip.preferences?.children ?? 0}; luggage ${trip.preferences?.luggage ?? 0}`, ...(trip.preferences?.styles ?? []), ...(trip.preferences?.foodPreferences ?? []), ...trip.interests.split(',').map(s => s.trim()).filter(Boolean)].slice(0,20),
    language, start_date: trip.startDate, end_date: trip.endDate, photo_consent: false, selected_photo_ids: [] };
}
export async function loadTravelProfile(tripId: string, signal?: AbortSignal): Promise<SavedTravelProfile | null> {
  try { return await apiRequest(`/v1/trips/${encodeURIComponent(tripId)}/profile`, undefined, res => res.json(), 12000, signal, 'GET'); }
  catch (error) { if (error instanceof ApiError && error.status === 409 && error.code === 'profile_changed') return null; throw error; }
}
export const saveTravelProfile = (tripId:string, preferences:TravelPreferences, revision:string|null, signal?:AbortSignal):Promise<SavedTravelProfile> =>
  apiRequest(`/v1/trips/${encodeURIComponent(tripId)}/profile`, {expected_revision:revision,preferences}, res => res.json(), 12000, signal, 'PUT');
export async function askTripManager(profile:SavedTravelProfile, specialist:Specialist, request:ManagerRequest, signal?:AbortSignal):Promise<Advice> {
  const result = await apiRequest<Advice>('/v1/trip-manager', {profile:{trip_id:profile.trip_id,revision:profile.revision},specialist,request}, res => res.json(), 160000, signal);
  if (result.profile_revision !== profile.revision) throw new Error('Your preferences changed. Reload them and try again.');
  if (!result.manager_id?.startsWith('trip-manager-') || !Array.isArray(result.review_run_ids) || result.review_run_ids.length !== 2 || result.review_run_ids.some(id => !id) || result.review_run_ids[0] === result.review_run_ids[1]) throw new Error('The manager review could not be verified. Please try again.');
  if (!result.response || result.response.specialist !== specialist || !['ok','unavailable','no_matches'].includes(result.response.status) || !Array.isArray(result.response.recommendations) || !Array.isArray(result.response.limitations)) throw new Error('The manager response was not valid. Please try again.');
  if (request.plan_options) {
    validatePlanOptions(result.response.trip_options, profile, result.response.recommendations.map(item => item.id));
    const destinations = request.stays?.flatMap(stay=>Array(stay.days).fill(stay.destination));
    if (destinations && result.response.trip_options?.some(option=>option.days.map(day=>day.destination).join('\n')!==destinations.join('\n'))) throw new Error('The itinerary does not match your chosen destinations.');
  }
  return result;
}

export function planTotal(option: TripOption): number {
  return Object.values(option.budget).reduce((total, amount) => total + amount, 0);
}
export function validatePlanOptions(options: TripOption[] | undefined, profile: SavedTravelProfile, evidenceIds: string[]): asserts options is TripOption[] {
  if (!options || options.length !== 3 || options.map(option => option.tier).join(',') !== 'budget,balanced,premium') throw new Error('Roamie could not validate three distinct plans. Please try again.');
  const dates = tripDates(profile.preferences.start_date ?? '',profile.preferences.end_date ?? '');
  let previous = -1;
  for (const option of options) {
    const values = ['accommodation_minor','food_minor','activities_minor','transport_minor','contingency_minor'].map(key => option.budget?.[key as keyof typeof option.budget]);
    if (values.some(value => !Number.isSafeInteger(value) || value < 0)) throw new Error('The plan budget is invalid.');
    const total = values.reduce((sum, value) => sum + value, 0);
    if (total <= previous || (profile.preferences.budget_minor !== null && total > profile.preferences.budget_minor)) throw new Error('The plans exceed your budget or have invalid totals.');
    previous = total;
    if (option.days.map(day => day.date).join(',') !== dates.join(',')) throw new Error('The plan dates do not match your preferences.');
    if (option.accommodation_ids?.some(id => !evidenceIds.includes(id))) throw new Error('The accommodation could not be verified.');
    for (const day of option.days) {
      if (!day.stops.length || day.stops.length > 6) throw new Error('The daily plan is invalid.');
      let finish = 0;
      for (const stop of day.stops) {
        const begin = Number(stop.time?.slice(0,2))*60 + Number(stop.time?.slice(3));
        if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(stop.time) || !Number.isInteger(stop.minutes) || stop.minutes < 15 || stop.minutes > 480 || begin < finish || begin + stop.minutes > 1440 || !evidenceIds.includes(stop.evidence_id)) throw new Error('The itinerary could not be verified.');
        finish = begin + stop.minutes + 15;
      }
    }
  }
}

export type ChosenPlan = { option:TripOption; advice:Advice; currency:string; profileRevision:string };

export function restoreChosenPlan(value: unknown, trip: Trip): ChosenPlan | undefined {
  try {
    const plan = value as ChosenPlan;
    if (!plan || !/^[A-Z]{3}$/.test(plan.currency) || typeof plan.profileRevision !== 'string' || plan.advice.profile_revision !== plan.profileRevision || !plan.advice.manager_id?.startsWith('trip-manager-') || plan.advice.review_run_ids.length !== 2 || plan.advice.review_run_ids[0] === plan.advice.review_run_ids[1]) return undefined;
    const profile = {trip_id:trip.id,revision:plan.profileRevision,preferences:{...initialPreferences(trip,'en'),currency:plan.currency,budget_minor:null}};
    for (const item of plan.advice.response.recommendations) {
      if (typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.source_url !== 'string') return undefined;
    }
    validatePlanOptions(plan.advice.response.trip_options,profile,plan.advice.response.recommendations.map(item=>item.id));
    for (const option of plan.advice.response.trip_options) {
      if ([option.label,option.summary,option.accommodation_guidance,option.transport_guidance].some(text=>typeof text !== 'string')) return undefined;
      if (option.days.some(day=>typeof day.destination !== 'string' || day.stops.some(stop=>typeof stop.note !== 'string'))) return undefined;
    }
    const chosen = plan.advice.response.trip_options.find(option=>option.tier===plan.option.tier);
    return chosen && JSON.stringify(chosen)===JSON.stringify(plan.option) ? plan : undefined;
  } catch {return undefined;}
}
