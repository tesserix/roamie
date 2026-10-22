import { expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Welcome from '../../components/welcome';
import { StoreProvider } from '../store';
import { AccessibilityProvider } from '../accessibility';
import { ProfileSettings } from '../../components/profile-settings';
import { StyleSheet } from 'react-native';
jest.mock('@react-native-async-storage/async-storage', () => ({getItem:jest.fn(async()=>null),setItem:jest.fn(async()=>{})}));
jest.mock('expo-notifications',()=>({cancelAllScheduledNotificationsAsync:jest.fn(async()=>{})}));
jest.mock('react-native-safe-area-context',()=>({useSafeAreaInsets:()=>({top:0,bottom:0,left:0,right:0})}));
test('display preview resizes immediately and normal text ignores phone text scaling', async () => {
 await render(<AccessibilityProvider><ProfileSettings /></AccessibilityProvider>);
 await fireEvent.press(screen.getByRole('button', {name: 'Profile settings'}));
 const preview = () => screen.getByText('Your next adventure, made simple.');
 await fireEvent.press(screen.getByRole('radio', {name: 'Large text'}));
 expect(StyleSheet.flatten(preview().props.style).fontSize).toBeCloseTo(19.2);
 expect(preview().props.allowFontScaling).toBe(false);
 await fireEvent.press(screen.getByRole('radio', {name: 'Compact text'}));
 expect(StyleSheet.flatten(preview().props.style).fontSize).toBeCloseTo(14.4);
 await fireEvent.press(screen.getByRole('radio', {name: 'Normal text'}));
 expect(StyleSheet.flatten(preview().props.style).fontSize).toBe(16);
 expect(preview().props.allowFontScaling).toBe(false);
 await fireEvent.press(screen.getByRole('radio', {name: 'Phone text size'}));
 expect(preview().props.allowFontScaling).not.toBe(false);
});
test('display size can be changed and reset without resetting sound preferences', async () => {
 await render(<AccessibilityProvider><ProfileSettings /></AccessibilityProvider>);
 await fireEvent.press(screen.getByRole('button', {name: 'Profile settings'}));
 await fireEvent(screen.getByRole('switch', {name: 'Quiet translation'}), 'valueChange', true);
 await fireEvent.press(screen.getByRole('radio', {name: 'Large text'}));
 expect(screen.getByRole('radio', {name: 'Large text'}).props.accessibilityState.checked).toBe(true);
 await fireEvent.press(screen.getByRole('radio', {name: 'Dark appearance'}));
 await fireEvent(screen.getByRole('switch', {name: 'High contrast'}), 'valueChange', true);
 await fireEvent.press(screen.getByRole('button', {name: 'Reset display to normal'}));
 expect(screen.getByRole('radio', {name: 'Normal text'}).props.accessibilityState.checked).toBe(true);
 expect(screen.getByRole('radio', {name: 'Phone appearance'}).props.accessibilityState.checked).toBe(true);
 expect(screen.getByRole('switch', {name: 'High contrast'}).props.value).toBe(false);
 expect(StyleSheet.flatten(screen.getByText('Your next adventure, made simple.').props.style).color).toBe('#0B2545');
 expect(screen.getByRole('switch', {name: 'Quiet translation'}).props.value).toBe(true);
 await waitFor(() => {
   const last = jest.mocked(AsyncStorage.setItem).mock.calls.at(-1);
   expect(JSON.parse(last![1])).toMatchObject({textSize: 'normal', appearance: 'system', quiet: true, highContrast: false});
 });
});
test('quiet translation and high contrast can be enabled and are remembered',async()=>{
 await render(<AccessibilityProvider><ProfileSettings /></AccessibilityProvider>);
 await fireEvent.press(screen.getByRole('button',{name:'Profile settings'}));
 await fireEvent(screen.getByRole('switch',{name:'Quiet translation'}),'valueChange',true);
 await fireEvent(screen.getByRole('switch',{name:'High contrast'}),'valueChange',true);
 expect(screen.getByRole('switch',{name:'Quiet translation'}).props.value).toBe(true);
 await waitFor(()=>expect(AsyncStorage.setItem).toHaveBeenLastCalledWith('roamie.accessibility.v1',JSON.stringify({quiet:true,highContrast:true,vibration:false,voice:'match',textSize:'system',appearance:'system'})));
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

test('saved display choices restore and unsupported choices fall back to phone settings', async () => {
 jest.mocked(AsyncStorage.getItem).mockResolvedValueOnce(JSON.stringify({textSize: 'normal', appearance: 'dark'}));
 const first = await render(<AccessibilityProvider><ProfileSettings /></AccessibilityProvider>);
 await fireEvent.press(screen.getByRole('button', {name: 'Profile settings'}));
 await waitFor(() => expect(screen.getByRole('radio', {name: 'Normal text'}).props.accessibilityState.checked).toBe(true));
 expect(screen.getByRole('radio', {name: 'Dark appearance'}).props.accessibilityState.checked).toBe(true);
 expect(StyleSheet.flatten(screen.getByText('Your next adventure, made simple.').props.style).color).toBe('#EEF4FA');
 await first.unmount();
 jest.mocked(AsyncStorage.getItem).mockResolvedValueOnce(JSON.stringify({textSize: 'huge', appearance: 'sepia'}));
 await render(<AccessibilityProvider><ProfileSettings /></AccessibilityProvider>);
 await fireEvent.press(screen.getByRole('button', {name: 'Profile settings'}));
 expect(screen.getByRole('radio', {name: 'Phone text size'}).props.accessibilityState.checked).toBe(true);
 expect(screen.getByRole('radio', {name: 'Phone appearance'}).props.accessibilityState.checked).toBe(true);
});

test('translation voice matches the speaker by default and a fixed choice is saved',async()=>{
 await render(<AccessibilityProvider><ProfileSettings /></AccessibilityProvider>);
 await fireEvent.press(screen.getByRole('button',{name:'Profile settings'}));
 expect(screen.getByRole('radio',{name:'Match speaker'}).props.accessibilityState.checked).toBe(true);
 await fireEvent.press(screen.getByRole('radio',{name:'Male'}));
 expect(screen.getByRole('radio',{name:'Male'}).props.accessibilityState.checked).toBe(true);
 await waitFor(()=>expect(AsyncStorage.setItem).toHaveBeenLastCalledWith('roamie.accessibility.v1',JSON.stringify({quiet:false,highContrast:false,vibration:false,voice:'male',textSize:'system',appearance:'system'})));
});

test('vibration is off by default and the opt-in is saved',async()=>{
 await render(<AccessibilityProvider><ProfileSettings /></AccessibilityProvider>);
 await fireEvent.press(screen.getByRole('button',{name:'Profile settings'}));
 expect(screen.getByRole('switch',{name:'Vibration feedback'}).props.value).toBe(false);
 await fireEvent(screen.getByRole('switch',{name:'Vibration feedback'}),'valueChange',true);
 await waitFor(()=>expect(AsyncStorage.setItem).toHaveBeenLastCalledWith('roamie.accessibility.v1',JSON.stringify({quiet:false,highContrast:false,vibration:true,voice:'match',textSize:'system',appearance:'system'})));
});
