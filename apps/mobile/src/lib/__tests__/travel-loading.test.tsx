import { afterEach, expect, jest, test } from '@jest/globals';
import { render, screen, within } from '@testing-library/react-native';
import { AccessibilityInfo, Animated, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AccessibilityProvider } from '../accessibility';
import { OfflineLanguages } from '../../components/offline-languages';
import { TravelLoading } from '../../components/travel-brand';

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}), clear: jest.fn(async () => {}) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 44, bottom: 34 }) }));
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

test('offline shortcut stays inside the loading screen safe area and content margins', async () => {
  await render(<AccessibilityProvider><TravelLoading><OfflineLanguages variant="shortcut" label="Offline translator" /></TravelLoading></AccessibilityProvider>);
  const content = screen.getByTestId('startup-content');
  expect(StyleSheet.flatten(content.props.contentContainerStyle)).toMatchObject({ paddingHorizontal: 28, paddingBottom: 66 });
  expect(within(content).getByRole('button', { name: 'Offline translator' })).toBeTruthy();
  expect(screen.getByText('Download for offline use')).toBeTruthy();
});
