import { getLocales } from 'expo-localization';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Chip } from '@/components/ui';
import { LanguagePicker } from '@/components/language-picker';
import { radius, space, touch, useColors } from '@/constants/theme';
import { LANGUAGES, languageName } from '@/lib/languages';
import { toMinor } from '@/lib/money';
import { type Diet, useStore } from '@/lib/store';

const DIETS: { value: Diet; label: string }[] = [
  { value: 'none', label: 'Anything' },
  { value: 'vegetarian', label: 'Vegetarian' },
  { value: 'vegan', label: 'Vegan' },
  { value: 'halal', label: 'Halal' },
  { value: 'kosher', label: 'Kosher' },
  { value: 'jain', label: 'Jain' },
  { value: 'pescatarian', label: 'Pescatarian' },
];

export default function Welcome() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { saveProfile } = useStore();
  const locale = getLocales()[0];
  const [language, setLanguage] = useState(
    locale?.languageCode && LANGUAGES[locale.languageCode] ? locale.languageCode : 'en',
  );
  const [currency, setCurrency] = useState(locale?.currencyCode ?? 'USD');
  const [budget, setBudget] = useState('');
  const [diet, setDiet] = useState<Diet>('none');
  const [picking, setPicking] = useState(false);

  const budgetMinor = budget ? toMinor(budget, currency) : 0;
  const validCurrency = /^[A-Z]{3}$/.test(currency);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.background }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingTop: insets.top + space.xl, gap: space.xl }}
        keyboardShouldPersistTaps="handled">
        <View style={{ gap: space.sm }}>
          <Text style={{ color: c.text, fontSize: 36, fontWeight: '800' }}>{"Hi, I'm Roamie."}</Text>
          <Text style={{ color: c.muted, fontSize: 17 }}>{"Three quick things and you're set. You can skip all of them."}</Text>
        </View>

        <Section title="1. Your language">
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Choose the language you want everything translated into"
            onPress={() => setPicking(true)}
            style={({ pressed }) => [styles.field, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.7 : 1 }]}>
            <Text style={{ color: c.text, fontSize: 17 }}>{languageName(language)}</Text>
            <Text style={{ color: c.accent, fontSize: 15, fontWeight: '600' }}>Change</Text>
          </Pressable>
        </Section>

        <Section title="2. Trip budget" hint="Optional. We'll nudge you at 50%, 80% and 100%.">
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <TextInput
              accessibilityLabel="Currency code"
              value={currency}
              onChangeText={(t) => setCurrency(t.toUpperCase().slice(0, 3))}
              autoCapitalize="characters"
              autoCorrect={false}
              style={[styles.field, styles.input, { width: 88, color: c.text, backgroundColor: c.card, borderColor: validCurrency ? c.border : c.danger }]}
            />
            <TextInput
              accessibilityLabel="Budget amount"
              value={budget}
              onChangeText={setBudget}
              placeholder="e.g. 1500"
              placeholderTextColor={c.muted}
              keyboardType="decimal-pad"
              style={[styles.field, styles.input, { flex: 1, color: c.text, backgroundColor: c.card, borderColor: budgetMinor === null ? c.danger : c.border }]}
            />
          </View>
        </Section>

        <Section title="3. What do you eat?">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {DIETS.map((d) => (
              <Chip key={d.value} label={d.label} selected={diet === d.value} onPress={() => setDiet(d.value)} />
            ))}
          </View>
        </Section>

        <Button
          label="Start exploring"
          disabled={!validCurrency || budgetMinor === null}
          onPress={() => saveProfile({ language, homeCurrency: currency, budgetMinor: budgetMinor ?? 0, diet })}
        />
        <Text style={{ color: c.muted, fontSize: 13, textAlign: 'center' }}>
          No account needed. Everything stays on this phone.
        </Text>
      </ScrollView>
      <LanguagePicker
        visible={picking}
        title="Your language"
        selected={language}
        onPick={setLanguage}
        onClose={() => setPicking(false)}
      />
    </KeyboardAvoidingView>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  const c = useColors();
  return (
    <View style={{ gap: space.sm }}>
      <Text style={{ color: c.text, fontSize: 20, fontWeight: '700' }}>{title}</Text>
      {hint ? <Text style={{ color: c.muted, fontSize: 14 }}>{hint}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    minHeight: touch + 4,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  input: { fontSize: 17 },
});
