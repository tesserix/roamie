import { getDocumentAsync } from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import type { SFSymbol } from 'expo-symbols';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Badge, Button, Icon, IconButton, Message, Screen, SectionLabel, TAB_CLEARANCE } from '@/components/ui';
import { font, lift, radius, space, useColors } from '@/constants/theme';
import { StatementReview } from '@/components/statement-review';
import { ApiError, fxRates, readReceipt, readStatement } from '@/lib/api';
import { nudge } from '@/lib/budget-nudge';
import { session } from '@/lib/auth-client';
import { signOut } from '@/lib/sign-out';
import { crossed, decimals, format, toHome, toMinor } from '@/lib/money';
import { reviewStatement, type StatementRow } from '@/lib/statement';
import { type Expense, useStore } from '@/lib/store';
import { useTrips } from '@/lib/trip-store';
import type { Trip } from '@/lib/trips';

const CATEGORIES: { value: string; label: string; icon: SFSymbol }[] = [
  { value: 'food', label: 'Food', icon: 'fork.knife' },
  { value: 'stay', label: 'Stay', icon: 'bed.double.fill' },
  { value: 'transport', label: 'Transport', icon: 'tram.fill' },
  { value: 'activities', label: 'Activities', icon: 'ticket.fill' },
  { value: 'shopping', label: 'Shopping', icon: 'bag.fill' },
  { value: 'other', label: 'Other', icon: 'square.grid.2x2.fill' },
];
const categoryOf = (v: string) => CATEGORIES.find((k) => k.value === v) ?? CATEGORIES[5];

type Draft = { amount: string; currency: string; category: string; note: string };
type Review = { rows: StatementRow[]; range: string };

// Base64 inflates by a third, so 8 MB keeps the upload under the API's 12 MB body limit.
const MAX_STATEMENT_BYTES = 8_000_000;
const day = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

