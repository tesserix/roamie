import { beforeEach, expect, jest, test } from '@jest/globals';
import { render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { createTrip, tripStorageKey } from '../trips';
import { TripsProvider } from '../trip-store';
import AppTabs from '../../components/app-tabs';

const mockReplace = jest.fn();
const tabs = () => <TripsProvider accountId="traveller"><AppTabs /></TripsProvider>;
jest.mock('expo-notifications',()=>({useLastNotificationResponse:jest.fn(()=>null),clearLastNotificationResponseAsync:jest.fn(async()=>{})}));
let mockNavigation: { key: string } | undefined;
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useRootNavigationState: () => mockNavigation,
}));
jest.mock('expo-router/unstable-native-tabs', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const Trigger = Object.assign(View, { Label: () => null, Icon: () => null });
  return { NativeTabs: Object.assign((props: object) => <View {...props} />, { Trigger }) };
});
jest.mock('../../constants/theme', () => ({ useColors: () => ({ accent: '#0066aa' }) }));

beforeEach(async () => { await AsyncStorage.clear(); jest.clearAllMocks(); jest.mocked(Notifications.useLastNotificationResponse).mockReturnValue(null); mockNavigation = { key: 'signed-in-tabs' }; });

test('a newly authenticated or restored session lands on Translate once', async () => {
  const view = await render(tabs());
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
  expect(mockReplace).toHaveBeenCalledTimes(1);
  mockNavigation = { key: 'traveller-selected-budget' };
  await view.rerender(tabs());
  expect(mockReplace).toHaveBeenCalledTimes(1);
});

test('waits for the navigator before opening Translate', async () => {
  mockNavigation = undefined;
  const view = await render(tabs());
  expect(mockReplace).not.toHaveBeenCalled();
  mockNavigation = { key: 'ready' };
  await view.rerender(tabs());
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
});

test('a later sign-in opens Translate again', async () => {
  const first = await render(tabs());
  await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
  await first.unmount();
  await render(tabs());
  await waitFor(() => expect(mockReplace).toHaveBeenNthCalledWith(2, '/'));
});

test('waits for saved trips and opens a cold-start reminder only once', async () => {
 const trip=createTrip({title:'Kyoto',destination:'Kyoto',startDate:'2026-11-05',endDate:'2026-11-07',currency:'JPY',budgetMinor:0,travellers:1,diet:'none',interests:''});
 await AsyncStorage.setItem(tripStorageKey('traveller'),JSON.stringify([trip]));
 jest.mocked(Notifications.useLastNotificationResponse).mockReturnValue({actionIdentifier:'default',notification:{date:1,request:{identifier:'notice',content:{data:{kind:'trip-reminder',accountId:'traveller',tripId:trip.id}}}}} as never);
 await render(tabs());
 await waitFor(()=>expect(mockReplace).toHaveBeenCalledWith({pathname:'/trips',params:{reminderTrip:trip.id}}));
 expect(mockReplace).toHaveBeenCalledTimes(1);
 expect(Notifications.clearLastNotificationResponseAsync).toHaveBeenCalledTimes(1);
});
