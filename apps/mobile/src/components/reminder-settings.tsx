import { Alert, Linking, Switch, View } from 'react-native';
import { Text } from './typography';
import { Button } from './ui';
import { font, radius, space, useColors } from '@/constants/theme';
import { useReminders } from '@/lib/reminder-provider';

export function ReminderSettings() {
  const reminders = useReminders(), c = useColors();
  if (!reminders) return null;
  return <View style={{gap:space.md}}>
    <Text accessibilityRole="header" style={[font.headline,{color:c.text}]}>Trip notifications</Text>
    <Text style={[font.body,{color:c.muted}]}>Choose useful reminders for this phone. Scheduled reminders can arrive offline or with Roamie closed. Times use your phone’s timezone when scheduled; Focus and battery settings may delay them.</Text>
    <View style={{borderRadius:radius.lg,backgroundColor:c.surface,borderWidth:1,borderColor:c.border}}>
      {([
        ['documents','Documents and bookings','6 pm seven days before departure: review entry requirements, passport validity, insurance and bookings.'],
        ['expenses','Evening expense check-in','8 pm each trip day: record expenses and receipts, then review your budget.'],
        ['preparation','Before you travel','6 pm the day before departure: essentials and offline downloads.'],
        ['balances','Shared balance reminders','6 pm for seven days after viewing an unsettled group. Open the reminder for current amounts and repayments.'],
        ['visits','Planned visits','30 minutes before each saved place or activity. Allow extra time for travel.'],
        ['weather','Weather forecasts','Forecasts from your latest trip weather check, labelled with their check time and no more than 24 hours old.'],
        ['agenda','Daily itinerary','7 am on trip days with saved activities.'],
        ['complete','After your trip','9 am the day after returning: expenses and memories.'],
        ['start','Trip starts','8 am on your departure day.'],
        ['packing','Pack before returning','6 pm the evening before your trip ends.'],
      ] as const).map(([kind,label,description],index)=><View key={kind} style={{padding:space.md,gap:6,borderTopWidth:index?1:0,borderTopColor:c.border}}>
        <View style={{flexDirection:'row',alignItems:'center',gap:space.md}}>
          <Text style={[font.headline,{color:c.text,flex:1}]}>{label}</Text>
          <Switch accessibilityLabel={label} accessibilityHint={description} value={reminders.preferences[kind]} disabled={!reminders.ready||reminders.busy} onValueChange={value=>void reminders.update(kind,value)} trackColor={{false:c.faint,true:c.accent}} />
        </View>
        <Text style={[font.body,{color:c.muted}]}>{description}</Text>
      </View>)}
    </View>
    <Text style={[font.caption,{color:c.muted}]}>{reminders.count} upcoming reminders scheduled (up to 40 trip notices and 60 total). Open Roamie after changing timezones to refresh your schedule.</Text>
    {reminders.error?<Text accessibilityRole="alert" style={[font.body,{color:c.danger}]}>{reminders.error}</Text>:null}
    <Button label="Open notification settings" kind="secondary" onPress={()=>void Linking.openSettings().catch(()=>Alert.alert('Could not open Settings', 'Open your phone settings and choose Roamie → Notifications.'))}/>
    {reminders.error?<Button label="Retry reminders" kind="secondary" onPress={reminders.retry}/>:null}
  </View>;
}
