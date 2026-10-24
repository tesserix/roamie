export type ReminderPreferences = { start: boolean; packing: boolean; preparation?: boolean; agenda?: boolean; complete?: boolean; visits?: boolean; weather?: boolean; balances?: boolean };
export type ReminderTrip = { id: string; title: string; startDate: string; endDate: string; days?: {date: string; stops: {time: string; title: string}[]}[] };
export type TripReminder = { tripId: string; groupId?: string; kind: keyof ReminderPreferences; title: string; body: string; date: Date };
export const DEFAULT_REMINDERS: ReminderPreferences = { start: false, packing: false, preparation: false, agenda: false, complete: false, visits: false, weather: false, balances: false };

function localDate(value: string, hour: number): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day, hour);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

export function buildTripReminders(trips: ReminderTrip[], preferences: ReminderPreferences, now: Date): TripReminder[] {
  const reminders: TripReminder[] = [];
  for (const trip of new Map(trips.map(trip => [trip.id, trip])).values()) {
    const start = localDate(trip.startDate, 8), end = localDate(trip.endDate, 18);
    if (!start || !end || end < start) continue;
    const title = trip.title.slice(0, 120);
    if (preferences.start && start > now) reminders.push({ tripId: trip.id, kind: 'start', title: 'Your trip starts today', body: `${title}: check your itinerary, tickets and travel essentials.`, date: start });
    if (preferences.preparation) {
      const before = new Date(start); before.setDate(before.getDate() - 1); before.setHours(18);
      if (before > now) reminders.push({tripId:trip.id,kind:'preparation',title:'Ready for tomorrow’s trip?',body:`${title}: check tickets and travel documents, pack essentials and download offline languages.`,date:before});
    }
    if (preferences.agenda) for (const day of trip.days ?? []) {
      const date = localDate(day.date, 7);
      const first = [...day.stops].sort((a,b)=>a.time.localeCompare(b.time))[0];
      if (date && date > now && day.date >= trip.startDate && day.date <= trip.endDate && first) reminders.push({tripId:trip.id,kind:'agenda',title:'Your day ahead',body:`${title}: ${first.time} · ${first.title.slice(0,120)}. Open your itinerary for the day’s plan.`,date});
    }
    if (preferences.visits) for (const day of trip.days ?? []) {
      if (day.date < trip.startDate || day.date > trip.endDate) continue;
      for (const stop of day.stops) {
        if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(stop.time)) continue;
        const date = localDate(day.date, Number(stop.time.slice(0,2)));
        if (!date) continue;
        date.setMinutes(Number(stop.time.slice(3)) - 30);
        if (date > now) reminders.push({tripId:trip.id,kind:'visits',title:'Your next planned visit',body:`${stop.title.slice(0,120)} at ${stop.time} · ${title}. Check your route and allow travel time.`,date});
      }
    }
    if (preferences.complete) {
      const after = new Date(end); after.setDate(after.getDate() + 1); after.setHours(9);
      if (after > now) reminders.push({tripId:trip.id,kind:'complete',title:'Your trip is now in Past trips',body:`${title}: review shared expenses, settle any remaining balances and save your favourite memories.`,date:after});
    }
    end.setDate(end.getDate() - 1);
    if (preferences.packing && end > now) reminders.push({ tripId: trip.id, kind: 'packing', title: 'Time to pack for your return', body: `${title} ends tomorrow. Check your passport, chargers, medicines and belongings before leaving.`, date: end });
  }
  return reminders.sort((a, b) => a.date.getTime() - b.date.getTime() || a.tripId.localeCompare(b.tripId)).slice(0, 40);
}
