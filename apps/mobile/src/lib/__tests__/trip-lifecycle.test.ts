import { test, expect } from '@jest/globals';
import { tripPhase, groupTrips } from '../trip-lifecycle';
const now = new Date(2026, 10, 5, 12);
const trip = {id:'one',startDate:'2026-11-05',endDate:'2026-11-05'};
test('keeps the full final day current and archives after local midnight',()=>{
 expect(tripPhase(trip,now)).toBe('Current');
 expect(tripPhase(trip,new Date(2026,10,5,23,59))).toBe('Current');
 expect(tripPhase(trip,new Date(2026,10,6,0,0))).toBe('Past');
 expect(tripPhase(trip,new Date(2026,10,4,23,59))).toBe('Upcoming');
});
test('groups all trips without changing saved records and sorts future then recent history',()=>{
 const trips=[trip,{id:'future',startDate:'2026-11-08',endDate:'2026-11-09'},{id:'old',startDate:'2026-10-01',endDate:'2026-10-02'},{id:'recent',startDate:'2026-11-01',endDate:'2026-11-02'}];
 const before=JSON.stringify(trips);
 expect(groupTrips(trips,now).map(g=>[g.title,g.data.map(t=>t.id)])).toEqual([['Current',['one']],['Upcoming',['future']],['Past',['recent','old']]]);
 expect(JSON.stringify(trips)).toBe(before);
});
