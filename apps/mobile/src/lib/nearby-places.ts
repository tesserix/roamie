import type { Place } from './api';

export type NearbyFilters = {
  distanceM: number | null;
  openNow: boolean;
  minimumRating: number | null;
  maxPrice: number | null;
  sort: 'recommended' | 'distance' | 'rating';
};

export const DEFAULT_NEARBY_FILTERS: NearbyFilters = {
  distanceM: null, openNow: false, minimumRating: null, maxPrice: null, sort: 'recommended',
};

function searchText(text: string) {
  return text.normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase().trim();
}

export function selectNearbyPlaces(places: Place[], query: string, filters: NearbyFilters): Place[] {
  const search = searchText(query);
  const selected = places.filter(p =>
    searchText(`${p.name} ${p.address}`).includes(search)
    && (filters.distanceM === null || p.distanceM <= filters.distanceM)
    && (!filters.openNow || p.openNow === true)
    && (filters.minimumRating === null || (p.rating !== null && p.rating >= filters.minimumRating))
    && (filters.maxPrice === null || (p.priceLevel != null && p.priceLevel <= filters.maxPrice)),
  );
  if (filters.sort === 'distance') selected.sort((a, b) => a.distanceM - b.distanceM);
  if (filters.sort === 'rating') selected.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || a.distanceM - b.distanceM);
  return selected;
}

export function directionsUrl(place: Place, provider: 'google' | 'apple'): string {
  const coordinates = typeof place.lat === 'number' && Number.isFinite(place.lat) && Math.abs(place.lat) <= 90
    && typeof place.lng === 'number' && Number.isFinite(place.lng) && Math.abs(place.lng) <= 180;
  const destination = encodeURIComponent(coordinates ? `${place.lat},${place.lng}` : [place.name, place.address].filter(Boolean).join(', '));
  if (provider === 'apple') return `https://maps.apple.com/?daddr=${destination}&dirflg=w&q=${encodeURIComponent(place.name)}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${destination}&destination_place_id=${encodeURIComponent(place.id)}&travelmode=walking`;
}
