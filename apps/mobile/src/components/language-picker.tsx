import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Icon } from '@/components/ui';
import { font, radius, space, touch, useColors } from '@/constants/theme';
import { LANGUAGES } from '@/lib/languages';

const ITEMS = Object.entries(LANGUAGES).sort((a, b) => a[1].localeCompare(b[1]));
const ROW = touch + 4;

type Props = {
  visible: boolean;
  title: string;
  selected: string;
  onPick: (code: string) => void;
  onClose: () => void;
};

export function LanguagePicker({ visible, title, selected, onPick, onClose }: Props) {
  const c = useColors();
  const [query, setQuery] = useState('');
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? ITEMS.filter(([code, name]) => name.toLowerCase().includes(q) || code === q) : ITEMS;
  }, [query]);

  const close = () => {
    setQuery('');
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <View style={styles.head}>
          <Text style={[font.title, { color: c.text }]}>{title}</Text>
          <Pressable accessibilityRole="button" onPress={close} hitSlop={12}>
            <Text style={[font.headline, { color: c.accent }]}>Done</Text>
          </Pressable>
        </View>
        <View style={[styles.search, { backgroundColor: c.card }]}>
          <Icon name="magnifyingglass" size={17} color={c.muted} />
          <TextInput
            accessibilityLabel="Search languages"
            value={query}
            onChangeText={setQuery}
            placeholder="Search"
            placeholderTextColor={c.faint}
            autoCorrect={false}
            clearButtonMode="while-editing"
            style={{ flex: 1, fontSize: 17, color: c.text }}
          />
        </View>
        <FlatList
          data={items}
          keyExtractor={([code]) => code}
          keyboardShouldPersistTaps="handled"
          getItemLayout={(_, index) => ({ length: ROW, offset: ROW * index, index })}
          contentContainerStyle={{ paddingBottom: space.xl }}
          renderItem={({ item: [code, name] }) => {
            const on = code === selected;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => {
                  onPick(code);
                  close();
                }}
                style={({ pressed }) => [styles.row, { borderColor: c.border, backgroundColor: pressed ? c.card : 'transparent' }]}>
                <Text style={[font.body, { color: on ? c.accent : c.text, fontWeight: on ? '600' : '400' }]}>{name}</Text>
                {on ? <Icon name="checkmark" size={17} color={c.accent} /> : null}
              </Pressable>
            );
          }}
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
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.md,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    height: 40,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    marginHorizontal: space.md,
    marginBottom: space.sm,
  },
  row: {
    height: ROW,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginLeft: space.lg,
    paddingRight: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
