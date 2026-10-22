import { Alert, Linking, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from './ui';
import { font, radius, space, useColors } from '@/constants/theme';

export function ApplePaySetup({ home, tripCount, onClose }: { home: string; tripCount: number; onClose: () => void }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const steps = [
    ['Choose your cards', 'In Shortcuts, open Automation → + → Transaction (or Wallet). Select the cards you will use on your trip and the spending categories you want. Choose Run Immediately, then Next.'],
    ['Start a blank automation', 'On the next screen, choose Get Started or New Blank Automation. Labels vary by iOS version. You need an action that receives the transaction details.'],
    ['Add the Roamie action', 'Search actions for Roamie and choose Log card payment. Opening the app alone does not pass the payment details.'],
    ['Connect the transaction fields', 'Tap the Merchant field → Select Variable → Shortcut Input (sometimes labelled Transaction) → Merchant. Set Amount from that input’s Amount property and check its currency. Do not leave a fixed amount or Ask Each Time in the live automation.'],
    ['Save and check', 'Finish with Done or the back/checkmark control. Check that the automation says Run Immediately. Use a single automation for these cards to avoid recording the same tap twice.'],
  ];
  return <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top + space.sm }}>
      <View style={styles.heading}>
        <Text accessibilityRole="header" style={[font.title, { color: c.text, flex: 1 }]}>Track Apple Pay</Text>
        <Button label="Done" kind="secondary" onPress={onClose} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[font.body, { color: c.muted }]}>Shortcuts sends new Apple Pay transactions to Roamie. This does not connect to your bank or read your card number or statement history.</Text>
        <View style={[styles.card, { backgroundColor: c.surface }]}>
          <Text accessibilityRole="header" style={[font.headline, { color: c.text }]}>Before you start</Text>
          <Text style={[font.body, { color: c.muted }]}>{tripCount ? `${tripCount} saved ${tripCount === 1 ? 'trip' : 'trips'}. Payments are imported only when their date falls within a saved trip.` : 'Add a trip in Trips with the correct dates before testing. Payments outside saved trip dates are not added to your budget.'}</Text>
          <Text style={[font.caption, { color: c.muted }]}>Open Roamie while signed in to this account and let Budget load. Reopen Roamie after payments to import them. Currency conversion needs a connection; payments wait if rates are unavailable.</Text>
        </View>
        {steps.map(([title, body], index) => <View key={title} style={[styles.card, { backgroundColor: c.surface }]}>
          <Text accessibilityRole="header" style={[font.headline, { color: c.text }]}>{index + 1}. {title}</Text>
          <Text style={[font.body, { color: c.muted }]}>{body}</Text>
        </View>)}
        <View style={[styles.card, { backgroundColor: c.accentSoft }]}>
          <Text accessibilityRole="header" style={[font.headline, { color: c.text }]}>Try it without paying</Text>
          <Text style={[font.body, { color: c.text }]}>Create a separate regular shortcut using the same Roamie action. For a test trip that includes today, enter Merchant: Test cafe and Amount: 1.00 {home}. Tap Play, then reopen Roamie → Budget. It should appear once, including after another reopen.</Text>
          <Text style={[font.caption, { color: c.text }]}>This creates a test budget entry, not a card charge. Use transaction variables in your live automation, not these fixed test values.</Text>
        </View>
        <Text style={[font.caption, { color: c.muted }]}>If the action is missing, open the latest Roamie app once, then reopen Shortcuts and search again. Apple Pay taps require a physical iPhone; Wallet cards cannot be tested in the simulator.</Text>
      </ScrollView>
      <View style={{ padding: space.md, paddingBottom: Math.max(insets.bottom, space.md) }}>
        <Button label="Open Shortcuts" onPress={() => { void Linking.openURL('shortcuts://').catch(() => Alert.alert('Open Shortcuts manually', 'Open the Shortcuts app, choose Automation, then add a Transaction automation.')); }} />
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  heading: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.md },
  content: { padding: space.md, gap: space.md },
  card: { borderRadius: radius.lg, padding: space.md, gap: space.sm },
});
