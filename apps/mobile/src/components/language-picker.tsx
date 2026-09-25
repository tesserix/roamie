import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { space, touch, useColors } from '@/constants/theme';
import { LANGUAGES } from '@/lib/languages';

const ITEMS = Object.entries(LANGUAGES).sort((a, b) => a[1].localeCompare(b[1]));

type Props = {
  visible: boolean;
  title: string;
  selected: string;
  onPick: (code: string) => void;
  onClose: () => void;
};

export function LanguagePicker({ visible, title, selected, onPick, onClose }: Props) {
  const c = useColors();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <View style={styles.head}>
          <Text style={{ color: c.text, fontSize: 20, fontWeight: '700' }}>{title}</Text>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={12}>
            <Text style={{ color: c.accent, fontSize: 17, fontWeight: '600' }}>Done</Text>
          </Pressable>
        </View>
        <FlatList
          data={ITEMS}
          keyExtractor={([code]) => code}
          getItemLayout={(_, index) => ({ length: touch + 4, offset: (touch + 4) * index, index })}
          renderItem={({ item: [code, name] }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: code === selected }}
              onPress={() => {
                onPick(code);
                onClose();
              }}
              style={({ pressed }) => [styles.row, { borderColor: c.border, opacity: pressed ? 0.6 : 1 }]}>
              <Text style={{ color: c.text, fontSize: 17 }}>{name}</Text>
              {code === selected ? <Text style={{ color: c.accent, fontSize: 17 }}>✓</Text> : null}
            </Pressable>
          )}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: space.md,
  },
  row: {
    height: touch + 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
