import { Vibration } from 'react-native';

export function signalFeedback(enabled: boolean) {
  if (enabled) Vibration.vibrate(80, false);
}
