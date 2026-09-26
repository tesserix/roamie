import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { Badge, Button, Chip, Message, SpeakButton } from '@/components/ui';
import { font, lift, radius, space, useColors } from '@/constants/theme';
import { ApiError, type SignLine, translateSign } from '@/lib/api';
import { languageName } from '@/lib/languages';

type Photo = { uri: string; width: number; height: number; base64: string; mimeType: string };
type Read =
  | { status: 'reading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; detected: string; gist: string; lines: SignLine[] };

const PICK: ImagePicker.ImagePickerOptions = { base64: true, quality: 0.6, mediaTypes: ['images'] };

export function CameraTranslate({ mine, bottom }: { mine: string; bottom: number }) {
  const c = useColors();
  const { width, height } = useWindowDimensions();
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [read, setRead] = useState<Read>({ status: 'reading' });
  const [overlay, setOverlay] = useState(true);

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
    if (!a?.base64) return;
    const next = { uri: a.uri, width: a.width, height: a.height, base64: a.base64, mimeType: a.mimeType ?? 'image/jpeg' };
    setPhoto(next);
    setOverlay(true);
    await translate(next);
  }

  async function translate(p: Photo) {
    setRead({ status: 'reading' });
    try {
      setRead({ status: 'ready', ...(await translateSign(p.base64, p.mimeType, mine)) });
    } catch (e) {
      setRead({ status: 'error', message: e instanceof ApiError ? e.message : 'Something went wrong. Please try again.' });
    }
  }

  if (!photo) {
    return (
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: space.md, paddingBottom: bottom }}>
        <Message
          icon="text.viewfinder"
          title="Translate signs and menus"
          body={`Snap a sign, menu, notice or label. Roamie reads it and translates it into ${languageName(mine)}.`}
          action={
            <View style={{ gap: space.sm }}>
              <Button label="Take a photo" icon="camera.fill" onPress={() => take(true)} />
              <Button label="Choose from photos" icon="photo.on.rectangle" kind="secondary" onPress={() => take(false)} />
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

  return (
    <ScrollView contentContainerStyle={{ padding: space.md, gap: space.md, paddingBottom: bottom }}>
      <View style={[styles.frame, { width: w, height: h }]}>
        <Image source={{ uri: photo.uri }} style={{ width: w, height: h }} contentFit="cover" accessibilityLabel="Your photo" />
        {ready && overlay
          ? ready.lines.map((l, i) => (
              <View
                key={i}
                style={[
                  styles.label,
                  { left: l.box.x * w, top: l.box.y * h, width: l.box.w * w, minHeight: l.box.h * h, backgroundColor: c.surface },
                ]}>
                <Text
                  adjustsFontSizeToFit
                  numberOfLines={2}
                  style={{ color: c.text, fontWeight: '600', fontSize: Math.max(10, Math.min(22, l.box.h * h * 0.7)) }}>
                  {l.translation}
                </Text>
              </View>
            ))
          : null}
        {read.status === 'reading' ? (
          <View style={styles.scrim}>
            <ActivityIndicator color="#FFFFFF" size="large" />
            <Text style={{ color: '#FFFFFF', fontWeight: '600', fontSize: 16 }}>Reading the text…</Text>
          </View>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', gap: space.sm, alignSelf: 'center' }}>
        {ready ? <Chip label={overlay ? 'Show original' : 'Show translation'} icon="eye" onPress={() => setOverlay((o) => !o)} /> : null}
        <Chip label="New photo" icon="camera.fill" onPress={() => take(true)} />
        <Chip label="Photos" icon="photo" onPress={() => take(false)} />
      </View>

      {read.status === 'error' ? (
        <Message
          icon="text.viewfinder"
          title={read.message}
          action={<Button label="Try again" kind="secondary" onPress={() => translate(photo)} />}
        />
      ) : null}

      {ready ? (
        <>
          <View style={[styles.gist, lift, { backgroundColor: c.surface }]}>
            <Badge icon="lightbulb.fill" tint={c.accent} bg={c.accentSoft} size={36} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[font.overline, { color: c.muted }]}>What it says · {languageName(ready.detected)}</Text>
              <Text style={[font.body, { color: c.text, fontSize: 17, fontWeight: '500' }]}>{ready.gist}</Text>
            </View>
            <SpeakButton text={ready.gist} lang={mine} />
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
                <SpeakButton text={l.original} lang={ready.detected} id={`sign-${i}`} tone="plain" />
              </View>
            ))}
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  frame: { alignSelf: 'center', borderRadius: radius.lg, overflow: 'hidden' },
  label: { position: 'absolute', borderRadius: 4, paddingHorizontal: 3, justifyContent: 'center', opacity: 0.94 },
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