export default function Wallet() {
  const { profile, expenses, addExpense, removeExpense, clearAll } = useStore();
  const home = profile!.homeCurrency;
  const budget = profile!.budgetMinor;

  const lastCurrency = expenses[0]?.currency ?? home;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [rates, setRates] = useState<Record<string, number> | null>(null);
  const { trips } = useTrips();
  const [scanning, setScanning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fxRates(home)
      .then((r) => setRates(r.rates))
      .catch(() => setRates(null));
  }, [home]);

  const spent = expenses.reduce((sum, e) => sum + e.homeMinor, 0);
  const pct = budget > 0 ? Math.min(spent / budget, 1) : 0;

  function open(prefill?: Partial<Draft>) {
    setError(null);
    setDraft({ amount: '', currency: lastCurrency, category: 'food', note: '', ...prefill });
  }

  async function save() {
    if (!draft) return;
    const minor = toMinor(draft.amount, draft.currency);
    if (!minor) {
      setError('Enter an amount, like 12.50.');
      return;
    }
    const homeMinor = rates ? toHome(minor, draft.currency, home, rates) : draft.currency === home ? minor : null;
    if (homeMinor === null) {
      setError(`Can't convert ${draft.currency} right now. Check the code or your connection.`);
      return;
    }
    addExpense({ amountMinor: minor, currency: draft.currency, homeMinor, category: draft.category, note: draft.note.trim() });
    setDraft(null);
    const hit = crossed(spent, spent + homeMinor, budget);
    if (hit) await nudge(hit, spent + homeMinor, budget, home);
  }

  async function scan() {
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
      const r = await readReceipt(asset.base64, asset.mimeType ?? 'image/jpeg', lastCurrency);
      const currency = r.currency || lastCurrency;
      open({
        currency,
        amount: r.amountMinor === null ? '' : String(r.amountMinor / 10 ** decimals(currency)),
        category: r.category,
        note: r.merchant,
      });
      if (r.amountMinor === null) setError("Couldn't read the total. Type it in.");
    } catch (e) {
      open();
      setError(e instanceof ApiError ? e.message : "Couldn't read that receipt. Type it in instead.");
    } finally {
      setScanning(false);
    }
  }

  function importStatement() {
    if (!trips.length) {
      Alert.alert('Add a trip first', 'Roamie uses your trip dates to pick out holiday spending from the statement.');
      return;
    }
    const recent = [...trips].sort((a, b) => b.startDate.localeCompare(a.startDate));
    Alert.alert('Which trip is this statement for?', undefined, [
      ...recent.slice(0, 5).map((trip) => ({ text: `${trip.title} · ${day(trip.startDate)}`, onPress: () => { void readTripStatement(trip); } })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }

  async function readTripStatement(trip: Trip) {
    const picked = await getDocumentAsync({ type: ['application/pdf', 'image/*'], copyToCacheDirectory: true, multiple: false });
    if (picked.canceled) return;
    const asset = picked.assets[0];
    const file = new File(asset.uri);
    setImporting(true);
    try {
      if (!file.exists || file.size <= 0 || file.size > MAX_STATEMENT_BYTES) throw new ApiError('Choose a PDF or photo up to 8 MB. Download only the months of your trip.');
      const mimeType = asset.mimeType ?? (asset.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');
      const statement = await readStatement(await file.base64(), mimeType, trip.startDate, trip.endDate);
      setReview({ rows: reviewStatement(statement.transactions, expenses, home, rates), range: `${day(trip.startDate)} – ${day(trip.endDate)}` });
    } catch (e) {
      Alert.alert("Couldn't read that statement", e instanceof ApiError ? e.message : 'Try a clearer PDF or photo.');
    } finally {
      if (file.uri.startsWith(Paths.cache.uri.replace(/\/+$/, '') + '/') && file.exists) file.delete();
      setImporting(false);
    }
  }

  async function addStatement(rows: StatementRow[]) {
    setReview(null);
    let total = spent;
    for (const row of rows) {
      if (row.homeMinor === null) continue;
      addExpense({ amountMinor: row.amountMinor, currency: row.currency, homeMinor: row.homeMinor, category: row.category, note: row.merchant, at: `${row.date}T12:00:00.000Z` });
      total += row.homeMinor;
    }
    const hit = crossed(spent, total, budget);
    if (hit) await nudge(hit, total, budget, home);
  }

  function setUpApplePay() {
    Alert.alert(
      'Add Apple Pay payments automatically',
      '1. In Shortcuts, open Automation and tap New Automation.\n2. Choose Transaction, pick your cards and choose Run Immediately.\n3. Add the Roamie action "Log card payment" and set Merchant and Amount from the transaction.\n\nPayments you make during a trip then appear here next time you open Roamie.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open Shortcuts', onPress: () => { void Linking.openURL('shortcuts://'); } },
      ],
    );
  }

  function menu() {
    Alert.alert('Your account', session.current()?.email, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete local trip', style: 'destructive', onPress: () => Alert.alert('Delete local trip?', 'This deletes the budget, expenses and settings for this account on this phone.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => { void clearAll(); } },
      ]) },
      { text: 'Sign out', onPress: () => { void signOut(); } },
    ]);
  }

  const header = (
    <View style={{ gap: space.md, paddingBottom: space.sm }}>
      <BudgetCard spent={spent} budget={budget} pct={pct} home={home} />
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Button label="Add expense" icon="plus" onPress={() => open()} style={{ flex: 1 }} />
        <Button label="Scan" icon="doc.text.viewfinder" kind="secondary" busy={scanning} onPress={scan} style={{ flex: 0.7 }} />
      </View>
      <Button label="Import card statement" icon="creditcard" kind="secondary" busy={importing} onPress={importStatement} />
      {Platform.OS === 'ios' ? <Button label="Track Apple Pay" icon="wave.3.right" kind="secondary" onPress={setUpApplePay} /> : null}
      {expenses.length ? <SectionLabel>Recent</SectionLabel> : null}
    </View>
  );

  return (
    <Screen title="Wallet" subtitle={`Everything in ${home}`} right={<IconButton icon="ellipsis" label="More" tone="soft" onPress={menu} />}>
      <FlatList
        data={expenses}
        keyExtractor={(e) => e.id}
        contentContainerStyle={{ paddingHorizontal: space.md, paddingBottom: TAB_CLEARANCE }}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <Message icon="wallet.pass.fill" title="No spending yet" body="Add what you spend in any currency. Roamie converts it for you." />
        }
        renderItem={({ item, index }) => (
          <ExpenseRow
            item={item}
            home={home}
            first={index === 0}
            last={index === expenses.length - 1}
            onRemove={() =>
              Alert.alert('Remove this expense?', undefined, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Remove', style: 'destructive', onPress: () => removeExpense(item.id) },
              ])
            }
          />
        )}
      />
      <Modal visible={!!review} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setReview(null)}>
        {review ? <StatementReview rows={review.rows} home={home} range={review.range} onAdd={(rows) => { void addStatement(rows); }} onClose={() => setReview(null)} /> : null}
      </Modal>
      <AddSheet draft={draft} error={error} onChange={setDraft} onSave={save} onClose={() => setDraft(null)} />
    </Screen>
  );
}

function BudgetCard({ spent, budget, pct, home }: { spent: number; budget: number; pct: number; home: string }) {
  const c = useColors();
  const bg = pct >= 1 ? c.danger : pct >= 0.8 ? c.warn : c.accent;
  return (
    <View style={[styles.hero, lift, { backgroundColor: bg }]}>
      <Text style={[font.overline, { color: c.onAccent, opacity: 0.8 }]}>{budget > 0 ? 'Spent of trip budget' : 'Spent so far'}</Text>
      <Text style={{ color: c.onAccent, fontSize: 40, fontWeight: '700', letterSpacing: -1 }}>{format(spent, home)}</Text>
      {budget > 0 ? (
        <>
          <View
            style={styles.track}
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}>
            <View style={{ flex: pct, backgroundColor: c.onAccent, borderRadius: radius.pill }} />
            <View style={{ flex: 1 - pct }} />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={[font.body, { color: c.onAccent, fontWeight: '600' }]}>
              {spent >= budget ? `Over by ${format(spent - budget, home)}` : `${format(budget - spent, home)} left`}
            </Text>
            <Text style={[font.body, { color: c.onAccent, opacity: 0.8 }]}>of {format(budget, home)}</Text>
          </View>
        </>
      ) : null}
    </View>
  );
}

