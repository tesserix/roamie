import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { Badge, Button, Chip, Icon, Message, SpeakButton } from '@/components/ui';
import { font, lift, radius, space, useColors } from '@/constants/theme';
import { type SignLine, translateSign } from '@/lib/api';
import { languageName } from '@/lib/languages';
import { placeLabels } from '@/lib/sign-layout';
import { LanguagePicker } from './language-picker';
import { useTranslationPreferences } from '@/lib/translation-preferences';

type Photo = { uri: string; width: number; height: number; base64?: string; mimeType: string };
type Read =
  | { status: 'reading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; detected: string; gist: string; lines: SignLine[]; reviewRequired?: boolean; engine?: 'device' | 'cloud' };

const PICK: ImagePicker.ImagePickerOptions = { quality: 0.6, mediaTypes: ['images'] };

export function CameraTranslate({ mine, bottom, partner, offlineOnly = false }: { mine: string; bottom: number; partner?: string | null; offlineOnly?: boolean }) {
  const c = useColors();
  const { mode } = useTranslationPreferences();
  const { width, height } = useWindowDimensions();
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [settled, setSettled] = useState<{ key: string; read: Read } | null>(null);
  const [overlay, setOverlay] = useState(true);
  const [from, setFrom] = useState<string | null>(partner ?? null);
  const [picking, setPicking] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const requestKey = `${photo?.uri ?? ''}:${mine}:${from ?? ''}:${offlineOnly}:${attempt}:${mode}`;
  const read: Read = settled?.key === requestKey ? settled.read : { status: 'reading' };
  const setRead = (value: Read) => setSettled({ key: requestKey, read: value });

  useEffect(() => {
    if (!photo) return;
    const controller = new AbortController();
    void translateSign(photo.base64 ?? '', photo.mimeType, mine, { uri: photo.uri, from: from ?? undefined, signal: controller.signal, offlineOnly })
      .then(result => { if (!controller.signal.aborted) setSettled({ key: requestKey, read: { status: 'ready', ...result } }); })
      .catch(error => { if (!controller.signal.aborted) setSettled({ key: requestKey, read: { status: 'error', message: error instanceof Error ? error.message : 'Could not read this photo. Please try again.' } }); });
    return () => controller.abort();
  }, [photo, mine, from, requestKey, offlineOnly]);

  async function take(camera: boolean) {
    let picked: ImagePicker.ImagePickerResult;
    if (camera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        setRead({ status: 'error', message: 'Roamie needs the camera to read signs. Turn it on in Settings, or choose a photo.' });
        return;
      }
      try {
        picked = await ImagePicker.launchCameraAsync(PICK);
      } catch {
        picked = await ImagePicker.launchImageLibraryAsync(PICK);
      }
    } else {
      picked = await ImagePicker.launchImageLibraryAsync(PICK);
    }
    const a = picked.canceled ? null : picked.assets[0];
    if (!a?.uri) return;
    const next = { uri: a.uri, width: a.width, height: a.height, base64: a.base64 ?? undefined, mimeType: a.mimeType ?? 'image/jpeg' };
    setPhoto(next);
    setOverlay(true);
  }

  const choosePhoto = (camera: boolean) => { void take(camera).catch(() => setRead({ status: 'error', message: 'Could not open photos. Check permissions and try again.' })); };
  const sourceChoice = <><Button label={`Sign language: ${from ? languageName(from) : 'Auto-detect'}`} kind="secondary" onPress={() => setPicking(true)} /><LanguagePicker visible={picking} title="Sign language" selected={from ?? ''} allowAuto onPick={code => { setFrom(code || null); setPicking(false); }} onClose={() => setPicking(false)} /></>;

  if (!photo) {
    return (
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: space.md, paddingBottom: bottom }}>
        <Message
          icon="text.viewfinder"
          title="Translate signs and menus"
          body={`Snap a sign, menu, notice or label. Roamie reads it and translates it into ${languageName(mine)}.`}
          action={
            <View style={{ gap: space.sm }}>
              {sourceChoice}
              <Button label="Take a photo" icon="camera.fill" onPress={() => choosePhoto(true)} />
              <Button label="Choose from photos" icon="photo.on.rectangle" kind="secondary" onPress={() => choosePhoto(false)} />
            </View>
          }
        />
        {read.status === 'error' ? (
          <Text accessibilityRole="alert" style={[font.body, { color: c.danger, textAlign: 'center' }]}>
            {read.message}
          </Text>
        ) : null}
      </ScrollView>
    );
  }

  // Fit the photo to the column width, but never taller than half the screen.
  const maxW = width - space.md * 2;
  const scale = Math.min(maxW / photo.width, (height * 0.5) / photo.height);
  const w = photo.width * scale;
  const h = photo.height * scale;
  const ready = read.status === 'ready' ? read : null;
  const labels = ready && overlay ? placeLabels(ready.lines, w, h) : [];

  return (
    <ScrollView contentContainerStyle={{ padding: space.md, gap: space.md, paddingBottom: bottom }}>
      {sourceChoice}
      <View style={[styles.frame, { width: w, height: h, borderColor: c.border }]}>
        <Image source={{ uri: photo.uri }} style={{ width: w, height: h }} contentFit="cover" accessibilityLabel="Your photo" />
        {labels.map(({ fontSize, ...box }, i) => (
          <View key={i} style={[styles.label, box, { backgroundColor: c.surface }]}>
            {/* Sized to the photo, so system text scaling would only push it past the label. */}
            <Text allowFontScaling={false} adjustsFontSizeToFit minimumFontScale={0.6} numberOfLines={1} style={{ color: c.text, fontWeight: '600', fontSize }}>
              {ready?.lines[i].translation}
            </Text>
          </View>
        ))}
        {read.status === 'reading' ? (
          <View style={styles.scrim}>
            <ActivityIndicator color="#FFFFFF" size="large" />
            <Text style={{ color: '#FFFFFF', fontWeight: '600', fontSize: 16 }}>Reading the text…</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.actions}>
        {ready ? <Chip label="Original" icon="eye" selected={!overlay} onPress={() => setOverlay((o) => !o)} /> : null}
        <Chip label="New photo" icon="camera.fill" onPress={() => choosePhoto(true)} />
        <Chip label="Photos" icon="photo" onPress={() => choosePhoto(false)} />
      </View>

      {read.status === 'error' ? (
        <Message
          icon="text.viewfinder"
          title={read.message}
          action={<Button label="Try again" kind="secondary" onPress={() => setAttempt(value => value + 1)} />}
        />
      ) : null}

      {ready ? (
        <>
          {ready.reviewRequired ? (
            <View accessibilityRole="alert" style={[styles.notice, { backgroundColor: c.warnSoft }]}>
              <Icon name="exclamationmark.triangle" size={18} color={c.warn} />
              <Text style={[font.caption, { color: c.warn, flex: 1 }]}>Some text is uncertain. Check the original photo before relying on this translation.</Text>
            </View>
          ) : null}
          <View style={[styles.gist, lift, { backgroundColor: c.surface }]}>
            <Badge icon="lightbulb.fill" tint={c.accent} bg={c.accentSoft} size={36} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[font.overline, { color: c.muted }]}>What it says · {languageName(ready.detected)}{ready.engine === 'device' ? ' · on this phone' : ''}</Text>
              <Text style={[font.body, { color: c.text, fontSize: 17, fontWeight: '500' }]}>{ready.gist}</Text>
            </View>
            <SpeakButton text={ready.gist} lang={mine} offlineOnly={offlineOnly} />
          </View>

          <View style={[styles.list, lift, { backgroundColor: c.surface }]}>
            {ready.lines.map((l, i) => (
              <View key={i} style={[styles.line, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.border }]}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text selectable style={[font.headline, { color: c.text }]}>
                    {l.translation}
                  </Text>
                  <Text selectable style={[font.caption, { color: c.muted }]}>
                    {l.original}
                    {l.romanized ? `  ·  ${l.romanized}` : ''}
                  </Text>
                </View>
                <SpeakButton text={l.original} lang={ready.detected} id={`sign-${i}`} tone="plain" offlineOnly={offlineOnly} />
              </View>
            ))}
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  frame: { alignSelf: 'center', borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  label: { position: 'absolute', borderRadius: 4, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.sm },
  notice: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: 12, borderRadius: radius.md },
  scrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(16,24,40,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  gist: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: radius.lg, padding: space.md },
  list: { borderRadius: radius.lg, paddingHorizontal: space.md },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 12 },
});
