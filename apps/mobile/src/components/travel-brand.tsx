import Feather from '@expo/vector-icons/Feather';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { font, useColors } from '@/constants/theme';
import { useAccessibility } from '@/lib/accessibility';


export function RoamieMark({ size = 42 }: { size?: number }) {
  return <Image source={require('../../assets/brand/roamie-mark.png')} style={{ width: size, height: size }} accessible={false} />;
}

export function BrandHeader() {
  const c = useColors();
  return <View accessible accessibilityLabel="Roamie, your travel mate" style={styles.wordmark}>
    <RoamieMark />
    <Text style={{ color: c.text, fontSize: 25, fontWeight: '700', letterSpacing: -1 }}>roamie<Text style={{ color: c.accent }}>.</Text></Text>
  </View>;
}

export function TravelHero() {
  const c = useColors();
  return <View style={[styles.hero, { backgroundColor: c.accentSoft }]}>
    <View style={styles.heroCopy}>
      <Text style={{ color: c.accent, fontSize: 11, fontWeight: '700', letterSpacing: 2 }}>MADE FOR YOUR WORLD</Text>
      <Text style={{ color: c.text, fontSize: 24, lineHeight: 29, fontWeight: '600', letterSpacing: -0.7 }}>Big world.{ '\n' }Good company.</Text>
      <View style={styles.wordmark} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Feather name="compass" size={19} color={c.accent} />
        <Feather name="map" size={19} color={c.accent} />
        <Feather name="camera" size={19} color={c.accent} />
      </View>
    </View>
    <View style={styles.earthScene} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.orbit, { borderColor: c.accent }]} />
      <Image source={require('../../assets/brand/earth.jpg')} contentFit="cover" style={styles.earth} />
      <View style={styles.plane}><FontAwesome name="plane" size={25} color="#115E59" /></View>
    </View>
  </View>;
}

export function TravelLoading() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { reducedMotion, screenReader } = useAccessibility();
  const [progress] = useState(() => new Animated.Value(0));
  useEffect(() => {
    let live = true;
    let animation: Animated.CompositeAnimation | undefined;
    progress.setValue(0);
    if (!reducedMotion && !screenReader) {
      void AccessibilityInfo.isReduceMotionEnabled().then(reduce => {
        if (!live || reduce) return;
        animation = Animated.loop(Animated.sequence([
          Animated.timing(progress, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(progress, { toValue: 0, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]));
        animation.start();
      }).catch(() => {});
    }
    return () => { live = false; animation?.stop(); };
  }, [progress, reducedMotion, screenReader]);
  return <View onLayout={() => { void import('expo-splash-screen').then(splash => splash.hideAsync()); }} style={[styles.loading, { backgroundColor: c.background, paddingTop: insets.top + 32, paddingBottom: insets.bottom + 32 }]}>
    <BrandHeader />
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Getting Roamie ready" accessibilityState={{ busy: true }} style={styles.loadingCenter}>
      <RoamieMark size={112} />
      <Text style={[font.title, { color: c.text, textAlign: 'center' }]}>Your next chapter awaits.</Text>
      <Text style={[font.body, { color: c.muted }]}>Getting Roamie ready</Text>
      <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.transport, { borderColor: c.border }]}>
        {(['plane', 'car', 'train'] as const).map((name, index) => <Animated.View key={name} style={{ transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [-7, 7] }) }, { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, index === 0 ? -10 : 0] }) }] }}><FontAwesome name={name} size={25} color={c.accent} /></Animated.View>)}
      </View>
    </View>
    <Text style={[font.caption, { color: c.muted, textAlign: 'center' }]}>A little less planning. A lot more exploring.</Text>
  </View>;
}

const styles = StyleSheet.create({
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  hero: { borderRadius: 26, padding: 20, flexDirection: 'row', alignItems: 'center', overflow: 'hidden', gap: 8 },
  heroCopy: { flex: 1, gap: 14 },
  earthScene: { width: 132, height: 164, justifyContent: 'center', alignItems: 'center' },
  earth: { width: 130, height: 130, borderRadius: 65 },
  orbit: { position: 'absolute', width: 164, height: 164, borderRadius: 82, borderWidth: 1, borderStyle: 'dashed', opacity: 0.35 },
  plane: { position: 'absolute', top: 0, right: -3, backgroundColor: '#F4C76B', width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-15deg' }] },
  loading: { flex: 1, paddingHorizontal: 28 },
  loadingCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 22 },
  transport: { marginTop: 12, padding: 20, flexDirection: 'row', gap: 34, borderBottomWidth: 1 },
});
