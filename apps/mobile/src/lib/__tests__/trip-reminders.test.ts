import { test, expect } from '@jest/globals';
import { buildTripReminders } from '../trip-reminders';
const trip = { id: 'trip-1', title: 'India holiday', startDate: '2026-11-05', endDate: '2026-11-10' };
const enabled = { start: true, packing: true };
const now = new Date(2026, 10, 1, 12);
test('plans start morning and packing on the previous evening in phone time', () => {
  const plans = buildTripReminders([trip], enabled, now);
  expect(plans.map(p => [p.kind, p.date.getFullYear(), p.date.getMonth(), p.date.getDate(), p.date.getHours()])).toEqual([
    ['start', 2026, 10, 5, 8], ['packing', 2026, 10, 9, 18],
  ]);
  expect(plans[1].body).toContain('passport');
});
test('skips disabled and past notices without replaying them on reopen', () => {
  expect(buildTripReminders([trip], { start: false, packing: false }, now)).toEqual([]);
  expect(buildTripReminders([trip], enabled, new Date(2026, 10, 6))).toEqual([expect.objectContaining({kind: 'packing'})]);
  expect(buildTripReminders([trip], enabled, new Date(2026, 10, 11))).toEqual([]);
});
test('ignores invalid dates and deduplicates trip identifiers', () => {
  expect(buildTripReminders([{...trip,startDate:'2026-02-30',endDate:'bad'}], enabled, now)).toEqual([]);
  expect(buildTripReminders([trip, trip], enabled, now)).toHaveLength(2);
});
test('limits earliest notifications to leave room under the OS pending cap', () => {
  const plans = buildTripReminders(Array.from({length:30}, (_, i)=>({...trip,id:String(i)})), enabled, now);
  expect(plans).toHaveLength(40);
  expect(plans[0].date.getTime()).toBeLessThanOrEqual(plans[39].date.getTime());
});
test('handles month boundaries and single-day trips without UTC date drift', () => {
  const plans=buildTripReminders([{...trip,startDate:'2026-12-01',endDate:'2026-12-01'}],enabled,now);
  expect(plans.map(p=>[p.kind,p.date.getMonth(),p.date.getDate(),p.date.getHours()])).toEqual([
    ['packing',10,30,18],['start',11,1,8],
  ]);
});
test('optional preparation, daily agenda and return review cover the trip lifecycle',()=>{
 const journey={...trip,days:[{date:'2026-11-05',stops:[{time:'10:00',title:'Museum'}]},{date:'2026-11-06',stops:[]}]};
 const plans=buildTripReminders([journey],{...enabled,preparation:true,agenda:true,complete:true},now);
 expect(plans.map(p=>p.kind)).toEqual(['preparation','agenda','start','packing','complete']);
 expect(plans.find(p=>p.kind==='agenda')?.body).toContain('10:00 · Museum');
 expect(plans.find(p=>p.kind==='preparation')?.body).toContain('offline languages');
 expect(plans.find(p=>p.kind==='complete')?.date.getDate()).toBe(11);
});
test('reminds 30 minutes before each planned visit and skips malformed or past times',()=>{
 const journey={...trip,days:[{date:'2026-11-05',stops:[{time:'10:00',title:'Museum'},{time:'15:30',title:'Gardens'},{time:'bad',title:'Invalid'}]}]};
 const plans=buildTripReminders([journey],{start:false,packing:false,visits:true},now);
 expect(plans.map(p=>[p.kind,p.date.getHours(),p.date.getMinutes()])).toEqual([['visits',9,30],['visits',15,0]]);
 expect(plans[0].body).toContain('Museum at 10:00');
 expect(buildTripReminders([journey],{start:false,packing:false,visits:true},new Date(2026,10,5,11))).toHaveLength(1);
});
