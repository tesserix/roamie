import type { DestinationCheck } from './trip-readiness';
import type { TripReminder } from './trip-reminders';

type WeatherTrip = {id:string;title:string;startDate:string;endDate:string;destination:string;stays?:unknown};
export type WeatherNotice = {profile:string; observedAt:string; deliverAt:string; date:string; body:string};
const profile = (trip: WeatherTrip) => JSON.stringify([trip.id,trip.startDate,trip.endDate,trip.destination,trip.stays]);
const DAY = 86400000;
function provider(source:string): string | null {
  try {
    const url=new URL(source);
    if(url.protocol!=='https:') return null;
    return ({'open-meteo.com':'Open-Meteo','api.met.no':'MET Norway','www.met.no':'MET Norway','developers.google.com':'Google Weather'} as Record<string,string>)[url.hostname] ?? null;
  } catch {return null;}
}
export function weatherNotices(trip:WeatherTrip,checks:DestinationCheck[],now:Date):WeatherNotice[] {
  const result=new Map<string,WeatherNotice>();
  for(const check of checks) {
    if(check.weather?.response.status!=='ok') continue;
    for(const fact of check.weather.response.recommendations) {
      const weather=fact.weather, source=provider(fact.source_url), observed=Date.parse(fact.observed_at), date=weather?.local_date;
      if(!weather || !source || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date<trip.startDate || date>trip.endDate || date<check.start || date>check.end || weather.missing_dates.includes(date)) continue;
      const [year,month,day]=date.split('-').map(Number), at=new Date(year,month-1,day,7,30);
      if(at.getFullYear()!==year || at.getMonth()!==month-1 || at.getDate()!==day) continue;
      const today=new Date(now);today.setHours(0,0,0,0);
      if(at<today) continue;
      if(at<=now) at.setTime(now.getTime()+60000);
      if(!Number.isFinite(observed) || observed>now.getTime()+300000 || at.getTime()-observed>DAY) continue;
      const low=weather.minimum_celsius,high=weather.maximum_celsius,rain=weather.precipitation_percent;
      if(typeof low!=='number'||typeof high!=='number'||!Number.isFinite(low)||!Number.isFinite(high)||low>high||low< -100||high>70||typeof rain!=='number'||!Number.isFinite(rain)||rain<0||rain>100) continue;
      result.set(date,{profile:profile(trip),observedAt:fact.observed_at,deliverAt:at.toISOString(),date,body:`${check.destination.slice(0,100)}: ${low}–${high}°C, rain chance ${rain}%. ${source}. Checked ${new Date(observed).toLocaleString()}. Forecasts can change.`});
    }
  }
  return [...result.values()].slice(0,14);
}
export function weatherReminders(trip:WeatherTrip,notices:WeatherNotice[],now:Date):TripReminder[] {
  if(!Array.isArray(notices)) return [];
  return notices.slice(0,14).flatMap(notice=>{
    if(!notice || notice.profile!==profile(trip) || typeof notice.body!=='string' || notice.body.length>500) return [];
    const observed=Date.parse(notice.observedAt),deliver=Date.parse(notice.deliverAt);
    if(!Number.isFinite(observed)||!Number.isFinite(deliver)||deliver<=now.getTime()||observed>now.getTime()+300000||deliver-observed>DAY||now.getTime()-observed>DAY) return [];
    return [{tripId:trip.id,kind:'weather',title:`Forecast · ${trip.title.slice(0,100)}`,body:notice.body,date:new Date(deliver)}];
  });
}
