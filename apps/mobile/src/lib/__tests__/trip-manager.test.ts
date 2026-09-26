import { beforeEach, expect, jest, test } from '@jest/globals';
import { fetch } from 'expo/fetch';
import { session } from '../auth-client';
import { loadTravelProfile, saveTravelProfile, askTripManager, initialPreferences } from '../trip-manager';
import { createTrip } from '../trips';
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('../auth-client', () => ({ API_BASE: 'https://roamie-api.tesserix.app', session: {current: jest.fn(() => ({sub:'alice'})), accessToken: jest.fn(async () => 'test-token'), clear: jest.fn(async () => {})} }));
const trip = createTrip({title:'Sydney',destination:'Sydney',startDate:'2026-10-01',endDate:'2026-10-02',currency:'AUD',budgetMinor:0,diet:'vegan',interests:'Gardens',travellers:1});
const saved = {trip_id:trip.id,revision:'r1',preferences:initialPreferences(trip,'en')};
const reply = {manager_id:'trip-manager-test',profile_revision:'r1',review_run_ids:['pre','post'],response:{status:'no_matches',specialist:'food',recommendations:[],limitations:['No verified matches'],exchange_comparisons:[]}};
const respond = (data: unknown, status = 200) => jest.mocked(fetch).mockResolvedValueOnce({ok:status < 400,status,json:async () => data} as Awaited<ReturnType<typeof fetch>>);
beforeEach(() => { jest.clearAllMocks(); jest.mocked(session.current).mockReturnValue({sub:'alice'} as ReturnType<typeof session.current>); });
test('loads and saves the customer profile with optimistic revision protection', async () => {
 respond(saved); expect(await loadTravelProfile(trip.id)).toEqual(saved);
 expect(jest.mocked(fetch).mock.calls[0][1]).toMatchObject({method:'GET',headers:{Authorization:'Bearer test-token'}});
 respond(saved); await saveTravelProfile(trip.id,saved.preferences,'r1');
 expect(JSON.parse(String(jest.mocked(fetch).mock.calls[1][1]?.body))).toEqual({expected_revision:'r1',preferences:saved.preferences});
 expect(saved.preferences.budget_minor).toBeNull();
});
test('sends only the saved profile reference and request through the API', async () => {
 respond(reply); expect((await askTripManager(saved,'food',{prompt:'Lunch'})).response.status).toBe('no_matches');
 expect(jest.mocked(fetch).mock.calls[0][0]).toBe('https://roamie-api.tesserix.app/v1/trip-manager');
 expect(JSON.parse(String(jest.mocked(fetch).mock.calls[0][1]?.body))).toEqual({profile:{trip_id:trip.id,revision:'r1'},specialist:'food',request:{prompt:'Lunch'}});
});
test('rejects stale or unreviewed results', async () => {
 respond({...reply,profile_revision:'r0'}); await expect(askTripManager(saved,'food',{prompt:'Lunch'})).rejects.toThrow('preferences');
 respond({...reply,review_run_ids:['pre','pre']}); await expect(askTripManager(saved,'food',{prompt:'Lunch'})).rejects.toThrow('review');
});
test('does not turn an unavailable profile service into an empty profile', async () => {
 respond({error:'unavailable',message:'Profile storage is unavailable'},503);
 await expect(loadTravelProfile(trip.id)).rejects.toThrow('Profile storage');
 respond({error:'profile_changed'},409); expect(await loadTravelProfile(trip.id)).toBeNull();
});
test('stops requests if the account changes during token refresh', async () => {
 jest.mocked(session.accessToken).mockImplementationOnce(async () => { jest.mocked(session.current).mockReturnValue({sub:'bob'} as ReturnType<typeof session.current>); return 'new-token'; });
 await expect(saveTravelProfile(trip.id,saved.preferences,null)).rejects.toThrow('account changed');
 expect(fetch).not.toHaveBeenCalled();
});
test('discards a result when the account changes while the request is running', async () => {
 jest.mocked(fetch).mockImplementationOnce(async () => { jest.mocked(session.current).mockReturnValue({sub:'bob'} as ReturnType<typeof session.current>); return {ok:true,status:200,json:async () => reply} as Awaited<ReturnType<typeof fetch>>; });
 await expect(askTripManager(saved,'food',{prompt:'Lunch'})).rejects.toThrow('account changed');
});

test('rejects incomplete trip comparisons instead of offering duplicate tiers', async () => {
 respond({...reply,response:{...reply.response,specialist:'trip-planner',status:'ok',trip_options:[]}});
 await expect(askTripManager(saved,'trip-planner',{prompt:'Three plans',plan_options:true})).rejects.toThrow('three');
});