function ExpenseRow({
  item,
  home,
  first,
  last,
  onRemove,
}: {
  item: Expense;
  home: string;
  first: boolean;
  last: boolean;
  onRemove: () => void;
}) {
  const c = useColors();
  const cat = categoryOf(item.category);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Long press to remove"
      onLongPress={onRemove}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? c.card : c.surface },
        first && { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
        last && { borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg },
      ]}>
      <Badge icon={cat.icon} tint={c.accent} bg={c.accentSoft} />
      <View style={[styles.rowBody, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.border }]}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[font.headline, { color: c.text }]} numberOfLines={1}>
            {item.note || cat.label}
          </Text>
          <Text style={[font.caption, { color: c.muted }]}>
            {cat.label} · {new Date(item.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <Text style={[font.headline, { color: c.text }]}>{format(item.homeMinor, home)}</Text>
          {item.currency !== home ? <Text style={[font.caption, { color: c.muted }]}>{format(item.amountMinor, item.currency)}</Text> : null}
        </View>
      </View>
    </Pressable>
  );
}

function AddSheet({
  draft,
  error,
  onChange,
  onSave,
  onClose,
}: {
  draft: Draft | null;
  error: string | null;
  onChange: (d: Draft) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const c = useColors();
  const set = (patch: Partial<Draft>) => draft && onChange({ ...draft, ...patch });
  return (
    <Modal visible={!!draft} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.background }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.sheetHead}>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={12}>
            <Text style={[font.body, { color: c.muted }]}>Cancel</Text>
          </Pressable>
          <Text style={[font.headline, { color: c.text }]}>Add expense</Text>
          <View style={{ width: 52 }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }} keyboardShouldPersistTaps="handled">
          <View style={[styles.amountBox, lift, { backgroundColor: c.surface }]}>
            <TextInput
              accessibilityLabel="Currency code"
              value={draft?.currency}
              onChangeText={(t) => set({ currency: t.toUpperCase().slice(0, 3) })}
              autoCapitalize="characters"
              autoCorrect={false}
              style={[styles.currency, { color: c.accent, backgroundColor: c.accentSoft }]}
            />
            <TextInput
              autoFocus
              accessibilityLabel="Amount"
              value={draft?.amount}
              onChangeText={(t) => set({ amount: t })}
              placeholder="0"
              placeholderTextColor={c.faint}
              keyboardType="decimal-pad"
              style={[styles.amount, { color: c.text }]}
            />
          </View>

          <View style={{ gap: space.sm }}>
            <SectionLabel>Category</SectionLabel>
            <View style={styles.grid}>
              {CATEGORIES.map((k) => {
                const on = draft?.category === k.value;
                return (
                  <Pressable
                    key={k.value}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    onPress={() => set({ category: k.value })}
                    style={[styles.tile, { backgroundColor: on ? c.accent : c.surface, borderColor: on ? c.accent : c.border }]}>
                    <Icon name={k.icon} size={22} color={on ? c.onAccent : c.accent} />
                    <Text style={[font.caption, { color: on ? c.onAccent : c.text, fontWeight: '600' }]}>{k.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={{ gap: space.sm }}>
            <SectionLabel>Note</SectionLabel>
            <TextInput
              accessibilityLabel="Note"
              value={draft?.note}
              onChangeText={(t) => set({ note: t })}
              placeholder="What was it? (optional)"
              placeholderTextColor={c.faint}
              style={[styles.note, { color: c.text, backgroundColor: c.surface, borderColor: c.border }]}
            />
          </View>

          {error ? (
            <Text accessibilityRole="alert" style={[font.body, { color: c.danger }]}>
              {error}
            </Text>
          ) : null}
          <Button label="Add expense" onPress={onSave} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  track: {
    height: 8,
    flexDirection: 'row',
    borderRadius: radius.pill,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.25)',
    marginTop: space.xs,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: space.md },
  rowBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 14, paddingRight: space.md },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  amountBox: { borderRadius: radius.lg, padding: space.md, flexDirection: 'row', alignItems: 'center', gap: space.md },
  currency: { width: 72, height: 44, borderRadius: radius.sm, textAlign: 'center', fontSize: 17, fontWeight: '700' },
  amount: { flex: 1, fontSize: 40, fontWeight: '700', letterSpacing: -1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: {
    flexBasis: '30%',
    flexGrow: 1,
    height: 76,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  note: { minHeight: 52, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: space.md, fontSize: 17 },
});
