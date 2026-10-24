export type TripPhase = 'Current' | 'Upcoming' | 'Past';
type DatedTrip = { startDate: string; endDate: string };
export function tripPhase(trip: DatedTrip, now = new Date()): TripPhase {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return trip.endDate < today ? 'Past' : trip.startDate > today ? 'Upcoming' : 'Current';
}
export function groupTrips<T extends DatedTrip>(trips: T[], now = new Date()): {title: TripPhase; data: T[]}[] {
  return (['Current', 'Upcoming', 'Past'] as const).map(title => ({title, data: trips.filter(trip => tripPhase(trip, now) === title).sort((a, b) => title === 'Past' ? b.endDate.localeCompare(a.endDate) : a.startDate.localeCompare(b.startDate))}));
}
