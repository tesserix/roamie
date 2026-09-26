import { expect, test } from '@jest/globals';
import { albumHtml, itineraryHtml } from '../trip-exports';
import { createTrip, updateStop } from '../trips';
const trip = createTrip({ title: '<script>alert(1)</script>', destination: 'Kyoto & Osaka', startDate: '2026-09-11', endDate: '2026-09-12', currency: 'JPY', budgetMinor: 50000, travellers: 2, diet: 'vegan', interests: '' });
test('itinerary export escapes traveller text and includes daily timing and estimates', () => {
 const planned = updateStop(trip,0,{id:'a',time:'12:00',minutes:60,kind:'lunch',title:'Lunch & friends',note:'<img src=https://evil.test>',costMinor:1500,place:null,transport:[]});
 const html = itineraryHtml(planned);
 expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
 expect(html).not.toContain('<script>');
 expect(html).not.toContain('<img src=https://evil.test>');
 expect(html).toContain('12:00');expect(html).toContain('1,500');expect(html).toContain('Day 2');
});
test('album exports accept 1 and 15 photos, reject external image sources', () => {
 expect(albumHtml(trip,[{data:'YWJj',caption:'<b>memory</b>'}])).toContain('&lt;b&gt;memory&lt;/b&gt;');
 expect(albumHtml(trip,Array.from({length:15},()=>({data:'YWJj',caption:''}))).match(/<figure/g)).toHaveLength(15);
 expect(() => albumHtml(trip,[{data:'https://evil.test/photo',caption:''}])).toThrow();
 expect(() => albumHtml(trip,[])).toThrow();
});

test('unverified stop prices remain unknown in exports',()=>{
 const planned=updateStop(trip,0,{id:'unknown',time:'10:00',minutes:300,kind:'sight',title:'Museum',note:'Confirm hours',costMinor:0,costUnknown:true,place:null,transport:[]});
 const html=itineraryHtml(planned);
 expect(html).toContain('Cost not verified');
 expect(html).not.toContain('Est. ¥0');
});
