import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';
import { useEffect, useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button, Chip, Message, Screen } from '@/components/ui';
import { radius, space, touch, useColors } from '@/constants/theme';
import { ApiError, fxRates, readReceipt } from '@/lib/api';
import { crossed, decimals, format, toHome, toMinor } from '@/lib/money';
import { useStore } from '@/lib/store';

const CATEGORIES = ['food', 'stay', 'transport', 'activities', 'shopping', 'other'] as const;
const LABEL: Record<string, string> = {
  food: 'Food',
  stay: 'Stay',
  transport: 'Transport',
  activities: 'Activities',
  shopping: 'Shopping',
  other: 'Other',
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export default function Wallet() {
  const c = useColors();
  const { profile, expenses, addExpense, removeExpense, clearAll } = useStore();
  const home = profile!.homeCurrency;
  const budget = profile!.budgetMinor;

  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(expenses[0]?.currency ?? home);
  const [category, setCategory] = useState<string>('food');
  const [note, setNote] = useState('');
  const [rates, setRates] = useState<Record<string, number> | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fxRates(home)
      .then((r) => setRates(r.rates))
      .catch(() => setRates(null));
  }, [home]);

  const spent = expenses.reduce((sum, e) => sum + e.homeMinor, 0);
  const pct = budget > 0 ? Math.min(spent / budget, 1) : 0;
  const barColor = pct >= 1 ? c.danger : pct >= 0.8 ? c.warn : c.accent;

  async function add() {
    setError(null);
    const minor = toMinor(amount, currency);
    if (!minor) {
      setError('Enter an amount, like 12.50.');
      return;
    }
    const homeMinor = rates ? toHome(minor, currency, home, rates) : currency === home ? minor : null;
    if (homeMinor === null) {
      setError(`Can't convert ${currency} right now. Check the code or your connection.`);
      return;
    }
    addExpense({ amountMinor: minor, currency, homeMinor, category, note: note.trim() });
    setAmount('');
    setNote('');
    const hit = crossed(spent, spent + homeMinor, budget);
    if (hit) await nudge(hit, spent + homeMinor, budget, home);
  }

  async function scan() {
    setError(null);
    const camera = await ImagePicker.requestCameraPermissionsAsync();
    const options: ImagePicker.ImagePickerOptions = { base64: true, quality: 0.5, mediaTypes: ['images'] };
    let picked: ImagePicker.ImagePickerResult;
    try {
      picked = camera.granted
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
    } catch {
      picked = await ImagePicker.launchImageLibraryAsync(options);
    }
    const asset = picked.canceled ? null : picked.assets[0];
    if (!asset?.base64) return;
    setScanning(true);
    try {
      const r = await readReceipt(asset.base64, asset.mimeType ?? 'image/jpeg', currency);
      if (r.currency) setCurrency(r.currency);
      if (r.amountMinor !== null && r.currency) setAmount(String(r.amountMinor / 10 ** decimals(r.currency)));
      setCategory(r.category);
      setNote(r.merchant);
      if (r.amountMinor === null) setError("Couldn't read the total. Type it in and tap Add.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't read that receipt. Type it in instead.");
    } finally {
      setScanning(false);
    }
  }

  function confirmReset() {
    Alert.alert('Start over?', 'This deletes your budget, expenses and settings from this phone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete my data', style: 'destructive', onPress: () => clearAll() },
    ]);
  }

  const header = (
    <View style={{ gap: space.md, paddingBottom: space.md }}>
      <View style={[styles.card, { backgroundColor: c.card }]}>
        <Text style={{ color: c.muted, fontSize: 15 }}>{budget > 0 ? 'Spent of your trip budget' : 'Spent so far'}</Text>
        <Text style={{ color: c.text, fontSize: 34, fontWeight: '800' }}>
          {format(spent, home)}
          {budget > 0 ? <Text style={{ color: c.muted, fontSize: 20, fontWeight: '600' }}> / {format(budget, home)}</Text> : null}
        </Text>
        {budget > 0 ? (
          <>
            <View
              style={[styles.track, { backgroundColor: c.border }]}
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}>
              <View style={{ flex: pct, backgroundColor: barColor }} />
              <View style={{ flex: 1 - pct }} />
            </View>
            <Text style={{ color: pct >= 1 ? c.danger : c.muted, fontSize: 15 }}>
              {spent >= budget ? `Over by ${format(spent - budget, home)}` : `${format(budget - spent, home)} left`}
            </Text>
          </>
        ) : null}
      </View>

      <View style={[styles.card, { backgroundColor: c.card }]}>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <TextInput
            accessibilityLabel="Currency code"
            value={currency}
            onChangeText={(t) => setCurrency(t.toUpperCase().slice(0, 3))}
            autoCapitalize="characters"
            autoCorrect={false}
            style={[styles.input, { width: 80, color: c.text, borderColor: c.border, backgroundColor: c.background }]}
          />
          <TextInput
            accessibilityLabel="Amount"
            value={amount}
            onChangeText={setAmount}
            placeholder="Amount"
            placeholderTextColor={c.muted}
            keyboardType="decimal-pad"
            style={[styles.input, { flex: 1, color: c.text, borderColor: c.border, backgroundColor: c.background }]}
          />
        </View>
        <TextInput
          accessibilityLabel="Note"
          value={note}
          onChangeText={setNote}
          placeholder="What was it? (optional)"
          placeholderTextColor={c.muted}
          style={[styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.background }]}
        />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {CATEGORIES.map((k) => (
            <Chip key={k} label={LABEL[k]} selected={category === k} onPress={() => setCategory(k)} />
          ))}
        </View>
        {error ? (
          <Text accessibilityRole="alert" style={{ color: c.danger, fontSize: 15 }}>
            {error}
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button label="Scan receipt" kind="secondary" onPress={scan} busy={scanning} style={{ flex: 1 }} />
          <Button label="Add" onPress={add} style={{ flex: 1 }} />
        </View>
      </View>
      {expenses.length ? <Text style={{ color: c.muted, fontSize: 15, fontWeight: '600' }}>Recent</Text> : null}
    </View>
  );

  return (
    <Screen
      title="Wallet"
      right={
        <Pressable accessibilityRole="button" onPress={confirmReset} hitSlop={12} style={{ minHeight: touch, justifyContent: 'center' }}>
          <Text style={{ color: c.muted, fontSize: 15 }}>Start over</Text>
        </Pressable>
      }>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <FlatList
          data={expenses}
          keyExtractor={(e) => e.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: space.md, paddingTop: 0 }}
          ListHeaderComponent={header}
          ListEmptyComponent={<Message title="No spending yet" body="Add what you spend, or scan a receipt. Roamie converts it for you." />}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityHint="Long press to remove"
              onLongPress={() =>
                Alert.alert('Remove this expense?', undefined, [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Remove', style: 'destructive', onPress: () => removeExpense(item.id) },
                ])
              }
              style={[styles.row, { borderColor: c.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.text, fontSize: 17 }} numberOfLines={1}>
                  {item.note || LABEL[item.category]}
                </Text>
                <Text style={{ color: c.muted, fontSize: 13 }}>
                  {LABEL[item.category]} · {new Date(item.at).toLocaleDateString()}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ color: c.text, fontSize: 17, fontWeight: '600' }}>{format(item.homeMinor, home)}</Text>
                {item.currency !== home ? (
                  <Text style={{ color: c.muted, fontSize: 13 }}>{format(item.amountMinor, item.currency)}</Text>
                ) : null}
              </View>
            </Pressable>
          )}
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}

async function nudge(threshold: number, spent: number, budget: number, home: string) {
  const perm = await Notifications.requestPermissionsAsync();
  if (!perm.granted) return;
  const body =
    threshold >= 100
      ? `You've used your whole budget (${format(spent, home)} of ${format(budget, home)}).`
      : `You've used ${threshold}% of your budget. ${format(budget - spent, home)} left.`;
  await Notifications.scheduleNotificationAsync({ content: { title: 'Roamie budget', body }, trigger: null });
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, padding: space.md, gap: space.sm },
  track: { height: 10, flexDirection: 'row', borderRadius: radius.pill, overflow: 'hidden' },
  input: { minHeight: touch, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: space.md, fontSize: 17 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: touch + 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
