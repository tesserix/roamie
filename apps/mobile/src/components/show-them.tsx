import { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAccessibility } from '@/lib/accessibility';
import { IconButton, SpeakButton } from '@/components/ui';
import { space, useColors } from '@/constants/theme';

export type Shown = { text: string; lang: string; romanized?: string };

/** Full-screen text for the other person, upside down so it reads right across a table. */
export function ShowThem({ shown, onClose }: { shown: Shown | null; onClose: () => void }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [flipped, setFlipped] = useState(true);
  const { reducedMotion } = useAccessibility();
  return (
    <Modal onShow={() => setFlipped(true)} visible={!!shown} animationType={reducedMotion ? 'none' : 'fade'} onRequestClose={onClose}>
      <View accessibilityViewIsModal style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top, paddingBottom: insets.bottom + space.md }}>
        <ScrollView testID="enlarged-conversation" style={{ flex: 1 }} contentContainerStyle={[styles.text, flipped && { transform: [{ rotate: '180deg' }] }]}>
          <Text style={{ color: c.text, fontSize: 38, lineHeight: 50, fontWeight: '600', textAlign: 'center' }} accessibilityLanguage={shown?.lang} selectable>
            {shown?.text}
          </Text>
        {shown?.romanized ? (
          <Text style={{ color: c.muted, fontSize: 17, textAlign: 'center', paddingHorizontal: space.lg, paddingBottom: space.md }}>
            {shown.romanized}
          </Text>
        ) : null}
        </ScrollView>
        <View style={styles.bar}>
          <IconButton icon="arrow.up.arrow.down" label="Flip text" tone="soft" onPress={() => setFlipped((f) => !f)} />
          {shown ? <SpeakButton text={shown.text} lang={shown.lang} /> : null}
          <IconButton icon="xmark" label="Close" tone="soft" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  text: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: space.lg },
  bar: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: space.lg },
});
