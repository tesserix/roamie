import { expect, test } from '@jest/globals';

import type { Place } from '../api';
import { selectNearbyPlaces, DEFAULT_NEARBY_FILTERS, directionsUrl } from '../nearby-places';

const places: Place[] = [
  { id: 'cafe', name: 'Café Lotus', address: 'Old Quarter', mapsUri: '', distanceM: 300, rating: 4.2, openNow: true, why: '' },
  { id: 'tea', name: 'Tea House', address: 'Hàng Bạc, Hanoi', mapsUri: '', distanceM: 100, rating: null, openNow: null, why: '' },
];

test('searches nearby names and addresses without case or accent barriers', () => {
  expect(selectNearbyPlaces(places, '  CAFE  ', DEFAULT_NEARBY_FILTERS).map(p => p.id)).toEqual(['cafe']);
  expect(selectNearbyPlaces(places, 'HANG BAC', DEFAULT_NEARBY_FILTERS).map(p => p.id)).toEqual(['tea']);
  expect(selectNearbyPlaces(places, '', DEFAULT_NEARBY_FILTERS)).toEqual(places);
  expect(selectNearbyPlaces(places, 'station', DEFAULT_NEARBY_FILTERS)).toEqual([]);
});

test('combines distance, confirmed hours, rating and price without treating missing facts as matches', () => {
  const candidates = [
    { ...places[0], id: 'match', distanceM: 500, rating: 4, priceLevel: 2 },
    { ...places[0], id: 'far', distanceM: 501, rating: 4, priceLevel: 1 },
    { ...places[0], id: 'unknown-hours', openNow: null, priceLevel: 1 },
    { ...places[0], id: 'closed', openNow: false, priceLevel: 1 },
    { ...places[0], id: 'unknown-rating', rating: null, priceLevel: 1 },
    { ...places[0], id: 'unknown-price' },
    { ...places[0], id: 'expensive', priceLevel: 3 },
    { ...places[0], id: 'free', priceLevel: 0 },
  ];
  const filters = { ...DEFAULT_NEARBY_FILTERS, distanceM: 500, minimumRating: 4, maxPrice: 2, openNow: true };
  expect(selectNearbyPlaces(candidates, '', filters).map(p => p.id)).toEqual(['match', 'free']);
  expect(selectNearbyPlaces([], '', filters)).toEqual([]);
  expect(selectNearbyPlaces(candidates, '', DEFAULT_NEARBY_FILTERS)).toEqual(candidates);
});

test('sorts by nearest or top rated with unknown ratings last and leaves provider order untouched', () => {
  const candidates = [
    { ...places[0], id: 'far-best', rating: 4.8, distanceM: 900 },
    { ...places[0], id: 'near-best', rating: 4.8, distanceM: 400 },
    { ...places[1], id: 'unknown', distanceM: 50 },
    { ...places[0], id: 'zero-distance', rating: 4.2, distanceM: 0 },
  ];
  expect(selectNearbyPlaces(candidates, '', { ...DEFAULT_NEARBY_FILTERS, sort: 'distance' }).map(p => p.id))
    .toEqual(['zero-distance', 'unknown', 'near-best', 'far-best']);
  expect(selectNearbyPlaces(candidates, '', { ...DEFAULT_NEARBY_FILTERS, sort: 'rating' }).map(p => p.id))
    .toEqual(['near-best', 'far-best', 'zero-distance', 'unknown']);
  expect(candidates.map(p => p.id)).toEqual(['far-best', 'near-best', 'unknown', 'zero-distance']);
});

test('builds encoded walking directions for either map provider using the venue coordinates, not the traveller location', () => {
  const venue = { ...places[0], id: 'venue/id', lat: 0, lng: 105.85, name: 'Café & Tea' };
  const google = new URL(directionsUrl(venue, 'google'));
  expect(google.origin + google.pathname).toBe('https://www.google.com/maps/dir/');
  expect(google.searchParams.get('api')).toBe('1');
  expect(google.searchParams.get('destination')).toBe('0,105.85');
  expect(google.searchParams.get('destination_place_id')).toBe('venue/id');
  expect(google.searchParams.get('travelmode')).toBe('walking');
  expect(google.searchParams.has('origin')).toBe(false);
  const apple = new URL(directionsUrl(venue, 'apple'));
  expect(apple.origin).toBe('https://maps.apple.com');
  expect(apple.searchParams.get('daddr')).toBe('0,105.85');
  expect(apple.searchParams.get('dirflg')).toBe('w');
  expect(apple.searchParams.get('q')).toBe('Café & Tea');
  const withoutCoordinates = new URL(directionsUrl({ ...venue, lat: NaN }, 'apple'));
  expect(withoutCoordinates.searchParams.get('daddr')).toBe('Café & Tea, Old Quarter');
});
