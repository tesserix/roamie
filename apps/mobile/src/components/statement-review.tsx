import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, Icon, Message } from '@/components/ui';
import { font, radius, space, useColors } from '@/constants/theme';
import { format } from '@/lib/money';
import type { StatementRow } from '@/lib/statement';

export function StatementReview({ rows, home, range, onAdd, onClose }: { rows: StatementRow[]; home: string; range: string; onAdd: (rows: StatementRow[]) => void; onClose: () => void }) {
  const c = useColors();
  const [picked, setPicked] = useState(() => rows.map(r => r.selected));
  const chosen = rows.filter((_, i) => picked[i]);
  const total = chosen.reduce((sum, r) => sum + (r.homeMinor ?? 0), 0);
  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <View style={styles.head}>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={12}>
          <Text style={[font.body, { color: c.muted }]}>Cancel</Text>
        </Pressable>
        <Text style={[font.headline, { color: c.text }]}>Card statement</Text>
        <View style={{ width: 52 }} />
      </View>
      <FlatList
        data={rows}
        keyExtractor={(r, i) => `${r.date}-${r.merchant}-${i}`}
        contentContainerStyle={{ padding: space.md, gap: space.sm }}
        ListHeaderComponent={rows.length ? <Text style={[font.body, { color: c.muted, paddingBottom: space.xs }]}>Spending from {range}. Untick anything that wasn&apos;t part of the trip.</Text> : null}
        ListEmptyComponent={<Message icon="creditcard" title={`No card spending between ${range}`} body="Check the statement covers your trip dates." />}
        renderItem={({ item, index }) => {
          const on = picked[index];
          const blocked = item.homeMinor === null;
          return (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityLabel={`${item.merchant}, ${format(item.amountMinor, item.currency)}, ${item.date}`}
              accessibilityState={{ checked: on, disabled: blocked }}
              disabled={blocked}
              onPress={() => setPicked(p => p.map((v, i) => (i === index ? !v : v)))}
              style={[styles.row, { backgroundColor: c.surface, borderColor: on ? c.accent : c.border, opacity: blocked ? 0.6 : 1 }]}>
              <View style={[styles.box, { borderColor: on ? c.accent : c.border, backgroundColor: on ? c.accent : 'transparent' }]}>
                {on ? <Icon name="checkmark" size={14} color={c.onAccent} /> : null}
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[font.headline, { color: c.text }]} numberOfLines={1}>{item.merchant}</Text>
                <Text style={[font.caption, { color: item.duplicate ? c.warn : c.muted }]}>
                  {item.duplicate ? 'Already added' : blocked ? `Can't convert ${item.currency} right now` : new Date(`${item.date}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                <Text style={[font.headline, { color: c.text }]}>{format(item.homeMinor ?? item.amountMinor, item.homeMinor === null ? item.currency : home)}</Text>
                {item.currency !== home && item.homeMinor !== null ? <Text style={[font.caption, { color: c.muted }]}>{format(item.amountMinor, item.currency)}</Text> : null}
              </View>
            </Pressable>
          );
        }}
      />
      {rows.length ? (
        <View style={{ padding: space.md, gap: space.xs }}>
          <Text style={[font.caption, { color: c.muted, textAlign: 'center' }]}>{format(total, home)} selected</Text>
          <Button label={`Add ${chosen.length} ${chosen.length === 1 ? 'expense' : 'expenses'}`} disabled={!chosen.length} onPress={() => onAdd(chosen)} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingVertical: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: space.md, borderRadius: radius.md, borderWidth: 1, minHeight: 64 },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
