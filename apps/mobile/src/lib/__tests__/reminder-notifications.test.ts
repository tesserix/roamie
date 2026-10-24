import { jest, test, expect, beforeEach } from '@jest/globals';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { activateReminderAccount, reconcileTripReminders, stopTripReminders, requestReminderAccess } from '../reminder-notifications';
import type { TripReminder } from '../trip-reminders';
jest.mock('expo-notifications',()=>({
 AndroidImportance:{DEFAULT:3}, AndroidNotificationVisibility:{PRIVATE:0}, SchedulableTriggerInputTypes:{DATE:'date'},
 setNotificationChannelAsync:jest.fn(async()=>{}), getPermissionsAsync:jest.fn(async()=>({granted:true,canAskAgain:true})), requestPermissionsAsync:jest.fn(async()=>({granted:true,canAskAgain:true})),
 getAllScheduledNotificationsAsync:jest.fn(async()=>[]), cancelScheduledNotificationAsync:jest.fn(async()=>{}), cancelAllScheduledNotificationsAsync:jest.fn(async()=>{}), dismissAllNotificationsAsync:jest.fn(async()=>{}), scheduleNotificationAsync:jest.fn(async()=> 'id'),
}));
jest.mock('../auth-client',()=>({session:{current:()=>({sub:'account'})}}));
const plan:TripReminder={tripId:'trip',kind:'start',title:'Trip today',body:'Ready',date:new Date(2099,0,1,8)};
beforeEach(()=>{jest.clearAllMocks();jest.mocked(Notifications.getAllScheduledNotificationsAsync).mockResolvedValue([]);jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({granted:true,canAskAgain:true} as never);activateReminderAccount('account');});
test('Android creates a visible private channel before requesting access',async()=>{
 const os=Platform.OS; Object.defineProperty(Platform,'OS',{value:'android',configurable:true});
 jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({granted:false,canAskAgain:true} as never);
 expect(await requestReminderAccess()).toBe(true);
 expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith('roamie-trips',expect.objectContaining({importance:3,lockscreenVisibility:0}));
 expect(jest.mocked(Notifications.setNotificationChannelAsync).mock.invocationCallOrder[0]).toBeLessThan(jest.mocked(Notifications.requestPermissionsAsync).mock.invocationCallOrder[0]);
 Object.defineProperty(Platform,'OS',{value:os,configurable:true});
});
test('does not prompt again when permission is permanently blocked',async()=>{
 jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({granted:false,canAskAgain:false} as never);
 expect(await requestReminderAccess()).toBe(false);
 expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
});
test('schedules dated notifications and keeps an unchanged schedule without duplicates',async()=>{
 await reconcileTripReminders('account',[plan]);
 const request=jest.mocked(Notifications.scheduleNotificationAsync).mock.calls[0][0];
 expect(request.trigger).toEqual({type:'date',date:plan.date,channelId:'roamie-trips'});
 jest.mocked(Notifications.getAllScheduledNotificationsAsync).mockResolvedValue([{identifier:request.identifier,content:request.content}] as never);
 await reconcileTripReminders('account',[plan]);
 expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
 await reconcileTripReminders('account',[]);
 expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(request.identifier);
});
test('denied access cancels obsolete reminders without prompting or scheduling',async()=>{
 jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({granted:false} as never);
 jest.mocked(Notifications.getAllScheduledNotificationsAsync).mockResolvedValue([{identifier:'roamie-trip:old'}] as never);
 await reconcileTripReminders('account',[plan]);
 expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('roamie-trip:old');
 expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
 expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
});
test('sign-out fences pending passes and cancels after in-flight scheduling completes',async()=>{
 let release!:()=>void;
 jest.mocked(Notifications.scheduleNotificationAsync).mockImplementationOnce(()=>new Promise(resolve=>{release=()=>resolve('id');}));
 const run=reconcileTripReminders('account',[plan,{...plan,tripId:'two'}]);
 for(let i=0;i<10&&!release;i++) await Promise.resolve();
 expect(release).toBeDefined();
 const stop=stopTripReminders(); release(); await Promise.all([run,stop]);
 expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
 expect(Notifications.cancelAllScheduledNotificationsAsync).toHaveBeenCalledTimes(1);
 await reconcileTripReminders('account',[plan]);
 expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
});

test('combines simultaneous reminders instead of silently dropping one',async()=>{
 await reconcileTripReminders('account',[{...plan,body:'Museum at 10:00'},{...plan,body:'Gallery at 10:00'}]);
 expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
 const content=jest.mocked(Notifications.scheduleNotificationAsync).mock.calls[0][0].content;
 expect(content.body).toContain('Museum at 10:00');
 expect(content.body).toContain('Gallery at 10:00');
});
