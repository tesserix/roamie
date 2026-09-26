import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { useColors } from '@/constants/theme';

export default function AppTabs() {
  const c = useColors();
  return (
    <NativeTabs tintColor={c.accent}>
      <NativeTabs.Trigger name="trips">
        <NativeTabs.Trigger.Label>Trips</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="calendar" md="calendar_month" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Translate</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="bubble.left.and.bubble.right.fill" md="translate" />
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
