import {beforeEach, afterEach, expect, jest, test} from '@jest/globals';
import {fetch} from 'expo/fetch';
import {initialPreferences} from '../trip-manager';
import {createTrip} from '../trips';
import {startPlanning, resumePlanning} from '../planning-jobs';

jest.mock('expo/fetch',()=>({fetch:jest.fn()}));
jest.mock('../auth-client',()=>({API_BASE:'https://roamie-api.tesserix.app',session:{current:()=>({sub:'alice'}),accessToken:async()=> 'token',clear:jest.fn()}}));
const trip=createTrip({title:'Tokyo',destination:'Tokyo',startDate:'2026-10-20',endDate:'2026-10-20',currency:'AUD',budgetMinor:250000,travellers:2,diet:'none',interests:'Gardens'});
const profile={trip_id:trip.id,revision:'r1',preferences:initialPreferences(trip,'en')};
const request={prompt:'Gardens',plan_options:true};
const advice={manager_id:'trip-manager-test',profile_revision:'r1',review_run_ids:['pre','post'],response:{status:'ok',specialist:'trip-planner',recommendations:[{id:'garden'}],limitations:[],trip_options:['budget','balanced','premium'].map((tier,index)=>({tier,budget:{accommodation_minor:1000*(index+1),food_minor:100,activities_minor:100,transport_minor:100,contingency_minor:100},days:[{date:'2026-10-20',destination:'Tokyo',stops:[{evidence_id:'garden',time:'10:00',minutes:60}]}]}))}};
const queued={id:'job-1',profile_revision:'r1',status:'queued' as const,attempts:0,result:null,error_code:null,input:{request}};
const respond=(body:unknown,status=200)=>jest.mocked(fetch).mockResolvedValueOnce({ok:status<400,status,json:async()=>body} as Awaited<ReturnType<typeof fetch>>);
beforeEach(()=>{jest.clearAllMocks();jest.useFakeTimers();});
afterEach(()=>{jest.useRealTimers();});
test('follows a saved job through a retry and validates the reviewed result',async()=>{
 respond(queued,202);respond({...queued,status:'running',attempts:1});respond({...queued,status:'queued',attempts:1});respond({...queued,status:'completed',attempts:2,result:advice});
 const progress=jest.fn();const result=startPlanning(profile,request,new AbortController().signal,progress);
 await jest.runAllTimersAsync();
 expect(await result).toEqual(advice);
 expect(jest.mocked(fetch).mock.calls.map(call=>call[1]?.method)).toEqual(['POST','GET','GET','GET']);
 expect(progress).toHaveBeenCalledWith(expect.stringContaining('retrying'));
});
test('reopening follows the existing job without starting a new one',async()=>{
 respond({...queued,status:'completed',attempts:1,result:advice});
 const result=resumePlanning(profile,queued,new AbortController().signal,jest.fn());
 await jest.runAllTimersAsync();expect(await result).toEqual(advice);
 expect(jest.mocked(fetch).mock.calls.every(call=>call[1]?.method==='GET')).toBe(true);
});
test('navigation aborts polling without cancelling the server job',async()=>{
 const controller=new AbortController();
 const result=resumePlanning(profile,queued,controller.signal,jest.fn());
 const rejection=expect(result).rejects.toThrow('cancelled');controller.abort();
 await rejection;expect(fetch).not.toHaveBeenCalled();
});
test('never displays results belonging to a different profile revision',async()=>{
 await expect(resumePlanning(profile,{...queued,status:'completed',result:{...advice,profile_revision:'old'} as never},new AbortController().signal,jest.fn())).rejects.toThrow('preferences');
});

test('temporary gateway failure keeps following the same saved job',async()=>{
 respond({error:'unavailable'},503);respond({...queued,status:'completed',attempts:1,result:advice});
 const progress=jest.fn();const result=resumePlanning(profile,queued,new AbortController().signal,progress);
 await jest.runAllTimersAsync();expect(await result).toEqual(advice);
 expect(progress).toHaveBeenCalledWith(expect.stringContaining('Reconnecting'));
 expect(jest.mocked(fetch).mock.calls.every(call=>call[1]?.method==='GET')).toBe(true);
});
test('a replaced job is not mistaken for the requested comparison',async()=>{
 respond({...queued,id:'different-job'});
 const result=resumePlanning(profile,queued,new AbortController().signal,jest.fn());
 const rejection=expect(result).rejects.toThrow('request changed');
 await jest.runAllTimersAsync();await rejection;
});
