import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as Print from 'expo-print';
import { captureRef } from 'react-native-view-shot';
import { File } from 'expo-file-system';
import { Button, Card, Chip, Icon, Screen, TAB_CLEARANCE } from '@/components/ui';
import { ProfileSettings } from '@/components/profile-settings';
import { TripDatePicker, localDate, tripDateLabel } from '@/components/trip-date-picker';
import { DestinationLookup } from '@/components/destination-lookup';
import { InterestList, combineInterests } from '@/components/interest-list';
import { FOOD_PREFERENCES, TRIP_STYLES, type Destination } from '@/lib/trip-contract';
import { SearchPicker } from '@/components/search-picker';
import { CURRENCIES } from '@/data/currencies';
import { TripReadiness } from '@/components/trip-readiness';
import { TripManager, PlanCard } from '@/components/trip-manager';
import { TripMemoryCard } from '@/components/trip-memory-card';
import { font, useColors } from '@/constants/theme';
import { format, toMinor } from '@/lib/money';
import { useStore } from '@/lib/store';
import { useTrips } from '@/lib/trip-store';
import { createTrip, stayDates, modeName, newId, tripTotal, updateStop, type MemoryPhoto, type PlanRequest, type Trip, type TripStop } from '@/lib/trips';
import { renderMemory, memoryCapabilities, type MemoryOptions } from '@/lib/trip-api';
import { choosePhotos, chooseMusic, discardVideo, deletePhotos, exportTrip, photoData, saveToPhotos, saveVideo, shareFile, suggestPhotos, tripDirectory } from '@/lib/trip-media';

