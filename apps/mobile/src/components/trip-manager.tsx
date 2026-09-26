import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Text, TextInput, View } from 'react-native';
import { Button, Card, Chip } from './ui';
import { font, useColors } from '@/constants/theme';
import { format } from '@/lib/money';
import { askTripManager, initialPreferences, loadTravelProfile, saveTravelProfile, SPECIALISTS, planTotal, type Advice, type SavedTravelProfile, type Specialist, type TripOption, type TravelPreferences, type ChosenPlan } from '@/lib/trip-manager';
import type { Trip } from '@/lib/trips';

export function TripManager({trip, language, choose}: {trip:Trip;language:string;choose:(plan:ChosenPlan)=>Promise<void>}) {
  const c = useColors();
  const [profile,setProfile] = useState<SavedTravelProfile|null>(null);
  const [preferences,setPreferences] = useState<TravelPreferences>(()=>initialPreferences(trip,language));
  const [prompt,setPrompt] = useState(`Plan ${trip.destination} for ${trip.travellers} travellers. ${trip.interests}`);
  const [specialist,setSpecialist] = useState<Specialist>('trip-planner');
  const [advice,setAdvice] = useState<Advice|null>(null);
  const [ready,setReady] = useState(false), [busy,setBusy] = useState(''), [error,setError] = useState(''), [attempt,setAttempt] = useState(0);
  const controller=useRef<AbortController|null>(null);
  useEffect(()=>{
    const task=new AbortController(); controller.current=task; setReady(false); setAdvice(null); setError('');
    loadTravelProfile(trip.id,task.signal).then(saved=>{
      if (!task.signal.aborted) { setProfile(saved); setPreferences(saved?.preferences ?? initialPreferences(trip,language)); setReady(true); }
    }).catch(e=>{if(!task.signal.aborted)setError(e instanceof Error?e.message:'Could not load preferences.');})
      .finally(()=>{if(controller.current===task)controller.current=null;});
    return ()=>task.abort();
  },[trip,language,attempt]);
  useEffect(()=>()=>controller.current?.abort(),[]);
  const change=(key:'allergies'|'diets'|'accessibility_requirements'|'preferences',value:string)=>{
    setAdvice(null); setPreferences(p=>({...p,[key]:value ? value.split(',').map(v=>v.trim()) : []}));
  };
  async function ask() {
    if(controller.current || !ready)return;
    const task=new AbortController(); controller.current=task; setBusy('Saving your preferences…'); setError(''); setAdvice(null);
    try {
      if(!prompt.trim())throw new Error('Tell your trip manager what you would like.');
      const saved=await saveTravelProfile(trip.id,{...preferences, allergies:preferences.allergies.filter(Boolean),diets:preferences.diets.filter(Boolean),accessibility_requirements:preferences.accessibility_requirements.filter(Boolean),preferences:preferences.preferences.filter(Boolean)},profile?.revision??null,task.signal);
      if(task.signal.aborted)return;
      setProfile(saved); setBusy(specialist==='trip-planner'?'Creating and reviewing three trip options…':'Your manager is reviewing your request…');
      const result=await askTripManager(saved,specialist,{prompt,destination:trip.destination,travellers:trip.travellers,stays:trip.stays?.map(stay=>({destination:stay.destination.label,days:stay.days})),plan_options:specialist==='trip-planner'},task.signal);
      if(!task.signal.aborted)setAdvice(result);
    } catch(e) {if(!task.signal.aborted)setError(e instanceof Error?e.message:'Could not complete your request.');}
    finally {if(controller.current===task){controller.current=null;setBusy('');}}
  }
  const field=(label:string,value:string,onChangeText:(value:string)=>void,multiline=false)=><View style={{gap:6}}><Text style={[font.caption,{color:c.muted}]}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} editable={ready&&!busy} multiline={multiline} maxLength={multiline?2000:400} style={{minHeight:48,padding:12,borderWidth:1,borderColor:c.border,borderRadius:12,color:c.text,backgroundColor:c.surface}} /></View>;
  return <View style={{gap:18}}>
    <Text accessibilityRole="header" style={[font.title,{color:c.text}]}>Your trip manager</Text>
    <Text style={[font.body,{color:c.muted}]}>Compare budget, balanced and premium trips. Your manager checks each option against your saved preferences before you choose.</Text>
    {!ready&&!error?<ActivityIndicator accessibilityLabel="Loading travel preferences"/>:null}
    {ready?<>
      {field('Allergies (comma separated)',preferences.allergies.join(', '),v=>change('allergies',v))}
      {field('Dietary requirements',preferences.diets.join(', '),v=>change('diets',v))}
      {field('Accessibility requirements',preferences.accessibility_requirements.join(', '),v=>change('accessibility_requirements',v))}
      {field('Travel preferences',preferences.preferences.join(', '),v=>change('preferences',v),true)}
      <Text style={[font.caption,{color:c.muted}]}>{trip.startDate} – {trip.endDate} · {trip.travellers} travellers · {preferences.budget_minor===null?'No spending ceiling set':`Maximum ${format(preferences.budget_minor,preferences.currency)} for the party`}</Text>
      <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{Object.entries(SPECIALISTS).map(([key,label])=><Chip key={key} label={label} selected={specialist===key} onPress={()=>{if(!busy){setSpecialist(key as Specialist);setAdvice(null);}}}/>)}</View>
      {field('Tell your trip manager',prompt,value=>{setPrompt(value);setAdvice(null);},true)}
      <Button label={specialist==='trip-planner'?'Compare three trip options':'Ask my trip manager'} disabled={!!busy} onPress={()=>void ask()}/>
    </>:null}
    {busy?<Card><ActivityIndicator accessibilityLabel="Reviewing your trip"/><Text style={{color:c.text}}>{busy}</Text><Button label="Cancel request" kind="secondary" onPress={()=>{controller.current?.abort();controller.current=null;setBusy('');setError('Cancelled. Your selected plan is unchanged.');}}/></Card>:null}
    {error?<View style={{gap:10}}><Text accessibilityRole="alert" style={{color:c.danger}}>{error}</Text><Button label="Reload saved preferences" kind="secondary" onPress={()=>setAttempt(n=>n+1)}/></View>:null}
    {advice?<>
      <Text style={[font.caption,{color:c.muted}]}>Reviewed for your saved travel preferences.</Text>
      {advice.response.limitations.map((text,index)=><Text key={index} style={[font.caption,{color:c.muted}]}>{text}</Text>)}
      {advice.response.status!=='ok'?<Text style={{color:c.text}}>{advice.response.status==='unavailable'?'This service is not available yet.':'No verified matches for these preferences. Try changing your request.'}</Text>:null}
      {advice.response.trip_options?.map(option=><PlanCard key={option.tier} option={option} advice={advice} currency={preferences.currency} select={()=>{
        if(!profile)return;
        setBusy('Saving your chosen plan…');
        loadTravelProfile(trip.id).then(current=>{
          if(!current || current.revision!==profile.revision)throw new Error('Your preferences changed. Reload them before choosing a plan.');
          return choose({option,advice,currency:preferences.currency,profileRevision:profile.revision});
        }).catch(e=>setError(e instanceof Error?e.message:'Could not save plan.')).finally(()=>setBusy(''));
      }} disabled={!!busy}/>)}
      {!advice.response.trip_options?.length?advice.response.recommendations.map(item=><Card key={item.id}><Text style={[font.headline,{color:c.text}]}>{item.name}</Text><Text style={{color:c.muted}}>{item.cost_minor===null?'Price not verified':format(item.cost_minor,item.currency??preferences.currency)} · {item.duration_seconds===null?'Travel time not verified':`${Math.ceil(item.duration_seconds/60)} minutes`}</Text><SourceLink url={item.source_url} label="View source"/>{item.maps_url?<SourceLink url={item.maps_url} label="Directions"/>:null}</Card>):null}
    </>:null}
  </View>;
}
function SourceLink({url,label}:{url:string;label:string}) {
  const c=useColors();
  let safe=false; try {safe=new URL(url).protocol==='https:';} catch {}
  return safe?<Button label={label} kind="secondary" onPress={()=>void Linking.openURL(url).catch(()=>{})}/>:<Text style={{color:c.muted}}>Source unavailable</Text>;
}
export function PlanCard({option,advice,currency,select,disabled}:{option:TripOption;advice:Advice;currency:string;select?:()=>void;disabled?:boolean}) {
  const c=useColors(); const byId=new Map(advice.response.recommendations.map(item=>[item.id,item]));
  const labels={accommodation_minor:'Accommodation',food_minor:'Food',activities_minor:'Activities',transport_minor:'Transport',contingency_minor:'Contingency'};
  return <Card style={{gap:14,padding:20}}>
    <Text accessibilityRole="header" style={[font.headline,{color:c.text}]}>{option.tier==='budget'?'Budget':option.tier==='balanced'?'Balanced':'Premium'} · {option.title}</Text>
    <Text style={[font.title,{color:c.text}]}>{format(planTotal(option),currency)}</Text>
    <Text style={[font.caption,{color:c.muted}]}>Approximate whole-trip allocation for your party. Flights excluded. This is not a live quote.</Text>
    <Text style={{color:c.text}}>{option.summary}</Text>
    {Object.entries(labels).map(([key,label])=><Text key={key} style={{color:c.muted}}>{label}: {format(option.budget[key as keyof typeof option.budget],currency)}</Text>)}
    <Text style={[font.headline,{color:c.text}]}>Where to stay</Text><Text style={{color:c.text}}>{option.accommodation_guidance}</Text>
    {option.accommodation_ids?.map(id=>{const place=byId.get(id);return place?<View key={id} style={{gap:6}}><Text style={{color:c.text}}>{place.name} · availability not verified</Text><SourceLink url={place.maps_url??place.source_url} label={`Compare ${place.name}`}/></View>:null;})}
    <Text style={[font.headline,{color:c.text}]}>Getting around</Text><Text style={{color:c.text}}>{option.transport_guidance}</Text>
    {option.days.map(day=><View key={day.date} style={{gap:10}}><Text style={[font.headline,{color:c.text}]}>{day.date} · {day.destination}</Text>{day.stops.map((stop,index)=>{
      const place=byId.get(stop.evidence_id);
      return <View key={`${stop.evidence_id}-${index}`} style={{gap:6}}><Text style={{color:c.text}}>{stop.time} · {place?.name??'Place unavailable'} · {stop.minutes} min suggested</Text><Text style={{color:c.muted}}>{stop.note}</Text>{place?<SourceLink url={place.maps_url??place.source_url} label={`Map and source for ${place.name}`}/>:null}</View>;
    })}</View>)}
    {select?<Button label={`Choose ${option.tier} trip`} disabled={disabled} onPress={select}/>:null}
  </Card>;
}
