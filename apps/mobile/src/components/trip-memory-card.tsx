import { forwardRef } from 'react';
import { Image } from 'expo-image';
import { Platform, Text, View } from 'react-native';
import { format } from '@/lib/money';
import type { Trip } from '@/lib/trips';
const serif = Platform.OS === 'ios' ? 'Georgia' : 'serif';
export const TripMemoryCard = forwardRef<View, { trip: Trip; day: number; album?: boolean }>(function TripMemoryCard({ trip, day, album }, ref) {
  const current = trip.days[day];
  return <View ref={ref} collapsable={false} style={{ backgroundColor: '#f8f2fa', borderColor: '#d9c7e6', borderWidth: 1, padding: 24, gap: 18, borderRadius: 18 }}>
    <Text style={{ color: '#826797', fontSize: 10, letterSpacing: 3 }}>ROAMIE · {album ? 'COLLECTED MOMENTS' : `DAY ${day + 1}`}</Text>
    <Text style={{ color: '#674783', fontSize: 32, fontFamily: serif }}>{trip.title}</Text>
    <Text style={{ color: '#766780', fontSize: 13 }}>{trip.destination} · {album ? `${trip.startDate} — ${trip.endDate}` : current.date}</Text>
    {album ? <View style={{gap:12}}>{Array.from({length:Math.ceil(trip.photos.length/2)}, (_,row) => <View key={row} style={{flexDirection:'row',gap:12}}>{trip.photos.slice(row*2,row*2+2).map((p,offset) => <View key={p.id} style={{flex:1,minWidth:0,padding:6,borderRadius:12,backgroundColor:'white',gap:6}}><Image source={p.uri} style={{width:'100%',aspectRatio:1,borderRadius:8}} contentFit="cover" accessibilityLabel={p.caption || `Memory ${row*2+offset+1}`} />{!!p.caption && <Text style={{color:'#4d3c5d',fontSize:12,lineHeight:18}}>{p.caption}</Text>}</View>)}{row*2+1 >= trip.photos.length && <View style={{flex:1,padding:6}} />}</View>)}</View> : current.stops.map(stop => <View key={stop.id} style={{ backgroundColor: 'white', borderRadius: 12, padding: 14, gap: 5 }}><Text style={{ color: '#a07bb4', fontSize: 12 }}>{stop.time} · {stop.minutes} MIN</Text><Text style={{ color: '#4d3c5d', fontFamily: serif, fontSize: 20 }}>{stop.title}</Text><Text style={{ color: '#796c80', fontSize: 12 }}>{stop.note}</Text><Text style={{ color: '#79528e', fontSize: 12 }}>{stop.costUnknown ? 'Cost not verified' : `Est. ${format(stop.costMinor, trip.currency)}`}</Text></View>)}
    <Text style={{ color: '#947da4', fontFamily: serif, fontSize: 16, fontStyle: 'italic' }}>A little adventure. A lot to remember.</Text>
    {!album && <Text style={{ color: '#8b7c91', fontSize: 10 }}>Estimates only. Confirm hours, fares and food needs.</Text>}
  </View>;
});
