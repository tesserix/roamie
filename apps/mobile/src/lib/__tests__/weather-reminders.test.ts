import {expect,test} from '@jest/globals';
import {weatherNotices, weatherReminders} from '../weather-reminders';
import type {DestinationCheck} from '../trip-readiness';
const now=new Date(2026,10,5,6);
const trip={id:'trip',title:'Kyoto',startDate:'2026-11-05',endDate:'2026-11-08',destination:'Kyoto'};
const checks:DestinationCheck[]=[{destination:'Kyoto',start:'2026-11-05',end:'2026-11-08',weather:{profile_revision:'r',response:{status:'ok',limitations:[],recommendations:[{id:'forecast',name:'Day forecast',source_url:'https://open-meteo.com/',observed_at:now.toISOString(),weather:{coverage:'forecast',local_date:'2026-11-05',minimum_celsius:12,maximum_celsius:20,precipitation_percent:70,missing_dates:[],suggestions:[]}}]}}}];
test('uses attributed measurements and includes freshness in the notification',()=>{
 const notices=weatherNotices(trip,checks,now);
 const plans=weatherReminders(trip,notices,now);
 expect(plans).toHaveLength(1);
 expect(plans[0].body).toContain('12–20°C');
 expect(plans[0].body).toContain('70%');
 expect(plans[0].body).toContain('Open-Meteo');
 expect(plans[0].body).toContain('Checked');
 expect(plans[0].date.getHours()).toBe(7);
 expect(plans[0].date.getMinutes()).toBe(30);
});
test('rejects old forecasts, unknown providers, changed trips and incomplete measurements',()=>{
 const notices=weatherNotices(trip,checks,now);
 expect(weatherReminders({...trip,destination:'Tokyo'},notices,now)).toEqual([]);
 expect(weatherReminders(trip,notices,new Date(2026,10,6,8))).toEqual([]);
 const copy=JSON.parse(JSON.stringify(checks));
 copy[0].weather.response.recommendations[0].source_url='https://untrusted.test';
 expect(weatherNotices(trip,copy,now)).toEqual([]);
 copy[0].weather.response.recommendations[0].source_url='https://open-meteo.com';
 copy[0].weather.response.recommendations[0].weather.minimum_celsius=null;
 expect(weatherNotices(trip,copy,now)).toEqual([]);
});
test('a weather check after morning delivery schedules once soon, never a fabricated future forecast',()=>{
 const later=new Date(2026,10,5,12);
 const notices=weatherNotices(trip,checks,later);
 expect(weatherReminders(trip,notices,later)[0].date.getTime()).toBe(later.getTime()+60000);
 expect(weatherReminders(trip,notices,new Date(later.getTime()+120000))).toEqual([]);
});
