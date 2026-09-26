import { Platform, useColorScheme, type ViewStyle } from 'react-native';

import { useAccessibility } from '@/lib/accessibility';

// Window-seat palette: sky, passport navy, azure, and one marigold sun for the hero action.
const palette = {
  light: {
    text: '#0B2545',
    muted: '#4F6479',
    faint: '#4F6479',
    background: '#D8E8F6',
    surface: '#FFFFFF',
    card: '#C8DCEF',
    border: '#B9D0E6',
    accent: '#0A5FA8',
    accentSoft: '#C4DDF5',
    onAccent: '#FFFFFF',
    sun: '#F4B23E',
    onSun: '#0B2545',
    warn: '#B54708',
    warnSoft: '#FEF0E1',
    danger: '#D92D20',
    dangerSoft: '#FDECEA',
  },
  dark: {
    text: '#EEF4FA',
    muted: '#9DB0C4',
    faint: '#9DB0C4',
    background: '#08131F',
    surface: '#0F1E2E',
    card: '#172A3D',
    border: '#243B52',
    accent: '#6CB8FF',
    accentSoft: '#12304D',
    onAccent: '#04213A',
    sun: '#FFC857',
    onSun: '#08131F',
    warn: '#F79009',
    warnSoft: '#35230F',
    danger: '#F97066',
    dangerSoft: '#3A1714',
  },
} as const;

export type Colors = { [K in keyof typeof palette.light]: string };

export function useColors(): Colors {
  const dark = useColorScheme() === 'dark';
  const { highContrast } = useAccessibility();
  const base = palette[dark ? 'dark' : 'light'];
  return highContrast ? { ...base, text: dark ? '#FFFFFF' : '#000000', muted: dark ? '#F2F4F7' : '#344054', faint: dark ? '#D0D5DD' : '#475467', border: dark ? '#D0D5DD' : '#475467' } : base;
}

export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
export const radius = { sm: 10, md: 14, lg: 22, pill: 999 } as const;
export const touch = 48;

export const font = {
  largeTitle: { fontSize: 34, fontWeight: '700', letterSpacing: -0.6 },
  title: { fontSize: 22, fontWeight: '700', letterSpacing: -0.3 },
  headline: { fontSize: 17, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 22 },
  caption: { fontSize: 13, lineHeight: 18 },
  overline: { fontSize: 12, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase' },
} as const;

// Soft elevation for white cards; Android has no coloured shadows so it gets elevation.
export const lift: Pick<ViewStyle, 'shadowColor' | 'shadowOpacity' | 'shadowRadius' | 'shadowOffset' | 'elevation'> = Platform.select({
  ios: { shadowColor: '#0B2545', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  default: { elevation: 1 },
});
