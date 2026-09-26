import { Platform, useColorScheme, type ViewStyle } from 'react-native';

import { useAccessibility } from '@/lib/accessibility';

const palette = {
  light: {
    text: '#101828',
    muted: '#667085',
    faint: '#667085',
    background: '#F6F5F2',
    surface: '#FFFFFF',
    card: '#EFEEEA',
    border: '#E4E2DC',
    accent: '#0F766E',
    accentSoft: '#E1F0EE',
    onAccent: '#FFFFFF',
    warn: '#B54708',
    warnSoft: '#FEF0E1',
    danger: '#D92D20',
    dangerSoft: '#FDECEA',
  },
  dark: {
    text: '#F2F4F7',
    muted: '#98A2B3',
    faint: '#98A2B3',
    background: '#0C0E10',
    surface: '#16191C',
    card: '#1F2327',
    border: '#2A2F34',
    accent: '#2DD4BF',
    accentSoft: '#12302D',
    onAccent: '#042F2A',
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
  ios: { shadowColor: '#101828', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  default: { elevation: 1 },
});
