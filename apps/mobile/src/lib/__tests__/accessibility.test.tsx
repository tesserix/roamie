import { expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Welcome from '../../components/welcome';
import { StoreProvider } from '../store';
import { AccessibilityProvider } from '../accessibility';
import { ProfileSettings } from '../../components/profile-settings';
jest.mock('@react-native-async-storage/async-storage', () => ({getItem:jest.fn(async()=>null),setItem:jest.fn(async()=>{})}));
jest.mock('expo-notifications',()=>({cancelAllScheduledNotificationsAsync:jest.fn(async()=>{})}));
jest.mock('react-native-safe-area-context',()=>({useSafeAreaInsets:()=>({top:0,bottom:0,left:0,right:0})}));
test('quiet translation and high contrast can be enabled and are remembered',async()=>{
 await render(<AccessibilityProvider><ProfileSettings /></AccessibilityProvider>);
 await fireEvent.press(screen.getByRole('button',{name:'Profile settings'}));
 await fireEvent(screen.getByRole('switch',{name:'Quiet translation'}),'valueChange',true);
 await fireEvent(screen.getByRole('switch',{name:'High contrast'}),'valueChange',true);
 expect(screen.getByRole('switch',{name:'Quiet translation'}).props.value).toBe(true);
 await waitFor(()=>expect(AsyncStorage.setItem).toHaveBeenLastCalledWith('roamie.accessibility.v1',JSON.stringify({quiet:true,highContrast:true,vibration:false})));
 await fireEvent.press(screen.getByRole('button',{name:'Done'}));
 expect(screen.queryByRole('switch',{name:'Quiet translation'})).toBeNull();
});

test('onboarding starts with language and keeps optional travel preferences behind one button',async()=>{
 await render(<AccessibilityProvider><StoreProvider accountId="test"><Welcome/></StoreProvider></AccessibilityProvider>);
 expect(screen.getByRole('button',{name:'Start exploring'})).toBeTruthy();
 expect(screen.queryByLabelText('Budget amount')).toBeNull();
 await fireEvent.press(screen.getByRole('button',{name:'Add budget and food preferences'}));
 expect(screen.getByLabelText('Budget amount')).toBeTruthy();
 expect(screen.getByRole('button',{name:'Vegan'})).toBeTruthy();
});

test('saved quiet and contrast preferences are restored on the next visit',async()=>{
 jest.mocked(AsyncStorage.getItem).mockResolvedValueOnce(JSON.stringify({quiet:true,highContrast:true}));
 await render(<AccessibilityProvider><ProfileSettings /></AccessibilityProvider>);
 await fireEvent.press(screen.getByRole('button',{name:'Profile settings'}));
 await waitFor(()=>expect(screen.getByRole('switch',{name:'High contrast'}).props.value).toBe(true));
 expect(screen.getByRole('switch',{name:'Quiet translation'}).props.value).toBe(true);
});

test('vibration is off by default and the opt-in is saved',async()=>{
 await render(<AccessibilityProvider><ProfileSettings /></AccessibilityProvider>);
 await fireEvent.press(screen.getByRole('button',{name:'Profile settings'}));
 expect(screen.getByRole('switch',{name:'Vibration feedback'}).props.value).toBe(false);
 await fireEvent(screen.getByRole('switch',{name:'Vibration feedback'}),'valueChange',true);
 await waitFor(()=>expect(AsyncStorage.setItem).toHaveBeenLastCalledWith('roamie.accessibility.v1',JSON.stringify({quiet:false,highContrast:false,vibration:true})));
});
