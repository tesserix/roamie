import { expect, test } from '@jest/globals';
import { tripDates, createTrip, updateStop, selectMemories, validatePhotos } from '../trips';
test('date-only ranges handle leap years and reject invalid/reversed dates', () => {
  expect(tripDates('2028-02-28', '2028-03-01')).toEqual(['2028-02-28','2028-02-29','2028-03-01']);
  expect(() => tripDates('2026-02-30','2026-03-02')).toThrow();
  expect(() => tripDates('2026-09-20','2026-09-11')).toThrow();
});
test('overlapping stops never replace the existing saved plan', () => {
 const trip = createTrip({title:'Japan',destination:'Tokyo',startDate:'2026-09-11',endDate:'2026-09-11',currency:'JPY',budgetMinor:10000,diet:'none',interests:'',travellers:1});
 const next = updateStop(trip,0,{id:'a',time:'12:00',minutes:60,kind:'lunch',title:'Lunch',note:'',costMinor:1000,place:null,transport:[]});
 expect(() => updateStop(next,0,{...next.days[0].stops[0],id:'b',time:'12:30'})).toThrow(/overlap/i);
 expect(next.days[0].stops).toHaveLength(1);
});
test('photo selection enforces 1–15 unique photos', () => {
 expect(() => validatePhotos([])).toThrow();
 expect(() => validatePhotos(['a'])).not.toThrow();
 expect(() => validatePhotos(Array.from({length:15},(_,i)=>`${i}`))).not.toThrow();
 expect(() => validatePhotos(Array.from({length:16},(_,i)=>`${i}`))).toThrow();
 expect(() => validatePhotos(['a','a'])).toThrow();
});
test('automatic selection spreads photos across trip days', () => {
 const input=Array.from({length:30},(_,i)=>({id:`${i}`,uri:`photo:${i}`,creationTime:Date.UTC(2026,8,11+i%3,12,i),width:1200,height:900}));
 const selected=selectMemories([...input,input[0]],15);
 expect(selected).toHaveLength(15);
 expect(new Set(selected.map(p=>p.id)).size).toBe(15);
 expect(new Set(selected.map(p=>new Date(p.creationTime).getUTCDate())).size).toBe(3);
});
test('automatic selection cannot exceed 15 even when a caller asks for more', () => {
 const input=Array.from({length:30},(_,i)=>({id:`${i}`,creationTime:Date.UTC(2026,8,i+1,12),width:100,height:100}));
 expect(selectMemories(input,99)).toHaveLength(15);
});
test('assigns every trip day to its destination and rejects inconsistent durations', () => {
  const destination = (name: string) => ({ placeId:name, name, label:name+', Japan', countryCode:'JP', country:'Japan' });
  const request = { title:"Japan",destination:"Tokyo",currency:"JPY",budgetMinor:10000,diet:"none",interests:"",travellers:1, startDate:'2026-10-01', endDate:'2026-10-05', stays:[{destination:destination('Tokyo'),days:3},{destination:destination('Kyoto'),days:2}] };
  const trip = createTrip(request);
  expect(trip.days.map(day => day.destination)).toEqual(['Tokyo, Japan','Tokyo, Japan','Tokyo, Japan','Kyoto, Japan','Kyoto, Japan']);
  expect(() => createTrip({...request,endDate:'2026-10-06'})).toThrow('durations');
});
