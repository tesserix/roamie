import { jest, test, expect, beforeEach } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, renderHook, act, screen, fireEvent, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { TripsProvider } from '../trip-store';
import { createTrip } from '../trips';
import { RemindersProvider, useReminders } from '../reminder-provider';
import { ReminderSettings } from '../../components/reminder-settings';
jest.mock('../auth-client',()=>({session:{current:()=>({sub:'account'})}}));
jest.mock('expo-notifications',()=>({
 AndroidImportance:{DEFAULT:3}, AndroidNotificationVisibility:{PRIVATE:0}, SchedulableTriggerInputTypes:{DATE:'date'},
 setNotificationChannelAsync:jest.fn(async()=>{}), getPermissionsAsync:jest.fn(async()=>({granted:false,canAskAgain:false})), requestPermissionsAsync:jest.fn(async()=>({granted:false,canAskAgain:false})),
 getAllScheduledNotificationsAsync:jest.fn(async()=>[]),cancelScheduledNotificationAsync:jest.fn(async()=>{}),cancelAllScheduledNotificationsAsync:jest.fn(async()=>{}),dismissAllNotificationsAsync:jest.fn(async()=>{}),scheduleNotificationAsync:jest.fn(async()=> 'id'),
}));
beforeEach(async()=>{await AsyncStorage.clear();jest.clearAllMocks();jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({granted:false,canAskAgain:false} as never);});
const app=()=>render(<TripsProvider accountId="account"><RemindersProvider><ReminderSettings /></RemindersProvider></TripsProvider>);
test('explains blocked permission and does not persist an enabled switch',async()=>{
 await app();
 await waitFor(()=>expect(screen.getByLabelText('Trip starts').props.disabled).toBe(false));
 await fireEvent(screen.getByLabelText('Trip starts'),'valueChange',true);
 expect(await screen.findByText(/Notifications are off/)).toBeTruthy();
 expect(screen.getByRole('button',{name:'Open notification settings'})).toBeTruthy();
 expect(screen.getByLabelText('Trip starts').props.value).toBe(false);
 expect(await AsyncStorage.getItem('roamie.reminders.v1.account')).toBeNull();
});
test('persists enabled reminders and restores them on remount without another prompt',async()=>{
 jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({granted:true,canAskAgain:true} as never);
 const first=await app();
 await waitFor(()=>expect(screen.getByLabelText('Trip starts').props.disabled).toBe(false));
 await fireEvent(screen.getByLabelText('Trip starts'),'valueChange',true);
 await waitFor(()=>expect(screen.getByLabelText('Trip starts').props.value).toBe(true));
 expect(JSON.parse((await AsyncStorage.getItem('roamie.reminders.v1.account'))!).start).toBe(true);
 await first.unmount(); await app();
 await waitFor(()=>expect(screen.getByLabelText('Trip starts').props.value).toBe(true));
 expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
});

test('persists a checked forecast without overwriting personal balance reminders', async () => {
 const key='roamie.reminders.v1.account';
 const balance={groupId:'friends',title:'Friends',checkedAt:new Date().toISOString()};
 await AsyncStorage.setItem(key,JSON.stringify({weather:true}));
 await AsyncStorage.setItem(key+'.balances',JSON.stringify({friends:balance}));
 const view=await renderHook(()=>useReminders(),{wrapper:({children})=><TripsProvider accountId="account"><RemindersProvider>{children}</RemindersProvider></TripsProvider>});
 await waitFor(()=>expect(view.result.current?.ready).toBe(true));
 const now=new Date(),date=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
 const trip=createTrip({title:'Kyoto',destination:'Kyoto',startDate:date,endDate:date,currency:'JPY',budgetMinor:0,travellers:1,diet:'none',interests:''});
 await act(async()=>view.result.current!.rememberWeather(trip,[{destination:'Kyoto',start:date,end:date,weather:{profile_revision:'r',response:{status:'ok',limitations:[],recommendations:[{id:'weather',name:'Forecast',source_url:'https://open-meteo.com/',observed_at:now.toISOString(),weather:{coverage:'forecast',local_date:date,minimum_celsius:12,maximum_celsius:20,precipitation_percent:50,missing_dates:[],suggestions:[]}}]}}}]));
 const saved=JSON.parse((await AsyncStorage.getItem(key+'.weather'))!);
 expect(saved[trip.id][0].body).toContain('12–20°C');
 expect(view.result.current!.error).toBe('');
 expect(view.result.current!.groupIds).toEqual(['friends']);
 expect(JSON.parse((await AsyncStorage.getItem(key+'.balances'))!)).toEqual({friends:balance});
});
