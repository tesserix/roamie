import { useColorScheme } from 'react-native';

const palette = {
  light: {
    text: '#11181C',
    muted: '#5F6B73',
    background: '#FFFFFF',
    card: '#F2F5F4',
    border: '#DDE3E1',
    accent: '#0E7C66',
    onAccent: '#FFFFFF',
    warn: '#B45309',
    danger: '#C62828',
  },
  dark: {
    text: '#ECEDEE',
    muted: '#9BA7AE',
    background: '#0B0F0E',
    card: '#161C1B',
    border: '#26302E',
    accent: '#34C3A0',
    onAccent: '#04221B',
    warn: '#F59E0B',
    danger: '#EF5350',
  },
} as const;

export type Colors = (typeof palette)['light'] | (typeof palette)['dark'];

export function useColors(): Colors {
  return palette[useColorScheme() === 'dark' ? 'dark' : 'light'];
}

export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
export const radius = { md: 12, lg: 20, pill: 999 } as const;
export const touch = 48;
