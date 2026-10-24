export function reminderTripTarget(data: unknown, accountId: string, trips: {id:string}[]): string | null {
  if (!data || typeof data !== 'object') return null;
  const value = data as Record<string, unknown>;
  return value.kind === 'trip-reminder' && value.accountId === accountId && typeof value.tripId === 'string' && trips.some(trip => trip.id === value.tripId) ? value.tripId : null;
}
export function reminderGroupTarget(data: unknown, accountId: string, groupIds: string[]): string | null {
  if (!data || typeof data !== 'object') return null;
  const value=data as Record<string,unknown>;
  return value.kind==='group-reminder' && value.accountId===accountId && typeof value.groupId==='string' && groupIds.includes(value.groupId) ? value.groupId : null;
}
