import { getLocales } from 'expo-localization';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandHeader, TravelHero } from './travel-brand';
import { ProfileSettings } from './profile-settings';
import { Badge, Button, Card, Chip, Icon } from '@/components/ui';
import { LanguagePicker } from '@/components/language-picker';
import type { SFSymbol } from 'expo-symbols';

import { font, radius, space, touch, useColors } from '@/constants/theme';
import { LANGUAGES, languageName } from '@/lib/languages';
import { toMinor } from '@/lib/money';
import { signOut } from '@/lib/sign-out';
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
  const [extras, setExtras] = useState(false);
  const [picking, setPicking] = useState(false);

  const budgetMinor = budget ? toMinor(budget, currency) : 0;
  const validCurrency = /^[A-Z]{3}$/.test(currency);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.background }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.lg, gap: space.md }}
        keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><BrandHeader /><ProfileSettings /></View>
        <TravelHero />
        <View style={{ gap: 8, marginTop: 4 }}>
          <Text accessibilityRole="header" style={[font.largeTitle, { color: c.text, fontSize: 30 }]}>Make yourself at home.</Text>
          <Text style={[font.body, { color: c.muted }]}>Start with your language. We’ll help you feel local, wherever you land.</Text>
        </View>

        <Section icon="character.bubble.fill" title="Your language">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Your language, ${languageName(language)}`}
            accessibilityHint="Choose the language you want everything translated into"
            onPress={() => setPicking(true)}
            style={({ pressed }) => [styles.field, { backgroundColor: c.background, borderColor: c.border, opacity: pressed ? 0.7 : 1 }]}>
            <Text style={{ color: c.text, fontSize: 17 }}>{languageName(language)}</Text>
            <Icon name="chevron.right" size={15} color={c.muted} />
          </Pressable>
        </Section>

        <Pressable accessibilityRole="button" accessibilityLabel="Add budget and food preferences" accessibilityState={{ expanded: extras }} onPress={() => setExtras(value => !value)} style={({ pressed }) => ({ paddingVertical: 12, minHeight: 52, flexDirection: 'row', gap: 12, alignItems: 'center', opacity: pressed ? 0.7 : 1 })}>
          <Badge icon="slider.horizontal.3" tint={c.accent} bg={c.accentSoft} size={38} />
          <View style={{ flex: 1, gap: 3 }}><Text style={[font.headline, { color: c.text }]}>Make it your kind of trip</Text><Text style={[font.caption, { color: c.muted }]}>Budget & food preferences · optional</Text></View>
          <Icon name={extras ? 'chevron.up' : 'chevron.down'} size={16} color={c.muted} />
        </Pressable>
        {extras && <View style={{ gap: space.md }}>
        <Section icon="wallet.pass.fill" title="Trip budget" hint="Optional. We'll nudge you at 50%, 80% and 100%.">
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <TextInput
              accessibilityLabel="Currency code"
              value={currency}
              onChangeText={(t) => setCurrency(t.toUpperCase().slice(0, 3))}
              autoCapitalize="characters"
              autoCorrect={false}
              style={[styles.field, styles.input, { width: 88, color: c.text, backgroundColor: c.background, borderColor: validCurrency ? c.border : c.danger }]}
            />
            <TextInput
              accessibilityLabel="Budget amount"
              value={budget}
              onChangeText={setBudget}
              placeholder="e.g. 1500"
              placeholderTextColor={c.faint}
              keyboardType="decimal-pad"
              style={[styles.field, styles.input, { flex: 1, color: c.text, backgroundColor: c.background, borderColor: budgetMinor === null ? c.danger : c.border }]}
            />
          </View>
        </Section>

        <Section icon="fork.knife" title="What do you eat?">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {DIETS.map((d) => (
              <Chip key={d.value} label={d.label} selected={diet === d.value} onPress={() => setDiet(d.value)} />
            ))}
          </View>
        </Section>

        </View>}

        <Button
          label="Start exploring"
          icon="arrow.right"
          disabled={!validCurrency || budgetMinor === null}
          onPress={() => saveProfile({ language, homeCurrency: currency, budgetMinor: budgetMinor ?? 0, diet })}
        />
        <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6 }}>
          <Icon name="lock.fill" size={13} color={c.muted} />
          <Text style={[font.caption, { color: c.muted }]}>Your trip details stay on this phone.</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={() => { void signOut(); }} style={({ pressed }) => ({ minHeight: 48, justifyContent: 'center', alignItems: 'center', opacity: pressed ? 0.7 : 1 })}><Text style={[font.caption, { color: c.muted, textDecorationLine: 'underline' }]}>Change account</Text></Pressable>
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

function Section({ icon, title, hint, children }: { icon: SFSymbol; title: string; hint?: string; children: React.ReactNode }) {
  const c = useColors();
  return (
    <Card style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Badge icon={icon} tint={c.accent} bg={c.accentSoft} size={36} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[font.headline, { color: c.text }]}>{title}</Text>
          {hint ? <Text style={[font.caption, { color: c.muted }]}>{hint}</Text> : null}
        </View>
      </View>
      {children}
    </Card>
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
