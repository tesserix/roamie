import * as Notifications from 'expo-notifications';

import { format } from './money';

Notifications.setNotificationHandler({
  handleNotification: async notification => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: ['trip-reminder','group-reminder'].includes(String(notification.request.content.data?.kind)),
    shouldSetBadge: false,
  }),
});

export async function nudge(threshold: number, spent: number, budget: number, home: string) {
  const perm = await Notifications.requestPermissionsAsync();
  if (!perm.granted) return;
  const body =
    threshold >= 100
      ? `You've used your whole budget (${format(spent, home)} of ${format(budget, home)}).`
      : `You've used ${threshold}% of your budget. ${format(budget - spent, home)} left.`;
  await Notifications.scheduleNotificationAsync({ content: { title: 'Roamie budget', body }, trigger: null });
}
