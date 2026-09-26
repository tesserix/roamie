import { afterEach, expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Animated } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AccessibilityProvider } from '../accessibility';
import { TravelLoading } from '../../components/travel-brand';

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}), clear: jest.fn(async () => {}) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@expo/vector-icons/Feather', () => ({ __esModule: true, default: () => null }));
afterEach(() => { jest.restoreAllMocks(); });
test('loading remains accessible without starting movement when reduced motion is enabled', async () => {
  await AsyncStorage.clear();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  const loop = jest.spyOn(Animated, 'loop');
  await render(<AccessibilityProvider><TravelLoading /></AccessibilityProvider>);
  expect(await screen.findByRole('progressbar', { name: 'Getting Roamie ready' })).toBeTruthy();
  expect(screen.getByText('Your next chapter awaits.')).toBeTruthy();
  expect(loop).not.toHaveBeenCalled();
});
