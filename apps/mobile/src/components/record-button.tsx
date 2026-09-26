import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { font, useColors } from '@/constants/theme';

export type RecordingPhase = 'idle' | 'starting' | 'listening' | 'thinking';
export function RecordButton({ phase, onPress }: { phase: RecordingPhase; onPress: () => void }) {
  const c = useColors();
  const listening = phase === 'listening';
  const busy = phase === 'starting' || phase === 'thinking';
  const label = listening ? 'Finish and translate' : phase === 'thinking' ? 'Translating' : phase === 'starting' ? 'Opening microphone' : 'Start recording';
  const caption = listening ? 'Tap to translate' : busy ? label : 'Tap to talk';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={listening ? 'Stops recording and translates this turn.' : 'Tap once, speak, then tap again to finish.'}
      accessibilityState={{ disabled: busy, busy, selected: listening }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => ({ flex: 1, alignItems: 'center', gap: 8, paddingVertical: 6, borderRadius: 28, opacity: pressed ? 0.8 : 1 })}>
      <View style={{ padding: 5, borderRadius: 48, borderWidth: 1, borderColor: listening ? c.danger : c.sun, backgroundColor: c.surface }}>
        <View style={{ width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center', backgroundColor: listening ? c.danger : c.sun }}>
          {busy ? <ActivityIndicator color={listening ? c.onAccent : c.onSun} accessible={false} /> : <FontAwesome name={listening ? 'stop' : 'microphone'} size={28} color={listening ? c.onAccent : c.onSun} accessible={false} />}
        </View>
      </View>
      <Text maxFontSizeMultiplier={2} style={[font.body, { color: c.text, textAlign: 'center', fontWeight: '600' }]}>{caption}</Text>
    </Pressable>
  );
}
