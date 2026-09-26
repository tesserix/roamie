import * as Notifications from 'expo-notifications';
import { Alert } from 'react-native';
import { session } from './auth-client';

export async function signOut(): Promise<void> {
  const [credentials, notifications] = await Promise.allSettled([
    session.logout(),
    Notifications.cancelAllScheduledNotificationsAsync(),
  ]);
  if (credentials.status === 'rejected') {
    Alert.alert('Sign-out needs attention', 'We could not clear all sign-in data. Please try again.');
    return;
  }
  const details = [
    !credentials.value ? 'We could not confirm remote session revocation. It will expire according to the sign-in service policy.' : '',
    notifications.status === 'rejected' ? 'We could not cancel trip reminders. You can turn them off in your phone settings.' : '',
  ].filter(Boolean).join(' ');
  if (details) Alert.alert('Signed out on this phone', details);
}
