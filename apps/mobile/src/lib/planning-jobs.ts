import {ApiError, apiRequest} from './trip-api';
import {validateManagerAdvice, type Advice, type ManagerRequest, type SavedTravelProfile} from './trip-manager';

export type PlanningJob = {
  id:string;
  profile_revision:string;
  status:'queued'|'running'|'completed'|'failed'|'cancelled';
  attempts:number;
  result:Advice|null;
  error_code:string|null;
  input:{request:ManagerRequest};
};
const path=(trip:string)=>`/v1/trips/${encodeURIComponent(trip)}/planning`;
const cancelled=()=>new Error('Request cancelled. Your saved trip is unchanged.');

export async function loadPlanningJob(trip:string,signal?:AbortSignal):Promise<PlanningJob|null> {
  try {return await apiRequest(path(trip),undefined,response=>response.json(),12000,signal,'GET');}
  catch(error) {if(error instanceof ApiError && error.status===404)return null;throw error;}
}

export async function cancelPlanning(trip:string,id:string):Promise<void> {
  const job=await apiRequest<PlanningJob>(path(trip),{id},response=>response.json(),12000,undefined,'DELETE');
  if(job.id!==id || job.status!=='cancelled')throw new Error('This request already finished or changed.');
}

export async function startPlanning(profile:SavedTravelProfile,request:ManagerRequest,signal:AbortSignal,progress:(text:string)=>void,started?:(id:string)=>void):Promise<Advice> {
  const job=await apiRequest<PlanningJob>(path(profile.trip_id),{profile:{trip_id:profile.trip_id,revision:profile.revision},specialist:'trip-planner',request},response=>response.json(),12000,signal);
  return resumePlanning(profile,job,signal,progress,started);
}

function pause(signal:AbortSignal):Promise<void> {
  return new Promise((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(cancelled());};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},2000);
    signal.addEventListener('abort',abort,{once:true});
    if(signal.aborted)abort();
  });
}

export async function resumePlanning(profile:SavedTravelProfile,initial:PlanningJob,signal:AbortSignal,progress:(text:string)=>void,started?:(id:string)=>void):Promise<Advice> {
  let job=initial;
  started?.(job.id);
  const deadline=Date.now()+12*60*1000;
  while(true) {
    if(signal.aborted)throw cancelled();
    if(job.profile_revision!==profile.revision)throw new Error('Your preferences changed. Reload them and try again.');
    if(!job.id || !Number.isInteger(job.attempts) || job.attempts<0 || job.attempts>3 || !job.input?.request?.plan_options)throw new Error('The saved planning request is invalid.');
    if(job.status==='completed') {
      if(!job.result)throw new Error('The saved plan is incomplete. Please try again.');
      return validateManagerAdvice(job.result,profile,'trip-planner',job.input.request);
    }
    if(job.status==='cancelled')throw cancelled();
    if(job.status==='failed')throw new Error(job.error_code==='profile_changed'?'Your preferences changed. Reload them and try again.':'We could not finish reviewing this trip. Your saved trip is unchanged. Please try again.');
    if(job.status!=='queued' && job.status!=='running')throw new Error('The saved planning request is invalid.');
    if(Date.now()>=deadline)throw new Error('Your request is saved. Reopen the trip manager to check its progress.');
    progress(job.attempts>1 || (job.status==='queued' && job.attempts>0)
      ? 'Your request is saved. We’re retrying a slow planning service…'
      : 'Creating and reviewing your options. You can leave this screen and return to this trip.');
    await pause(signal);
    try {
      const next=await loadPlanningJob(profile.trip_id,signal);
      if(!next || next.id!==initial.id)throw new Error('Your planning request changed. Reopen the trip manager to continue.');
      job=next;
    } catch(error) {
      if(signal.aborted)throw cancelled();
      if(error instanceof TypeError || (error instanceof ApiError && [429,502,503,504].includes(error.status)) || (error instanceof Error && error.name==='AbortError')) {
        progress('Your request is saved. Reconnecting to check its progress…');
        continue;
      }
      throw error;
    }
  }
}
