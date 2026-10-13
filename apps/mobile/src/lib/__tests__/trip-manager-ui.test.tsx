import React from 'react';
import { expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { TripManager } from '../../components/trip-manager';
import { initialPreferences, loadTravelProfile, saveTravelProfile, askTripManager, type Advice } from '../trip-manager';
import {startPlanning, loadPlanningJob, resumePlanning, cancelPlanning} from '../planning-jobs';
import { createTrip } from '../trips';
jest.mock('@react-native-async-storage/async-storage',()=>({getItem:jest.fn(async()=>null),setItem:jest.fn(async()=>{})}));
jest.mock('react-native-safe-area-context',()=>({useSafeAreaInsets:()=>({top:0,bottom:0,left:0,right:0})}));
jest.mock('../planning-jobs',()=>({startPlanning:jest.fn(),loadPlanningJob:jest.fn(async()=>null),resumePlanning:jest.fn(),cancelPlanning:jest.fn()}));
jest.mock('../trip-manager',()=>({
  ...jest.requireActual<typeof import('../trip-manager')>('../trip-manager'),
  loadTravelProfile:jest.fn(), saveTravelProfile:jest.fn(), askTripManager:jest.fn(),
}));
jest.mock('../auth-client',()=>({API_BASE:'https://roamie.test',session:{}}));
const trip=createTrip({title:'Vietnam',destination:'Hanoi',startDate:'2026-10-01',endDate:'2026-10-01',currency:'AUD',budgetMinor:60000,travellers:1,diet:'none',interests:'Museums'});
const saved={trip_id:trip.id,revision:'r1',preferences:initialPreferences(trip,'en')};
const result:Advice={manager_id:'trip-manager-alice',profile_revision:'r1',review_run_ids:['pre','post'],response:{status:'ok',specialist:'trip-planner',limitations:[],recommendations:[{id:'museum',name:'Museum',source_url:'https://maps.google.com/museum',observed_at:'2026-09-26T00:00:00Z',maps_url:null,cost_minor:null,currency:null,duration_seconds:null,warnings:[]}],trip_options:(['budget','balanced','premium'] as const).map((tier,index)=>({tier,label:`${tier} visit`,summary:'Proposed museum visit',accommodation_guidance:'Compare central hotels',transport_guidance:'Local transit',budget:{accommodation_minor:1000*(index+1),food_minor:500,activities_minor:100,transport_minor:100,contingency_minor:100},days:[{date:'2026-10-01',destination:'Hanoi',stops:[{evidence_id:'museum',time:'10:00',minutes:60,note:'Confirm opening hours'}]}]}))}};
test('saves preferences, compares three reviewed plans and chooses without auto-booking',async()=>{
  jest.mocked(loadTravelProfile).mockResolvedValueOnce(saved).mockResolvedValueOnce({...saved,revision:'r2'});
  jest.mocked(saveTravelProfile).mockResolvedValueOnce({...saved,revision:'r2'});
  jest.mocked(startPlanning).mockResolvedValueOnce({...result,profile_revision:'r2'});
  const choose=jest.fn(async()=>{});
  await render(<TripManager trip={trip} language="en" choose={choose}/>);
  await fireEvent.changeText(await screen.findByLabelText('Allergies (comma separated)'),'Peanuts, shellfish');
  await fireEvent.press(screen.getByRole('button',{name:'Compare three trip options'}));
  expect(await screen.findByRole('button',{name:'Choose balanced trip'})).toBeTruthy();
  expect(saveTravelProfile).toHaveBeenCalledWith(trip.id,expect.objectContaining({allergies:['Peanuts','shellfish']}),'r1',expect.any(AbortSignal));
  expect(startPlanning).toHaveBeenCalledWith(expect.objectContaining({revision:'r2'}),expect.objectContaining({plan_options:true,destination:'Hanoi',travellers:1}),expect.any(AbortSignal),expect.any(Function),expect.any(Function));
  expect(screen.getAllByText(/not a live quote/)).toHaveLength(3);
  expect(choose).not.toHaveBeenCalled();
  expect(screen.queryByText('Confirm opening hours')).toBeNull();
  await fireEvent.press(screen.getByRole('button',{name:'View balanced itinerary'}));
  expect(screen.getAllByText('Confirm opening hours')).toHaveLength(1);
  await fireEvent.press(screen.getByRole('button',{name:'Choose balanced trip'}));
  expect(choose).toHaveBeenCalledWith(expect.objectContaining({option:expect.objectContaining({tier:'balanced'}),profileRevision:'r2'}));
});
test('does not request advice when preferences cannot be loaded',async()=>{
  jest.mocked(loadTravelProfile).mockRejectedValueOnce(new Error('Profile service unavailable'));
  const calls=jest.mocked(askTripManager).mock.calls.length;
  await render(<TripManager trip={trip} language="en" choose={async()=>{}}/>);
  expect(await screen.findByText('Profile service unavailable')).toBeTruthy();
  expect(screen.queryByRole('button',{name:'Compare three trip options'})).toBeNull();
  expect(jest.mocked(askTripManager).mock.calls.length).toBe(calls);
});

test('reopening a trip resumes its saved job without generating another plan',async()=>{
 jest.mocked(loadTravelProfile).mockResolvedValueOnce(saved);
 jest.mocked(loadPlanningJob).mockResolvedValueOnce({id:'job-1',profile_revision:'r1',status:'running',attempts:1,result:null,error_code:null,input:{request:{prompt:'Keep my garden request',plan_options:true}}});
 jest.mocked(resumePlanning).mockResolvedValueOnce(result);
 const before=jest.mocked(startPlanning).mock.calls.length;
 await render(<TripManager trip={trip} language="en" choose={async()=>{}}/>);
 expect(await screen.findByRole('button',{name:'Choose balanced trip'})).toBeTruthy();
 expect(startPlanning).toHaveBeenCalledTimes(before);
 expect(resumePlanning).toHaveBeenCalledWith(saved,expect.objectContaining({id:'job-1'}),expect.any(AbortSignal),expect.any(Function),expect.any(Function));
});


test('explicit cancellation cancels the exact saved job',async()=>{
 jest.mocked(loadTravelProfile).mockResolvedValueOnce(saved);
 jest.mocked(loadPlanningJob).mockResolvedValueOnce({id:'job-cancel',profile_revision:'r1',status:'running',attempts:1,result:null,error_code:null,input:{request:{prompt:'Gardens',plan_options:true}}});
 jest.mocked(cancelPlanning).mockResolvedValueOnce();
 jest.mocked(resumePlanning).mockImplementationOnce(async(_profile,job,signal,progress,started)=>{
   started?.(job.id);progress('Working on your saved request');
   return new Promise<Advice>((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true}));
 });
 await render(<TripManager trip={trip} language="en" choose={async()=>{}}/>);
 await fireEvent.press(await screen.findByRole('button',{name:'Cancel request'}));
 expect(cancelPlanning).toHaveBeenCalledWith(trip.id,'job-cancel');
 expect(await screen.findByText('Cancelled. Your selected plan is unchanged.')).toBeTruthy();
});
