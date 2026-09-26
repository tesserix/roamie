import { expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ShowThem } from '../../components/show-them';

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('expo-speech', () => ({ stop: jest.fn(), speak: jest.fn(), getAvailableVoicesAsync: jest.fn(async () => []) }));

test('opens toward the other person and resets that direction every time it opens', async () => {
  await render(<ShowThem shown={{ text: 'Bonjour', lang: 'fr' }} onClose={() => {}} />);
  const rotation = () => StyleSheet.flatten(screen.getByTestId('enlarged-conversation').props.contentContainerStyle).transform;
  expect(rotation()).toEqual([{ rotate: '180deg' }]);
  await fireEvent.press(screen.getByRole('button', { name: 'Flip text' }));
  expect(rotation()).toBeUndefined();
  await fireEvent(screen.getByText('Bonjour'), 'show');
  expect(rotation()).toEqual([{ rotate: '180deg' }]);
  expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
});
