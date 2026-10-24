import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { session } from './auth-client';
import type { TripReminder } from './trip-reminders';

const PREFIX = 'roamie-trip:';
export const TRIP_CHANNEL = 'roamie-trips';
let account: string | null = null;
let generation = 0;
let tail: Promise<unknown> = Promise.resolve();
function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const run = tail.catch(() => {}).then(work);
  tail = run.catch(() => {});
  return run;
}
export function activateReminderAccount(value: string) {
  account = value;
  generation++;
}
async function channel() {
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync(TRIP_CHANNEL, {
    name: 'Trip reminders', importance: Notifications.AndroidImportance.DEFAULT,
    sound: 'default', lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
}
export async function requestReminderAccess(): Promise<boolean> {
  await channel();
  const permission = await Notifications.getPermissionsAsync();
  if (permission.granted) return true;
  if (!permission.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}
export function stopTripReminders(): Promise<void> {
  account = null;
  generation++;
  return enqueue(async () => {
    await Notifications.cancelAllScheduledNotificationsAsync();
    await Notifications.dismissAllNotificationsAsync();
  });
}
export function reconcileTripReminders(owner: string, plans: TripReminder[]): Promise<number> {
  const expected = generation;
  const active = () => account === owner && generation === expected && session.current()?.sub === owner;
  return enqueue(async () => {
    if (!active() || Platform.OS === 'web') return 0;
    await channel();
    const permission = await Notifications.getPermissionsAsync();
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    const otherCount = pending.filter(item => !item.identifier.startsWith(PREFIX)).length;
    const desired = new Map((permission.granted ? plans : []).slice(0, Math.max(0, 60 - otherCount)).map(plan => {
      const signature = JSON.stringify([plan.title, plan.body, plan.date.getTime()]);
      const identifier = `${PREFIX}${encodeURIComponent(owner)}:${encodeURIComponent(plan.tripId)}:${plan.kind}:${plan.date.getTime()}`;
      return [identifier, {plan, signature}];
    }));
    const existing = new Map(pending.map(item => [item.identifier, item]));
    for (const item of pending) {
      if (!active()) return 0;
      if (item.identifier.startsWith(PREFIX) && (!desired.has(item.identifier) || item.content.data?.signature !== desired.get(item.identifier)?.signature)) {
        await Notifications.cancelScheduledNotificationAsync(item.identifier);
        existing.delete(item.identifier);
      }
    }
    for (const [identifier, {plan, signature}] of desired) {
      if (!active()) return 0;
      if (existing.has(identifier) || plan.date.getTime() <= Date.now()) continue;
      await Notifications.scheduleNotificationAsync({
        identifier,
        content: {title: plan.title, body: plan.body, sound: 'default', data: {kind: plan.groupId ? 'group-reminder' : 'trip-reminder', accountId: owner, tripId: plan.tripId, ...(plan.groupId ? {groupId:plan.groupId} : {}), reminder: plan.kind, signature}},
        trigger: {type: Notifications.SchedulableTriggerInputTypes.DATE, date: plan.date, channelId: TRIP_CHANNEL},
      });
    }
    return desired.size;
  });
}