function Field({ label, value, change, placeholder, numeric = false, multiline = false }: { label: string; value: string; change: (s: string) => void; placeholder?: string; numeric?: boolean; multiline?: boolean }) {
  const c = useColors();
  return <View style={{ gap: 5 }}><Text style={[font.caption, { color: c.muted }]}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={change} placeholder={placeholder} placeholderTextColor={c.faint} keyboardType={numeric ? 'decimal-pad' : 'default'} multiline={multiline} maxLength={multiline ? 500 : 160} style={{ minHeight: 48, borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 12, color: c.text, backgroundColor: c.surface }} /></View>;
}
function NewTrip({ done, cancel }: { done: (id: string) => void; cancel: () => void }) {
  const c = useColors(), store = useTrips(), { profile } = useStore();
  const today = localDate();
  const [request, setRequest] = useState<PlanRequest>({ title: '', destination: '', startDate: '', endDate: '', currency: profile?.homeCurrency ?? 'USD', budgetMinor: 0, diet: profile?.diet ?? 'none', interests: '', travellers: 1 });
  const [interestDraft, setInterestDraft] = useState('');
  const [details, setDetails] = useState(false), [styles, setStyles] = useState<string[]>([]), [foods, setFoods] = useState<string[]>(profile?.diet && profile.diet !== 'none' ? [profile.diet[0].toUpperCase() + profile.diet.slice(1)] : []);
  const [children, setChildren] = useState('0'), [luggage, setLuggage] = useState('0');
  const toggle = (values: string[], value: string) => values.includes(value) ? values.filter(item => item !== value) : [...values, value];
  const [stays, setStays] = useState<{key: string; destination: Destination | null; days: string}[]>(() => [{key:newId(), destination:null, days:'1'}]);
  const destination = stays[0].destination;
  let ranges: {start: string; end: string}[] = [];
  try { ranges = stayDates(request.startDate, stays.map(stay => Number(stay.days))); } catch {}
  const updateStay = (key: string, patch: Partial<(typeof stays)[number]>) => setStays(values => values.map(stay => stay.key === key ? {...stay,...patch} : stay));
  const moveStay = (index: number) => setStays(values => { const next = [...values]; [next[index-1],next[index]] = [next[index],next[index-1]]; return next; });
  const [budget, setBudget] = useState(''), [people, setPeople] = useState('1'), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const field = (key: keyof PlanRequest) => (value: string) => setRequest(r => ({ ...r, [key]: key === 'currency' ? value.toUpperCase() : value }));
  async function create() { setBusy(true); setError(''); try { if (!request.startDate) throw new Error('Choose your departure date.'); if (request.startDate < localDate()) throw new Error('Choose today or a future departure date.'); if (!destination || stays.some(stay => !stay.destination)) throw new Error('Search and select every destination first.'); const periods = stayDates(request.startDate, stays.map(stay => Number(stay.days))); const amount = budget ? toMinor(budget, request.currency) : 0; if (amount === null) throw new Error('Enter a valid budget.'); const trip = createTrip({ ...request, interests: combineInterests(request.interests, interestDraft), destination: destination.label, endDate: periods[periods.length-1].end, stays: stays.map(stay => ({destination:stay.destination!,days:Number(stay.days)})), diet: foods.map(food => food.toLowerCase()).find(food => ['vegetarian', 'vegan', 'jain', 'pescatarian', 'halal', 'kosher'].includes(food)) ?? 'none', budgetMinor: amount, travellers: Number(people), preferences: { styles, foodPreferences: foods, adults: Number(people) - Number(children), children: Number(children), luggage: Number(luggage) } }); await store.save({ ...trip, destinationDetails: destination }); done(trip.id); } catch (e) { setError(e instanceof Error ? e.message : 'Could not save your trip.'); } finally { setBusy(false); } }
  return <Screen title="Where to next?" subtitle="Make room for a little adventure."><KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: TAB_CLEARANCE + 24, gap: 28 }}>
    <View style={{ gap: 20 }}>
    <Text accessibilityRole="header" style={[font.headline, { color: c.text }]}>The essentials</Text>
    <Field label="Trip name" value={request.title} change={field('title')} placeholder="My Japan adventure" />
    <TripDatePicker value={request.startDate} minimumDate={today} onChange={field('startDate')} />
    </View>
    <View style={{ gap: 16 }}>
    <View style={{ gap: 6 }}><Text accessibilityRole="header" style={[font.headline, { color: c.text }]}>Your route</Text><Text style={[font.caption, { color: c.muted }]}>Choose your stops and time in each place.</Text></View>
    {stays.map((stay, index) => <Card key={stay.key} style={{ padding: 20, borderRadius: 20, gap: 20 }}>
      <DestinationLookup label={index === 0 ? 'Destination' : 'Destination ' + (index + 1)} selected={stay.destination} onSelect={value => updateStay(stay.key, {destination:value})} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingTop: 16, borderTopWidth: 1, borderTopColor: c.border }}>
        <Text style={[font.body, { color: c.text }]}>Duration</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <TextInput accessibilityLabel={'Days at destination ' + (index + 1)} value={stay.days} onChangeText={value => updateStay(stay.key, {days:value})} keyboardType="number-pad" maxLength={2} selectTextOnFocus style={[font.body, { minWidth: 64, minHeight: 48, padding: 10, textAlign: 'center', borderWidth: 1, borderColor: c.border, borderRadius: 12, backgroundColor: c.surface, color: c.text }]} />
        <Text style={[font.body, { color: c.muted }]}>{stay.days === '1' ? 'day' : 'days'}</Text></View>
      </View>
      {ranges[index] ? <Text style={[font.caption, {color:c.muted}]}>{tripDateLabel(ranges[index].start)}{ranges[index].end !== ranges[index].start ? ' — ' + tripDateLabel(ranges[index].end) : ''}</Text> : null}
      {index > 0 ? <Button label={'Move destination ' + (index + 1) + ' earlier'} kind="secondary" onPress={() => moveStay(index)} /> : null}
      {stays.length > 1 ? <Button label={'Remove destination ' + (index + 1)} kind="secondary" onPress={() => setStays(values => values.filter(value => value.key !== stay.key))} /> : null}
    </Card>)}
    {stays.length < 4 ? <Pressable accessibilityRole="button" accessibilityLabel="Add another destination" onPress={() => setStays(values => [...values,{key:newId(),destination:null,days:'1'}])} style={({ pressed }) => ({ minHeight: 48, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 14, alignItems: 'center', backgroundColor: c.accentSoft, opacity: pressed ? 0.7 : 1 })}><Text style={[font.body, { fontWeight: '600', color: c.accent }]}>+ Add another destination</Text></Pressable> : null}
    <Text style={[font.caption, { color: c.muted }]}>{ranges.length ? 'Home on ' + tripDateLabel(ranges[ranges.length-1].end) + ' · ' : ''}Up to 4 destinations · 14 days total.</Text>
    </View>
    <View style={{ gap: 20 }}>
    <Text accessibilityRole="header" style={[font.headline, { color: c.text }]}>People & budget</Text>
    <Field label="Travellers (1–12)" value={people} change={setPeople} numeric />
    <SearchPicker title="Currency" value={request.currency} options={CURRENCIES} onChange={field('currency')} />
    <Field label={'Trip budget (optional) · ' + request.currency} value={budget} change={setBudget} numeric />
    </View>
    <View style={{ gap: 20 }}>
    <Text accessibilityRole="header" style={[font.headline, { color: c.text }]}>Make it yours</Text>
    <Button label={details ? "Hide trip details" : "Trip style, food & luggage"} kind="secondary" onPress={() => setDetails(value => !value)} />
    {details ? <View style={{ gap: 16 }}>
      <Text style={[font.headline, { color: c.text }]}>Your kind of adventure</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{TRIP_STYLES.map(style => <Chip key={style} label={style} selected={styles.includes(style)} onPress={() => setStyles(toggle(styles, style))} />)}</View>
      <Field label="Children included in your travellers" value={children} change={setChildren} numeric />
      <Text style={[font.caption, { color: c.muted }]}>Include at least one adult. Family plans avoid adult nightlife.</Text>
      <Field label="Bags for the whole group (0–24)" value={luggage} change={setLuggage} numeric />
      <Text style={[font.headline, { color: c.text }]}>Food preferences</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{FOOD_PREFERENCES.map(food => <Chip key={food} label={food} selected={foods.includes(food)} onPress={() => setFoods(toggle(foods, food))} />)}</View>
      <Text style={[font.caption, { color: c.muted }]}>Choose all that apply. Confirm ingredients and allergy safety directly with the venue.</Text>
    </View> : null}
    <InterestList label="Things you love" value={request.interests} draft={interestDraft} changeDraft={setInterestDraft} change={field('interests')} placeholder="Gardens, street food, a slower pace…" />
    </View>
    <View style={{ gap: 12, paddingTop: 8 }}>
    {error ? <Text accessibilityRole="alert" style={{ color: c.danger }}>{error}</Text> : null}
    <Button label="Create my trip" busy={busy} onPress={() => { void create(); }} /><Button label="Cancel" kind="secondary" onPress={cancel} />
    </View>
  </ScrollView></KeyboardAvoidingView></Screen>;
}
function StopEditor({ trip, day, original, close, saved }: { trip: Trip; day: number; original?: TripStop; close: () => void; saved: (trip: Trip) => Promise<void> }) {
  const c = useColors(), insets = useSafeAreaInsets();
  const [stop, setStop] = useState<TripStop>(original ?? { id: newId(), time: '09:00', minutes: 60, kind: 'sight', title: '', note: '', costMinor: 0, place: null, transport: [] });
  const [duration, setDuration] = useState(String(stop.minutes)), [cost, setCost] = useState(String(stop.costMinor / 10 ** (new Intl.NumberFormat('en', { style: 'currency', currency: trip.currency }).resolvedOptions().maximumFractionDigits ?? 2))), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const field = (key: 'title' | 'time' | 'note') => (value: string) => setStop(s => ({ ...s, [key]: value }));
  async function save() { setBusy(true); try { const amount = toMinor(cost, trip.currency); if (amount === null) throw new Error('Enter a valid cost.'); await saved(updateStop(trip, day, { ...stop, minutes: Number(duration), costMinor: amount })); close(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not save this stop.'); } finally { setBusy(false); } }
  return <Modal animationType="slide" onRequestClose={close}><KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.background }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 24, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24, gap: 16 }}>
    <Text style={[font.largeTitle, { color: c.text }]}>A moment in your day</Text><Field label="Place or activity" value={stop.title} change={field('title')} /><Field label="Time · HH:MM" value={stop.time} change={field('time')} /><Field label="Duration in minutes" value={duration} change={setDuration} numeric /><Field label={`Estimated cost · ${trip.currency}`} value={cost} change={setCost} numeric /><View style={{ flexDirection: 'row', gap: 8 }}>{['sight', 'lunch', 'dinner'].map(kind => <Chip key={kind} label={kind} selected={stop.kind === kind} onPress={() => setStop(s => ({ ...s, kind }))} />)}</View><Field label="Notes" value={stop.note} change={field('note')} multiline />{error ? <Text accessibilityRole="alert" style={{ color: c.danger }}>{error}</Text> : null}<Button label="Save stop" busy={busy} onPress={() => { void save(); }} /><Button label="Cancel" kind="secondary" onPress={close} />
  </ScrollView></KeyboardAvoidingView></Modal>;
}
function MemoryPlayer({ uri, disabled, discard }: { uri: string; disabled: boolean; discard: () => void }) {
  const player = useVideoPlayer(uri);
  return <><VideoView player={player} style={{ width: '100%', aspectRatio: 9 / 16, borderRadius: 16 }} nativeControls contentFit="contain" /><Button label="Discard video" kind="secondary" disabled={disabled} onPress={() => Alert.alert('Discard this preview?', 'Your photos and any video already saved or shared will stay.', [{ text: 'Keep video', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: async () => { try { player.pause(); await player.replaceAsync(null); discard(); } catch { Alert.alert('Could not discard', 'Close the preview and try again.'); } } }])} /></>;
}
function TripDetails({ trip, back }: { trip: Trip; back: () => void }) {
  const [showManager,setShowManager] = useState(false);
  const {profile} = useStore();
  const store = useTrips(), c = useColors(), insets = useSafeAreaInsets();
  const { width, fontScale } = useWindowDimensions();
  const [day, setDay] = useState(0), [tab, setTab] = useState<'calendar' | 'memories'>('calendar'), [editor, setEditor] = useState<TripStop | 'new' | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(''), [seconds, setSeconds] = useState<60 | 90>(60), [video, setVideo] = useState<string | null>(null), [pdf, setPdf] = useState<string | null>(null), [suggested, setSuggested] = useState<MemoryPhoto[] | null>(null);
  const [videoStage, setVideoStage] = useState<'preparing' | 'rendering' | null>(null);
  const [videoNotice, setVideoNotice] = useState('');
  const [options, setOptions] = useState<MemoryOptions>({theme:'postcard',soundtrack:'none',openingCaption:'',year:Number(trip.startDate.slice(0,4))});
  const [musicName, setMusicName] = useState(''), [editorReady, setEditorReady] = useState(false), [editorError, setEditorError] = useState(''), [capabilityAttempt, setCapabilityAttempt] = useState(0);
  useEffect(() => {
    if (tab !== 'memories' || !trip.photos.length) return;
    const task = new AbortController();
    memoryCapabilities(task.signal).then(result => { if (!task.signal.aborted) { setEditorReady(result.editorVersion >= 1); if (result.editorVersion < 1) setEditorError('The video editor is not available yet. Please try again later.'); } }).catch(() => { if (!task.signal.aborted) setEditorError('Cannot reach the video editor. Check your connection and retry.'); });
    return () => task.abort();
  }, [tab, trip.photos.length, capabilityAttempt]);
  const preview = useRef<View>(null), controller = useRef<AbortController | null>(null), alive = useRef(true), pendingPhotos = useRef<MemoryPhoto[]>([]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); deletePhotos(store.accountId, trip.id, pendingPhotos.current); }; }, [store.accountId, trip.id]);
  async function work(label: string, run: (signal: AbortSignal) => Promise<void>) {
    if (controller.current) return;
    const task = new AbortController(); controller.current = task; setBusy(label); setError('');
    try { await run(task.signal); } catch (e) { if (alive.current) setError(task.signal.aborted ? 'Cancelled. Your saved trip is unchanged.' : e instanceof Error ? e.message : 'Please try again.'); }
    finally { controller.current = null; if (alive.current) setBusy(''); }
  }
  async function acceptPhotos(photos: MemoryPhoto[]) {
    try { await store.save({ ...trip, photos }); pendingPhotos.current = []; setSuggested(null); setVideo(null); deletePhotos(store.accountId, trip.id, trip.photos.filter(p => !photos.some(n => n.id === p.id))); }
    catch (e) { throw e; }
  }
  function pick(automatic: boolean) { void work(automatic ? 'Finding trip moments…' : 'Preparing photos…', async () => {
    const next = automatic ? await suggestPhotos(store.accountId, trip) : await choosePhotos(store.accountId, trip);
    if (!next) return;
    if (!alive.current) { deletePhotos(store.accountId, trip.id, next); return; }
    deletePhotos(store.accountId, trip.id, pendingPhotos.current); pendingPhotos.current = next; setSuggested(next);
  }); }
  function exportPdf() { void work('Making your keepsake…', async () => { const uri = await exportTrip(store.accountId, trip, tab === 'calendar' ? 'itinerary' : 'album'); if (alive.current) setPdf(uri); }); }
  function makeVideo() {
    Alert.alert('Create your memory video?', 'Your selected photos will upload to Roamie for rendering, then be removed from the server. Your music selection, if any, is also uploaded temporarily. The result is a private MP4 with gentle motion. Nothing is posted automatically.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Create video', onPress: () => { void work('Making your memory video…', async signal => {
      setVideoNotice(''); setVideoStage('preparing');
      try {
        const photos = await photoData(store.accountId, trip);
        if (signal.aborted) throw new Error('Cancelled');
        if (!alive.current) return;
        setVideoStage('rendering');
        const bytes = await renderMemory(trip.title, seconds, photos.map(p => p.data), photos.map(p => p.caption), signal, options);
        if (signal.aborted) throw new Error('Cancelled');
        if (alive.current) setVideo(saveVideo(store.accountId, trip.id, bytes));
      } catch (e) {
        if (alive.current) setVideoNotice(signal.aborted ? 'Video cancelled. Your photos and choices are safe.' : e instanceof Error ? e.message : 'Could not create your video. Please try again.');
      } finally {
        if (alive.current) setVideoStage(null);
      }
    }); } }]);
  }
  async function shareCard() {
    const uri = await captureRef(preview, { format: 'png', quality: 1, result: 'tmpfile' });
    const folder = tripDirectory(store.accountId, trip.id); folder.create({ intermediates: true, idempotent: true });
    const file = new File(folder, 'share-card.png'); if (file.exists) file.delete(); new File(uri).move(file);
    await shareFile(file.uri, 'image/png');
  }
  const photos = suggested ?? trip.photos;
  const route = trip.stays?.length ? trip.stays.map(stay => stay.destination.name).join(' → ') : trip.destinationDetails ? `${trip.destinationDetails.name}, ${trip.destinationDetails.country}` : trip.destination;
  const dateLabel = (date: string, year = false) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' as const } : {}) });
  const currentDestination = trip.stays?.find(stay => stay.destination.label === trip.days[day].destination)?.destination.name ?? trip.days[day].destination ?? trip.destination;
  return <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top + 8 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingBottom: 8 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="All trips" onPress={back} style={({ pressed }) => ({ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 16, opacity: pressed ? 0.6 : 1 })}>
        <Icon name="chevron.left" size={16} color={c.accent} /><Text style={[font.body, { color: c.accent, fontWeight: '600' }]}>All trips</Text>
      </Pressable>
      <ProfileSettings />
    </View>
    <ScrollView style={{ marginBottom: TAB_CLEARANCE }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: 24, gap: 24 }}>
      <View style={{ gap: 10 }}>
        <Text accessibilityRole="header" style={[font.largeTitle, { color: c.text }]}>{trip.title}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><Icon name="mappin.and.ellipse" size={18} color={c.accent} /><Text style={[font.body, { color: c.muted, flex: 1 }]}>{route}</Text></View>
        <Text style={[font.caption, { color: c.muted }]}>{dateLabel(trip.startDate, true)} – {dateLabel(trip.endDate, true)}</Text>
      </View>
      <Button label={showManager?'Close trip manager':'Plan with my trip manager'} kind="secondary" onPress={()=>setShowManager(value=>!value)} />
      {showManager?<TripManager trip={trip} language={profile?.language??'en'} choose={async managerPlan=>{await store.save({...trip,managerPlan});setShowManager(false);}}/>:null}
      <View style={{ flexDirection: 'row', gap: 4, backgroundColor: c.surface, borderRadius: 18, padding: 4 }}>
        {([{ key: 'calendar', label: 'Your days' }, { key: 'memories', label: 'Memories' }] as const).map(option => <Pressable key={option.key} accessibilityRole="tab" accessibilityLabel={option.label} accessibilityState={{ selected: tab === option.key }} onPress={() => setTab(option.key)} style={({ pressed }) => ({ flex: 1, minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', padding: 10, backgroundColor: tab === option.key ? c.accent : 'transparent', opacity: pressed ? 0.7 : 1 })}>
          <Text style={[font.body, { color: tab === option.key ? c.onAccent : c.muted, fontWeight: '600', textAlign: 'center' }]}>{option.label}</Text>
        </Pressable>)}
      </View>
      {busy && !(videoStage && tab === 'memories') ? <Card style={{ padding: 20, borderRadius: 24, gap: 14 }}><Text accessibilityRole="alert" style={[font.headline, { color: c.text }]}>{busy}</Text><Text style={[font.caption, { color: c.muted }]}>Keep Roamie open while this finishes.</Text><Button label="Cancel task" kind="secondary" onPress={() => controller.current?.abort()} /></Card> : null}
      {error ? <Card><Text accessibilityRole="alert" style={[font.body, { color: c.danger }]}>{error}</Text></Card> : null}
      {tab === 'calendar' ? <>
        <TripReadiness key={trip.updatedAt} trip={trip} />
        {trip.managerPlan?<><Text style={[font.caption,{color:c.muted}]}>Saved reviewed plan · Ask your trip manager to refresh details before booking.</Text><PlanCard option={trip.managerPlan.option} advice={trip.managerPlan.advice} currency={trip.managerPlan.currency}/></>:null}
        <Card style={{ padding: 20, borderRadius: 24, gap: 18 }}>
          <View style={{ flexDirection: 'row', gap: 20 }}>
            <View style={{ flex: 1, gap: 4 }}><Text style={[font.caption, { color: c.muted }]}>Duration</Text><Text style={[font.headline, { color: c.text }]}>{trip.days.length} {trip.days.length === 1 ? 'day' : 'days'}</Text></View>
            <View style={{ flex: 1, gap: 4 }}><Text style={[font.caption, { color: c.muted }]}>Travellers</Text><Text style={[font.headline, { color: c.text }]}>{trip.travellers} {trip.travellers === 1 ? 'person' : 'people'}</Text></View>
          </View>
          <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 16 }}>
            {trip.budgetMinor > 0 && <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}><Text style={[font.body, { color: c.muted }]}>Trip budget</Text><Text style={[font.headline, { color: tripTotal(trip) > trip.budgetMinor ? c.danger : c.text }]}>{format(trip.budgetMinor, trip.currency)}</Text></View>}
            <Text style={[font.caption, { color: c.muted }]}>{trip.days.some(d => d.stops.length) ? `Activities & meals: ${format(tripTotal(trip), trip.currency)} estimated` : 'No activities added yet.'}</Text>
            <Text style={[font.caption, { color: c.muted }]}>Activity estimates exclude transport and accommodation.</Text>
          </View>
          <Button label="Compare three trip options" disabled={!!busy} onPress={()=>setShowManager(true)} />
        </Card>
        <View style={{ gap: 16 }}>
          <Text accessibilityRole="header" style={[font.title, { color: c.text }]}>Explore each day</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 2 }}>{trip.days.map((d, i) => <Pressable key={d.date} accessibilityRole="button" accessibilityLabel={`Day ${i + 1}, ${dateLabel(d.date, true)}`} accessibilityState={{ selected: day === i }} onPress={() => setDay(i)} style={({ pressed }) => ({ minWidth: 84, minHeight: 72, padding: 12, borderRadius: 16, alignItems: 'center', gap: 6, backgroundColor: day === i ? c.accent : c.surface, opacity: pressed ? 0.7 : 1 })}>
            <Text style={[font.caption, { color: day === i ? c.onAccent : c.muted }]}>Day {i + 1}</Text><Text style={[font.headline, { color: day === i ? c.onAccent : c.text }]}>{dateLabel(d.date)}</Text>
          </Pressable>)}</ScrollView>
          <View style={{ gap: 6 }}><Text accessibilityRole="header" style={[font.headline, { color: c.text }]}>{new Date(`${trip.days[day].date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</Text><Text style={[font.body, { color: c.accent }]}>{currentDestination}</Text></View>
        </View>
        {day > 0 && trip.days[day].destination !== trip.days[day-1].destination ? <Text style={[font.caption, {color:c.muted}]}>Travel day · leave time to reach your next destination. Confirm transport separately.</Text> : null}
        {!trip.days[day].stops.length && <Card style={{ padding: 20, borderRadius: 24, gap: 14 }}><Text style={[font.headline, { color: c.text }]}>A day full of possibilities</Text><Text style={[font.body, { color: c.muted }]}>Add your own spots, meals and little detours. Or let Roamie suggest a starting point.</Text></Card>}
        {trip.days[day].stops.map(stop => <Card key={stop.id} style={{ padding: 20, borderRadius: 24, gap: 14 }}><Text style={[font.caption, { color: c.accent }]}>{stop.time} · {stop.minutes} MIN · {stop.kind.toUpperCase()}</Text><Text style={[font.title, { color: c.text }]}>{stop.title}</Text><Text style={[font.body, { color: c.muted }]}>{stop.note}</Text><Text style={[font.headline, { color: c.text }]}>Est. {format(stop.costMinor, trip.currency)}</Text>{stop.place && <><Text style={[font.caption, { color: c.muted }]}>{stop.place.address} · Google Maps</Text>{stop.place.mapsUri && <Button label="Open in Maps" kind="secondary" onPress={() => { void work('Opening Maps…', async () => { await Linking.openURL(stop.place!.mapsUri); }); }} />}</>}
          {stop.transport.length > 0 && <><Text style={[font.headline, { color: c.text }]}>Getting here · estimates</Text>{stop.transport.map(t => <View key={t.mode} style={{ paddingVertical: 6 }}><Text style={{ color: c.text }}>{modeName[t.mode]} · {t.minutes ? `${t.minutes} min · ${format(t.costMinor, trip.currency)}` : 'Check availability'}</Text><Text style={[font.caption, { color: c.muted }]}>{t.note}</Text></View>)}</>}
          <View style={{ flexDirection: 'row', gap: 8 }}><Button label="Edit" kind="secondary" disabled={!!busy} onPress={() => setEditor(stop)} /><Button label="Remove" kind="secondary" disabled={!!busy} onPress={() => { void work('Saving…', () => store.save({ ...trip, days: trip.days.map((d, i) => i === day ? { ...d, stops: d.stops.filter(s => s.id !== stop.id) } : d) })); }} /></View>
        </Card>)}
        <Button label="Add a stop" kind="secondary" disabled={!!busy} onPress={() => setEditor('new')} /><Text style={[font.caption, { color: c.muted }]}>{trip.notice}</Text>
      </> : <>
        <Card style={{ padding: 20, borderRadius: 24, gap: 14 }}><Text style={[font.title, { color: c.text }]}>Trip memories</Text><Text style={[font.body, { color: c.muted }]}>Choose 1–15 photos, add a few words, and make something worth keeping.</Text><Button label="Choose photos" disabled={!!busy} onPress={() => pick(false)} /><Button label="Suggest from trip dates" kind="secondary" disabled={!!busy} onPress={() => pick(true)} /><Text style={[font.caption, { color: c.muted }]}>Suggestions use up to 300 accessible photos from your trip dates on this phone. Review them before saving.</Text></Card>
        {suggested && <Card style={{ padding: 20, borderRadius: 24, gap: 14 }}><Text style={[font.headline, { color: c.text }]}>Your selection · {suggested.length} photos</Text><Button label="Use these photos" disabled={!!busy} onPress={() => { void work('Saving photos…', () => acceptPhotos(suggested)); }} /><Button label="Discard selection" kind="secondary" onPress={() => { deletePhotos(store.accountId, trip.id, suggested); pendingPhotos.current = []; setSuggested(null); }} /></Card>}
        {trip.photos.length > 0 && !suggested && <Card>
          <Text style={[font.title, { color: c.text }]}>Make a memory video</Text>
          <Text style={[font.body, { color: c.muted }]}>Your favourite moments, a little motion, and a story to keep.</Text>
          {!editorReady ? <><Text style={[font.body, {color:c.muted}]}>{editorError || 'Getting the editor ready…'}</Text>{!!editorError && <Button label="Retry video editor" kind="secondary" onPress={() => { setEditorError(''); setCapabilityAttempt(n => n + 1); }} />}</> : <>
            <Text style={[font.headline, {color:c.text}]}>Choose a look</Text>
            <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{(['postcard','cinema','journal'] as const).map(theme => <Chip key={theme} label={theme[0].toUpperCase()+theme.slice(1)} selected={options.theme===theme} onPress={() => { if (!busy) setOptions({...options,theme}); }} />)}</View>
            <View style={{backgroundColor:options.theme==='cinema'?'#141a24':options.theme==='journal'?'#f4ecd7':'#f9f4ec',padding:24,borderRadius:16,gap:12}} accessible accessibilityLabel={`Opening preview: ${options.openingCaption.trim() || trip.title}, ${options.year}`}>
              <View style={{width:40,height:3,backgroundColor:options.theme==='cinema'?'#f1ebdb':'#2a4e4c'}} />
              <Text style={{fontSize:26,lineHeight:34,fontWeight:'700',color:options.theme==='cinema'?'#f1ebdb':'#2a4e4c',fontFamily:options.theme==='journal'?Platform.select({ios:'Georgia',android:'serif',default:'serif'}):undefined}}>{options.openingCaption.trim() || trip.title}</Text>
              <Text style={{fontSize:12,letterSpacing:2,color:options.theme==='cinema'?'#f1ebdb':'#2a4e4c'}}>TRAVEL MEMORIES · {options.year}</Text>
            </View>
            <View style={{gap:8}}><Text style={[font.caption,{color:c.muted}]}>Opening caption · optional</Text><TextInput accessibilityLabel="Opening caption" editable={!busy} value={options.openingCaption} onChangeText={openingCaption => setOptions({...options,openingCaption})} placeholder={trip.title} placeholderTextColor={c.faint} maxLength={120} multiline style={[font.body,{minHeight:56,padding:14,borderWidth:1,borderColor:c.border,borderRadius:14,color:c.text}]} /><Text style={[font.caption,{color:c.muted}]}>Leave blank to use your trip name and year.</Text></View>
            <Text style={[font.headline,{color:c.text}]}>Soundtrack</Text>
            <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{(['none','wander','sunset'] as const).map(soundtrack => <Chip key={soundtrack} label={soundtrack==='none'?'No music':soundtrack[0].toUpperCase()+soundtrack.slice(1)} selected={options.soundtrack===soundtrack} onPress={() => { if (!busy) { setOptions({...options,soundtrack,audio:undefined}); setMusicName(''); } }} />)}</View>
            <Text style={[font.caption,{color:c.muted}]}>Wander: light and playful. Sunset: soft and calm. Both are original, CC0 music.</Text>
            <Button label={options.soundtrack==='upload'?'Change uploaded music':'Upload your music'} kind="secondary" disabled={!!busy} onPress={() => { void work('Choosing music…', async () => { const music = await chooseMusic(); if (music && alive.current) { setOptions(current => ({...current,soundtrack:'upload',audio:music.data})); setMusicName(music.name); } }); }} />
            {!!musicName && <Text style={[font.caption,{color:c.text}]}>{musicName}</Text>}
            <Text style={[font.caption,{color:c.muted}]}>MP3, WAV, M4A or AAC · up to 3 MB. Use music you have permission to share. Audio loops or trims to fit, with a soft fade.</Text>
            <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}><Chip label="60 seconds" selected={seconds===60} onPress={() => { if (!busy) setSeconds(60); }} /><Chip label="90 seconds" selected={seconds===90} onPress={() => { if (!busy) setSeconds(90); }} /></View>
            {videoStage ? <View style={{ padding: 20, gap: 16, borderRadius: 20, backgroundColor: c.accentSoft, borderWidth: 1, borderColor: c.border }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <ActivityIndicator color={c.accent} accessible accessibilityRole="progressbar" accessibilityLabel={videoStage === 'preparing' ? 'Preparing your photos' : 'Creating your video'} />
                <View style={{ flex: 1, gap: 4 }}>
                  <Text accessibilityRole="header" style={[font.headline, { color: c.text }]}>Your memories, in motion</Text>
                  <Text accessibilityLiveRegion="polite" style={[font.caption, { color: c.muted }]}>{videoStage === 'preparing' ? 'Preparing your photos…' : 'Creating your video…'}</Text>
                </View>
              </View>
              <View style={{ gap: 10 }}>
                <Text style={[font.caption, { color: c.text }]}>{videoStage === 'preparing' ? '1 · Preparing photos' : '✓ Photos prepared'}</Text>
                <Text style={[font.caption, { color: videoStage === 'rendering' ? c.text : c.muted }]}>2 · Uploading & creating video</Text>
                <Text style={[font.caption, { color: c.muted }]}>3 · Preview ready to save & share</Text>
              </View>
              <Text style={[font.caption, { color: c.muted }]}>Keep Roamie open. Your preview will appear here when it is ready.</Text>
              <Button label="Cancel video" kind="secondary" onPress={() => controller.current?.abort()} />
            </View> : <Button label="Create memory video" disabled={!!busy || !!video} onPress={makeVideo} />}
            {!!videoNotice && <Text accessibilityRole="alert" style={[font.body, { color: c.text }]}>{videoNotice}</Text>}
          </>}
          {video && <><Text style={[font.headline,{color:c.text}]}>Your preview</Text><Text style={[font.caption,{color:c.muted}]}>Save this version, or discard it to make another.</Text><MemoryPlayer key={video} uri={video} disabled={!!busy} discard={() => { discardVideo(store.accountId,trip.id); setVideo(null); }} /><Button label="Save video to Photos" disabled={!!busy} onPress={() => { void work('Saving video…', async () => { await saveToPhotos(video); Alert.alert('Saved', 'Your memory is in Photos.'); }); }} /><Button label="Share video" kind="secondary" disabled={!!busy} onPress={() => { void work('Opening sharing…', () => shareFile(video, 'video/mp4')); }} /></>}
        </Card>}
        {photos.length > 0 && <View style={{ gap: 14 }}>
          <Text accessibilityRole="header" style={[font.headline, { color: c.text }]}>Your photos · {photos.length}</Text>
          <View style={{ gap: 12 }}>
            {Array.from({length:Math.ceil(photos.length / (width >= 380 && fontScale <= 1.3 ? 2 : 1))}, (_,row) => { const columns = width >= 380 && fontScale <= 1.3 ? 2 : 1; return <View key={row} style={{flexDirection:'row',gap:12}}>{photos.slice(row * columns, (row + 1) * columns).map((photo,offset) => { const i = row * columns + offset; return <Card key={photo.id} style={{ flex:1, minWidth:0, padding: 12, borderRadius: 20, gap: 10 }}>
              <Image source={photo.uri} contentFit="cover" style={{ width: '100%', aspectRatio: 1, borderRadius: 12 }} accessibilityLabel={photo.caption || `Trip photo ${i + 1}`} />
              <Text style={[font.caption, { color: c.muted }]}>Photo {i + 1}</Text>
              {!suggested && <>
                <TextInput accessibilityLabel={`Caption for photo ${i + 1}`} placeholder="Add a caption…" placeholderTextColor={c.faint} defaultValue={photo.caption} maxLength={100} multiline onEndEditing={event => { const caption = event.nativeEvent.text; void work('Saving caption…', () => store.save({ ...trip, photos: trip.photos.map(p => p.id === photo.id ? { ...p, caption } : p) })); }} style={[font.caption, { minHeight: 48, color: c.text, padding: 10, borderWidth: 1, borderColor: c.border, borderRadius: 12 }]} />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Move photo ${i + 1} earlier`} accessibilityState={{ disabled: i === 0 || !!busy }} disabled={i === 0 || !!busy} onPress={() => { const moved = [...trip.photos]; [moved[i - 1], moved[i]] = [moved[i], moved[i - 1]]; void work('Saving order…', () => store.save({ ...trip, photos: moved })); }} style={({ pressed }) => ({ flex: 1, minHeight: 48, borderRadius: 12, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center', opacity: i === 0 || busy ? 0.35 : pressed ? 0.7 : 1 })}><Icon name="arrow.left" size={18} color={c.accent} /></Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Remove photo ${i + 1}`} accessibilityState={{ disabled: !!busy }} disabled={!!busy} onPress={() => { void work('Removing photo…', () => acceptPhotos(trip.photos.filter(p => p.id !== photo.id))); }} style={({ pressed }) => ({ flex: 1, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.35 : pressed ? 0.7 : 1 })}><Icon name="trash" size={18} color={c.muted} /></Pressable>
                </View>
              </>}
            </Card>; })}{columns === 2 && photos.slice(row * columns, (row + 1) * columns).length === 1 && <View style={{flex:1,padding:12}} />}</View>; })}
          </View>
        </View>}
      </>}
      {(tab === 'calendar' || trip.photos.length > 0) && !suggested && <><Text style={[font.title, { color: c.text }]}>Made to keep. Made to share.</Text><TripMemoryCard ref={preview} trip={trip} day={day} album={tab === 'memories'} /><Button label={tab === 'calendar' ? 'Create itinerary PDF' : 'Create album PDF'} disabled={!!busy} onPress={exportPdf} /><Button label="Share this image" kind="secondary" disabled={!!busy} onPress={() => { void work('Making your share card…', shareCard); }} />{pdf && <Card style={{ padding: 20, borderRadius: 24, gap: 14 }}><Text style={{ color: c.text }}>Your PDF is saved in Roamie.</Text><Button label="Preview PDF" kind="secondary" onPress={() => { void work('Opening preview…', () => Print.printAsync({ uri: pdf })); }} /><Button label="Save or share PDF" onPress={() => { void work('Opening sharing…', () => shareFile(pdf, 'application/pdf')); }} /></Card>}</>}
    </ScrollView>
    {editor && <StopEditor key={editor === 'new' ? 'new' : editor.id} trip={trip} day={day} original={editor === 'new' ? undefined : editor} close={() => setEditor(null)} saved={store.save} />}
  </View>;
}
export default function Trips() {
  const store = useTrips(), c = useColors();
  const [selected, setSelected] = useState<string | null>(null), [creating, setCreating] = useState(false);
  const trip = store.trips.find(t => t.id === selected);
  if (!store.ready) return <Screen title="Your trips"><View style={{ padding: 24, gap: 16 }}><Text style={{ color: c.muted }}>{store.error ?? 'Opening your trips…'}</Text>{store.error && <Button label="Try again" onPress={store.reload} />}</View></Screen>;
  if (creating) return <NewTrip cancel={() => setCreating(false)} done={id => { setSelected(id); setCreating(false); }} />;
  if (trip) return <TripDetails key={trip.id} trip={trip} back={() => setSelected(null)} />;
  if (!store.trips.length) return <Screen title="Your trips" subtitle="Good days. Great memories.">
    <ScrollView contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingTop: 28, paddingBottom: TAB_CLEARANCE + 24, gap: 28 }}>
      <View style={{ backgroundColor: c.accentSoft, borderRadius: 28, padding: 28, gap: 24 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }}><Icon name="map" size={28} color={c.accent} /></View>
          <Text style={[font.overline, { color: c.accent, flex: 1 }]}>Your next chapter</Text>
        </View>
        <Text accessibilityRole="header" style={[font.largeTitle, { color: c.text, fontSize: 30 }]}>A little planning. A great adventure.</Text>
        <Text style={[font.body, { color: c.muted }]}>Bring your places, plans and favourite moments together.</Text>
        <Button label="Plan my first trip" onPress={() => setCreating(true)} />
      </View>
      <View style={{ gap: 24, paddingHorizontal: 4 }}>
        <Text accessibilityRole="header" style={[font.headline, { color: c.text }]}>From first stop to favourite memory</Text>
        {([
          ['mappin.and.ellipse', 'Make room for discovery', 'Choose your destinations and how long to stay.'],
          ['calendar', 'Give each day a little shape', 'Keep activities, meals and travel time in one itinerary.'],
          ['photo', 'Keep the moments that matter', 'Gather your trip photos into a personal album.'],
        ] as const).map(([icon, title, description]) => <View key={title} style={{ flexDirection: 'row', gap: 16, alignItems: 'flex-start' }}>
          <View style={{ padding: 12, borderRadius: 14, backgroundColor: c.surface }}><Icon name={icon} color={c.accent} /></View>
          <View style={{ flex: 1, gap: 5 }}><Text style={[font.headline, { color: c.text }]}>{title}</Text><Text style={[font.body, { color: c.muted }]}>{description}</Text></View>
        </View>)}
      </View>
    </ScrollView>
  </Screen>;
  return <Screen title="Your trips" subtitle="Good days. Great memories.">
    <FlatList data={store.trips} keyExtractor={t => t.id}
      contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: TAB_CLEARANCE + 24, gap: 20 }}
      ListHeaderComponent={<View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <Text style={[font.caption, { color: c.muted, flex: 1 }]}>{store.trips.length} {store.trips.length === 1 ? 'saved trip' : 'saved trips'}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="New trip" onPress={() => setCreating(true)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, paddingHorizontal: 16, borderRadius: 24, backgroundColor: c.accent, opacity: pressed ? 0.75 : 1 })}>
          <Icon name="plus" size={16} color={c.onAccent} /><Text style={[font.body, { color: c.onAccent, fontWeight: '600' }]}>New trip</Text>
        </Pressable>
      </View>}
      renderItem={({ item }) => {
        const destination = item.stays && item.stays.length > 1 ? item.stays.map(stay => stay.destination.name).join(' → ') : item.destinationDetails ? `${item.destinationDetails.name}, ${item.destinationDetails.country}` : item.destination;
        const date = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
        return <Card style={{ padding: 20, borderRadius: 24, gap: 18 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 14 }}>
            <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}><Icon name="map" size={22} color={c.accent} /></View>
            <View style={{ flex: 1, gap: 6 }}>
              <Text accessibilityRole="header" style={[font.title, { color: c.text }]}>{item.title}</Text>
              <Text style={[font.body, { color: c.muted }]}>{destination}</Text>
            </View>
          </View>
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Icon name="calendar" size={16} color={c.muted} />
              <Text style={[font.caption, { flex: 1, color: c.text }]}>{date(item.startDate)} – {date(item.endDate)}</Text>
            </View>
            <Text style={[font.caption, { color: c.muted, paddingLeft: 26 }]}>{item.days.length} {item.days.length === 1 ? 'day' : 'days'} · {item.photos.length ? `${item.photos.length} ${item.photos.length === 1 ? 'photo' : 'photos'}` : 'No photos yet'}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: c.border }}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.title}`} onPress={() => setSelected(item.id)} style={({ pressed }) => ({ flex: 1, minHeight: 48, paddingHorizontal: 14, borderRadius: 14, backgroundColor: c.accentSoft, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, opacity: pressed ? 0.7 : 1 })}>
              <Text style={[font.body, { color: c.accent, fontWeight: '600' }]}>View trip</Text><Icon name="chevron.right" size={14} color={c.accent} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${item.title}`} onPress={() => Alert.alert('Delete this local trip?', 'This removes its itinerary and Roamie photo copies. Originals in Photos and files you shared stay where they are.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => { void store.remove(item.id).then(() => { const folder = tripDirectory(store.accountId, item.id); if (folder.exists) folder.delete(); }).catch(() => Alert.alert('Could not finish deleting', 'Please try again. Some local copies may remain.')); } }])} style={({ pressed }) => ({ width: 48, minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
              <Icon name="trash" size={20} color={c.muted} />
            </Pressable>
          </View>
        </Card>;
      }} />
  </Screen>;
}
