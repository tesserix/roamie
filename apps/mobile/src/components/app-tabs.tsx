import { useRootNavigationState, useRouter } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { useTrips } from '@/lib/trip-store';
import { useReminders } from '@/lib/reminder-provider';
import { reminderTripTarget, reminderGroupTarget } from '@/lib/reminder-target';

import { useColors } from '@/constants/theme';

export default function AppTabs() {
  const c = useColors();
  const router = useRouter();
  const navigation = useRootNavigationState();
  const landed = useRef(false), handledResponse = useRef<string | null>(null);
  const reminders = useReminders();
  const response = Notifications.useLastNotificationResponse();
  const {trips, ready: tripsReady, accountId} = useTrips();
  useEffect(() => {
    if (!navigation?.key || !tripsReady) return;
    if (response?.notification.request.content.data?.kind === 'group-reminder' && reminders && !reminders.ready) return;
    const responseKey = response ? `${response.notification.request.identifier}:${response.actionIdentifier}:${response.notification.date}` : null;
    const fresh = response && responseKey !== handledResponse.current;
    const data = fresh ? response.notification.request.content.data : null;
    const target = reminderTripTarget(data, accountId, trips);
    const group = reminderGroupTarget(data, accountId, reminders?.groupIds ?? []);
    if (target) {
      landed.current = true;
      router.replace({pathname:'/trips',params:{reminderTrip:target}});
    } else if (group) {
      landed.current = true;
      router.replace({pathname:'/wallet',params:{reminderGroup:group}});
    } else if (!landed.current) {
      landed.current = true;
      router.replace('/');
    }
    if (fresh) { handledResponse.current = responseKey; void Notifications.clearLastNotificationResponseAsync().catch(() => {}); }
  }, [navigation?.key, router, response, trips, tripsReady, accountId, reminders]);
  return (
    <NativeTabs tintColor={c.accent}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Translate</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="bubble.left.and.bubble.right.fill" md="translate" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="trips">
        <NativeTabs.Trigger.Label>Trips</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="calendar" md="calendar_month" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="wallet">
        <NativeTabs.Trigger.Label>Budget</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="wallet.pass.fill" md="account_balance_wallet" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="nearby">
        <NativeTabs.Trigger.Label>Nearby</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="fork.knife" md="restaurant" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="sos">
        <NativeTabs.Trigger.Label>Help</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="sos" md="emergency" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
