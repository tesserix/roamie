import { expect, jest, test } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import { TripsProvider, useTrips } from '../trip-store';
import { createTrip, tripStorageKey } from '../trips';
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn() }));
function Library() {
 const store=useTrips();
 return <><Text>{store.ready ? store.trips.map(t=>t.title).join(',') || 'No trips' : store.error ?? 'Loading'}</Text><Pressable accessibilityRole="button" accessibilityLabel="Save trip" onPress={()=>{void store.save(createTrip({title:'New trip',destination:'Tokyo',startDate:'2026-09-11',endDate:'2026-09-11',currency:'JPY',budgetMinor:0,diet:'none',interests:'',travellers:1}));}}><Text>Save trip</Text></Pressable></>;
}
test('trips stay with their account when switching and saving',async()=>{
 const trip=createTrip({title:'Alice Japan',destination:'Tokyo',startDate:'2026-09-11',endDate:'2026-09-11',currency:'JPY',budgetMinor:0,diet:'none',interests:'',travellers:1});
 const data=new Map([[tripStorageKey('alice'),JSON.stringify([trip])]]);
 jest.mocked(AsyncStorage.getItem).mockImplementation(async key=>data.get(key)??null);
 jest.mocked(AsyncStorage.setItem).mockImplementation(async(key,value)=>{data.set(key,value);});
 const view=await render(<TripsProvider key="alice" accountId="alice"><Library/></TripsProvider>);
 expect(await screen.findByText('Alice Japan')).toBeTruthy();
 await view.rerender(<TripsProvider key="bob" accountId="bob"><Library/></TripsProvider>);
 expect(await screen.findByText('No trips')).toBeTruthy();
 await fireEvent.press(screen.getByRole('button',{name:'Save trip'}));
 expect(await screen.findByText('New trip')).toBeTruthy();
 expect(data.get(tripStorageKey('bob'))).not.toContain('Alice Japan');
 expect(data.get(tripStorageKey('alice'))).toContain('Alice Japan');
});
test('corrupt storage is preserved and offers recovery without overwrite',async()=>{
 jest.mocked(AsyncStorage.getItem).mockResolvedValue('{broken');jest.mocked(AsyncStorage.setItem).mockClear();
 await render(<TripsProvider accountId="bad"><Library/></TripsProvider>);
 expect(await screen.findByText(/could not open your saved trips/i)).toBeTruthy();
 expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});
test('an incomplete saved calendar cannot open a crashing trip screen',async()=>{
 jest.mocked(AsyncStorage.getItem).mockResolvedValue(JSON.stringify([{id:'broken',days:[],photos:[]} ]));
 jest.mocked(AsyncStorage.setItem).mockClear();
 await render(<TripsProvider accountId="incomplete"><Library/></TripsProvider>);
 expect(await screen.findByText(/could not open your saved trips/i)).toBeTruthy();
 expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});
