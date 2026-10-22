import { Platform, type ViewStyle } from 'react-native';

import { useAccessibility, useAppColorScheme } from '@/lib/accessibility';

const palette = {
  light: {
    text: '#0B2545',
    muted: '#4F6479',
    faint: '#4F6479',
    background: '#F4F7FB',
    surface: '#FFFFFF',
    card: '#EAF0F7',
    border: '#D9E2ED',
    accent: '#0A5FA8',
    accentSoft: '#E6F0FB',
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
  const dark = useAppColorScheme() === 'dark';
  const { highContrast } = useAccessibility();
  const base = palette[dark ? 'dark' : 'light'];
  return highContrast ? { ...base, text: dark ? '#FFFFFF' : '#000000', muted: dark ? '#F2F4F7' : '#344054', faint: dark ? '#D0D5DD' : '#475467', border: dark ? '#D0D5DD' : '#475467' } : base;
}

export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
export const radius = { sm: 12, md: 16, lg: 24, pill: 999 } as const;
export const touch = 48;

export const font = {
  largeTitle: { fontSize: 32, fontWeight: '700', letterSpacing: -0.8 },
  title: { fontSize: 22, fontWeight: '700', letterSpacing: -0.3 },
  headline: { fontSize: 17, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 22 },
  caption: { fontSize: 13, lineHeight: 18 },
  overline: { fontSize: 12, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase' },
} as const;

export const lift: Pick<ViewStyle, 'shadowColor' | 'shadowOpacity' | 'shadowRadius' | 'shadowOffset' | 'elevation'> = Platform.select({
  ios: { shadowColor: '#0B2545', shadowOpacity: 0.035, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } },
  default: { elevation: 1 },
});
