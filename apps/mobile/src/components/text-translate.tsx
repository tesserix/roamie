import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';

import { LanguagePicker } from '@/components/language-picker';
import { type Shown, ShowThem } from '@/components/show-them';
import { Icon, IconButton, SpeakButton } from '@/components/ui';
import { font, lift, radius, space, useColors } from '@/constants/theme';
import { ApiError, type TextTranslation, translateText } from '@/lib/api';
import { signalFeedback } from '@/lib/feedback';
import { useAccessibility } from '@/lib/accessibility';
import { languageName } from '@/lib/languages';

const DEBOUNCE_MS = 700;
const MAX = 5000;

type Pick = 'from' | 'to' | null;

export function TextTranslate({ mine, partner, bottom }: { mine: string; partner: string | null; bottom: number }) {
  const c = useColors();
  const { vibration } = useAccessibility();
  const feedback = useRef(vibration);
  useEffect(() => { feedback.current = vibration; }, [vibration]);
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState(partner ?? mine);
  const [text, setText] = useState('');
  const [result, setResult] = useState<TextTranslation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState<Pick>(null);
  const [shown, setShown] = useState<Shown | null>(null);

  const query = text.trim();
  useEffect(() => {
    if (!query) return;
    let live = true;
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const res = await translateText(query, to, from ?? undefined);
        if (live) {
          setResult(res);
          signalFeedback(feedback.current);
          setError(null);
        }
      } catch (e) {
        if (live) setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
      } finally {
        if (live) setBusy(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query, from, to]);

  const shownResult = query ? result : null;
  const source = from ?? shownResult?.detected ?? null;

  function swap() {
    const next = source ?? mine;
    setFrom(to);
    setTo(next === to ? mine : next);
    if (shownResult) setText(shownResult.translation);
  }

  return (
    <>
      <View style={[styles.langBar, lift, { backgroundColor: c.surface }]}>
        <LangButton
          label={from ? languageName(from) : shownResult ? `${languageName(shownResult.detected)} · detected` : 'Detect language'}
          onPress={() => setPicking('from')}
        />
        <IconButton icon="arrow.left.arrow.right" label="Swap languages" onPress={swap} />
        <LangButton label={languageName(to)} onPress={() => setPicking('to')} end />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: space.md, gap: space.md, paddingBottom: bottom }}
        keyboardShouldPersistTaps="handled">
        <View style={[styles.card, lift, { backgroundColor: c.surface }]}>
          <TextInput
            accessibilityLabel="Text to translate"
            autoCorrect={false}
            value={text}
            onChangeText={(t) => setText(t.slice(0, MAX))}
            placeholder="Type or paste text"
            placeholderTextColor={c.faint}
            multiline
            style={[styles.input, { color: c.text }]}
          />
          {shownResult?.sourceRomanized ? (
            <Text style={[font.body, { color: c.muted, fontStyle: 'italic' }]}>{shownResult.sourceRomanized}</Text>
          ) : null}
          <View style={styles.row}>
            {text ? (
              <>
                {source ? <SpeakButton text={query} lang={source} tone="plain" /> : null}
                <Text style={[font.caption, { color: c.faint, flex: 1, textAlign: 'right' }]}>
                  {text.length} / {MAX}
                </Text>
                <IconButton icon="xmark.circle.fill" label="Clear" onPress={() => setText('')} />
              </>
            ) : null}
          </View>
        </View>

        {error ? (
          <Text accessibilityRole="alert" style={[font.body, { color: c.danger, paddingHorizontal: space.xs }]}>
            {error}
          </Text>
        ) : null}

        {shownResult ? (
          <View style={[styles.card, { backgroundColor: c.accentSoft }]}>
            <View style={styles.row}>
              <Text style={[font.overline, { color: c.accent, flex: 1 }]}>{languageName(to)}</Text>
              {busy ? <ActivityIndicator color={c.accent} /> : null}
            </View>
            <Text selectable style={{ color: c.text, fontSize: 24, lineHeight: 32, fontWeight: '600' }}>
              {shownResult.translation}
            </Text>
            {shownResult.romanized ? (
              <Text selectable style={[font.body, { color: c.muted, fontStyle: 'italic' }]}>
                {shownResult.romanized}
              </Text>
            ) : null}
            <View style={[styles.row, { paddingTop: space.xs }]}>
              <SpeakButton text={shownResult.translation} lang={to} />
              <IconButton icon="square.and.arrow.up" label="Share or copy" onPress={() => Share.share({ message: shownResult.translation })} />
              <View style={{ flex: 1 }} />
              <Pressable
                accessibilityRole="button"
                onPress={() => setShown({ text: shownResult.translation, lang: to, romanized: shownResult.romanized })}
                style={({ pressed }) => [styles.show, { backgroundColor: c.accent, opacity: pressed ? 0.8 : 1 }]}>
                <Icon name="arrow.up.left.and.arrow.down.right" size={14} color={c.onAccent} />
                <Text style={{ color: c.onAccent, fontWeight: '600', fontSize: 14 }}>Show them</Text>
              </Pressable>
            </View>
          </View>
        ) : query && busy ? (
          <ActivityIndicator color={c.accent} style={{ marginTop: space.md }} />
        ) : null}

        {shownResult?.alternatives.length ? (
          <View style={{ gap: space.sm }}>
            <Text style={[font.overline, { color: c.muted, paddingHorizontal: space.xs }]}>Also could say</Text>
            {shownResult.alternatives.map((alt) => (
              <View key={alt} style={[styles.alt, { backgroundColor: c.surface, borderColor: c.border }]}>
                <Text selectable style={[font.body, { color: c.text, flex: 1 }]}>
                  {alt}
                </Text>
                <SpeakButton text={alt} lang={to} tone="plain" />
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <LanguagePicker
        visible={picking !== null}
        title={picking === 'from' ? 'Translate from' : 'Translate to'}
        selected={(picking === 'from' ? from : to) ?? ''}
        onPick={(code) => (picking === 'from' ? setFrom(code) : setTo(code))}
        onClose={() => setPicking(null)}
      />
      <ShowThem shown={shown} onClose={() => setShown(null)} />
    </>
  );
}

function LangButton({ label, onPress, end }: { label: string; onPress: () => void; end?: boolean }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. Change`}
      onPress={onPress}
      style={({ pressed }) => [styles.lang, end && { justifyContent: 'flex-end' }, { opacity: pressed ? 0.6 : 1 }]}>
      <Text style={[font.headline, { color: c.text, flexShrink: 1 }]} numberOfLines={1}>
        {label}
      </Text>
      <Icon name="chevron.down" size={12} color={c.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  langBar: {
    marginHorizontal: space.md,
    borderRadius: radius.lg,
    paddingVertical: 6,
    paddingHorizontal: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  lang: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44 },
  card: { borderRadius: radius.lg, padding: space.md, gap: space.sm },
  input: { fontSize: 22, lineHeight: 30, minHeight: 110, textAlignVertical: 'top' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 40 },
  show: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 36, borderRadius: radius.pill },
  alt: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderRadius: radius.md, paddingLeft: space.md, paddingVertical: 4 },
});
