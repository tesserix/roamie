import { Pressable, Switch, View } from 'react-native';
import { Text } from '@/components/typography';
import { APPEARANCES, TEXT_SIZES, useAccessibility } from '@/lib/accessibility';
import { font, radius, space, useColors } from '@/constants/theme';

export function DisplaySettings() {
  const settings = useAccessibility(), c = useColors();
  const size = TEXT_SIZES.find(option => option.value === settings.textSize)!;
  return <View style={{ gap: space.md }}>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center', justifyContent: 'space-between' }}>
      <Text accessibilityRole="header" maxFontSizeMultiplier={1.35} style={[font.title, { color: c.text }]}>Display</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Reset display to normal" disabled={!settings.ready} accessibilityState={{ disabled: !settings.ready }} onPress={() => settings.update({ textSize: 'normal', appearance: 'system', highContrast: false })} style={({ pressed }) => ({ minHeight: 48, paddingHorizontal: 12, justifyContent: 'center', borderRadius: radius.sm, backgroundColor: c.surface, opacity: !settings.ready ? 0.4 : pressed ? 0.7 : 1 })}>
        <Text maxFontSizeMultiplier={1.35} style={[font.headline, { color: c.accent }]}>Reset to normal</Text>
      </Pressable>
    </View>
    <Text maxFontSizeMultiplier={1.35} style={[font.body, { color: c.muted }]}>Choose what feels comfortable. Changes apply immediately and stay saved on this device.</Text>
    <Text maxFontSizeMultiplier={1.35} accessibilityRole="header" style={[font.headline, { color: c.text }]}>Text size</Text>
    <View accessibilityRole="radiogroup" accessibilityLabel="Text size" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
      {TEXT_SIZES.map(option => {
        const checked = option.value === settings.textSize;
        return <Pressable key={option.value} accessibilityRole="radio" accessibilityLabel={option.value === 'system' ? 'Phone text size' : `${option.label} text`} accessibilityState={{ checked, disabled: !settings.ready }} disabled={!settings.ready} onPress={() => settings.update({ textSize: option.value })} style={({ pressed }) => ({ minHeight: 48, flexBasis: 140, flexGrow: 1, padding: 12, justifyContent: 'center', alignItems: 'center', borderRadius: radius.md, borderWidth: 1, borderColor: checked ? c.accent : c.border, backgroundColor: checked ? c.accent : c.surface, opacity: !settings.ready ? 0.4 : pressed ? 0.7 : 1 })}>
          <Text maxFontSizeMultiplier={1.35} style={[font.headline, { color: checked ? c.onAccent : c.text }]}>{option.label}</Text>
        </Pressable>;
      })}
    </View>
    <Text maxFontSizeMultiplier={1.35} style={[font.caption, { color: c.muted }]}>{size.description}</Text>
    <Text maxFontSizeMultiplier={1.35} accessibilityRole="header" style={[font.headline, { color: c.text }]}>Appearance</Text>
    <View accessibilityRole="radiogroup" accessibilityLabel="Appearance" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
      {APPEARANCES.map(option => {
        const checked = option.value === settings.appearance;
        return <Pressable key={option.value} accessibilityRole="radio" accessibilityLabel={`${option.label} appearance`} accessibilityState={{ checked, disabled: !settings.ready }} disabled={!settings.ready} onPress={() => settings.update({ appearance: option.value })} style={({ pressed }) => ({ minHeight: 48, minWidth: 80, flexGrow: 1, padding: 12, justifyContent: 'center', alignItems: 'center', borderRadius: radius.md, borderWidth: 1, borderColor: checked ? c.accent : c.border, backgroundColor: checked ? c.accent : c.surface, opacity: !settings.ready ? 0.4 : pressed ? 0.7 : 1 })}>
          <Text maxFontSizeMultiplier={1.35} style={[font.headline, { color: checked ? c.onAccent : c.text }]}>{option.label}</Text>
        </Pressable>;
      })}
    </View>
    <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
      <Text maxFontSizeMultiplier={1.35} style={[font.headline, { color: c.text, flex: 1 }]}>High contrast</Text>
      <Switch accessibilityLabel="High contrast" accessibilityHint="Stronger text and clearer borders." value={settings.highContrast} disabled={!settings.ready} trackColor={{ false: c.faint, true: c.accent }} onValueChange={highContrast => settings.update({ highContrast })} />
    </View>
    <View style={{ padding: space.md, gap: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface }}>
      <Text accessibilityRole="header" style={[font.headline, { color: c.text }]}>Preview</Text>
      <Text style={[font.body, { color: c.text }]}>Your next adventure, made simple.</Text>
      <Text style={[font.caption, { color: c.muted }]}>Your trips and expenses stay the same.</Text>
    </View>
  </View>;
}
