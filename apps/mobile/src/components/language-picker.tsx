import { useEffect, useMemo, useState } from 'react';
import { AppState, FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '@/components/typography';

import { Icon } from '@/components/ui';
import { font, radius, space, touch, useColors } from '@/constants/theme';
import { MAX_OFFLINE_LANGUAGES, offlineCode, offlineStatus, type OfflineStatus } from '@/lib/offline-translation';
import { LANGUAGES, languageName } from '@/lib/languages';

const ITEMS = Object.entries(LANGUAGES).sort((a, b) => a[1].localeCompare(b[1]));
const ROW = touch + 4;

type Props = {
  visible: boolean;
  title: string;
  selected: string;
  allowAuto?: boolean;
  availableCodes?: string[];
  multiple?: boolean;
  selectedCodes?: string[];
  catalogue?: boolean;
  downloadedCodes?: string[];
  maxDownloads?: number;
  onPick: (code: string) => void;
  onClose: () => void;
};

export function LanguagePicker({ visible, title, selected, allowAuto = false, availableCodes, multiple = false, selectedCodes = [], catalogue = false, downloadedCodes = [], maxDownloads = MAX_OFFLINE_LANGUAGES, onPick, onClose }: Props) {
  const c = useColors();
  const [query, setQuery] = useState('');
  const [inventory, setInventory] = useState<OfflineStatus | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!visible || catalogue || availableCodes) return;
    let live = true;
    const refresh = () => {
      void offlineStatus().then(value => { if (live) { setInventory(value); setFailed(false); } }).catch(() => { if (live) { setInventory(null); setFailed(true); } });
    };
    refresh();
    const listener = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    return () => { live = false; listener.remove(); };
  }, [visible, catalogue, availableCodes]);
  const loading = !catalogue && !availableCodes && !inventory && !failed;
  const offline = !catalogue && inventory?.available && !inventory.online;
  const allowed = availableCodes ?? (offline ? inventory.downloaded : undefined);
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const languages = loading || failed ? [] : allowed ? [...new Set(allowed)].map(code => [code === 'tl' ? 'fil' : code, languageName(code)]).sort((a, b) => a[1].localeCompare(b[1])) : ITEMS;
    const choices = allowAuto && !offline && !allowed && !loading && !failed ? [['', 'Auto-detect'], ...languages] : languages;
    return q ? choices.filter(([code, name]) => name.toLowerCase().includes(q) || code === q) : choices;
  }, [query, allowAuto, allowed, offline, loading, failed]);

  const close = () => {
    setQuery('');
    setInventory(null);
    setFailed(false);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <View style={styles.head}>
          <Text style={[font.title, { color: c.text, flex: 1 }]}>{title}</Text>
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
        {catalogue ? <Text style={[font.caption, { color: c.muted, marginHorizontal: space.lg, marginBottom: space.sm }]}>All supported offline languages · {downloadedCodes.length} downloaded · {selectedCodes.length} selected. Keep up to {maxDownloads} languages; remove a downloaded pack to make room.</Text> : null}
        {offline ? <Text style={[font.caption, { color: c.muted, marginHorizontal: space.lg, marginBottom: space.sm }]}>Only downloaded languages are available offline.</Text> : null}
        <FlatList
          data={items}
          ListEmptyComponent={<Text style={[font.body, { color: c.muted, margin: space.lg }]}>{loading ? 'Checking downloaded languages…' : failed ? 'Could not check languages. Close and reopen to retry.' : offline && !inventory?.downloaded.length ? 'No downloaded languages. Open Offline languages while connected to download packs.' : 'No matching languages.'}</Text>}
          keyExtractor={([code]) => code}
          keyboardShouldPersistTaps="handled"
          getItemLayout={(_, index) => ({ length: ROW, offset: ROW * index, index })}
          contentContainerStyle={{ paddingBottom: space.xl }}
          renderItem={({ item: [code, name] }) => {
            const installed = catalogue && downloadedCodes.includes(offlineCode(code));
            const full = new Set([...downloadedCodes, ...selectedCodes.map(offlineCode)]).size >= maxDownloads;
            const disabled = installed || (multiple && full && !selectedCodes.includes(code));
            const on = multiple ? selectedCodes.includes(code) : code === selected;
            return (
              <Pressable
                accessibilityRole={multiple ? "checkbox" : "button"}
                accessibilityLabel={installed ? `${name}, downloaded` : name}
                disabled={disabled}
                accessibilityState={multiple ? { checked: on || installed, disabled } : { selected: on }}
                onPress={() => {
                  onPick(code);
                  if (!multiple) close();
                }}
                style={({ pressed }) => [styles.row, { borderColor: c.border, backgroundColor: pressed ? c.card : 'transparent' }]}>
                <Text style={[font.body, { color: disabled ? c.muted : on ? c.accent : c.text, fontWeight: on ? '600' : '400' }]}>{name}</Text>
                {installed ? <Text style={[font.caption, { color: c.muted }]}>Downloaded</Text> : on ? <Icon name="checkmark" size={17} color={c.accent} /> : null}
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
    minHeight: 40,
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
