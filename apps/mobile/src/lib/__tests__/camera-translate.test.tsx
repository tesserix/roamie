import { expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { CameraTranslate } from '../../components/camera-translate';
import * as ImagePicker from 'expo-image-picker';
import { translateSign } from '../api';

jest.mock('../accessibility', () => ({ useAccessibility: () => ({ highContrast: false }) }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn(async () => ({ canceled: false, assets: [{ uri: 'file:///photo.jpg', width: 100, height: 100, base64: '/9j/AAAA', mimeType: 'image/jpeg' }] })) }));
jest.mock('../api', () => ({ ApiError: class extends Error {}, translateSign: jest.fn(async () => ({ detected: 'ja', gist: 'Exit', lines: [], reviewRequired: true })) }));
jest.mock('../../components/ui', () => {
  const { Pressable, Text, View } = jest.requireActual<typeof import('react-native')>('react-native');
  const button = ({ label, onPress }: { label: string; onPress: () => void }) => <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}><Text>{label}</Text></Pressable>;
  return { Badge: () => null, Icon: () => null, SpeakButton: () => null, Button: button, Chip: button, Message: ({ action }: { action: React.ReactNode }) => <View>{action}</View> };
});

test('uncertain photo text asks the traveller to check the original', async () => {
  await render(<CameraTranslate mine="en" bottom={0} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Choose from photos' }));
  expect(await screen.findByText('Some text is uncertain. Check the original photo before relying on this translation.')).toBeTruthy();
  expect(screen.getByText('Exit')).toBeTruthy();
});

test('the Original chip swaps the translated overlay for the photo itself', async () => {
  jest.mocked(translateSign).mockResolvedValueOnce({
    detected: 'vi',
    gist: 'A noodle menu',
    lines: [{ original: 'Phở gà', translation: 'Chicken pho', romanized: '', box: { x: 0.1, y: 0.1, w: 0.1, h: 0.06 } }],
  });
  await render(<CameraTranslate mine="en" bottom={0} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Choose from photos' }));
  expect(await screen.findAllByText('Chicken pho')).toHaveLength(2);
  await fireEvent.press(screen.getByRole('button', { name: 'Original' }));
  expect(screen.getAllByText('Chicken pho')).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'New photo' })).toBeTruthy();
});

test('a local photo URI works without loading a base64 copy into JavaScript', async () => {
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///local-only.jpg', width: 100, height: 100 }] });
  await render(<CameraTranslate mine="en" partner="fr" bottom={0} offlineOnly />);
  await fireEvent.press(screen.getByRole('button', { name: 'Choose from photos' }));
  expect(await screen.findByText('Exit')).toBeTruthy();
  expect(translateSign).toHaveBeenLastCalledWith('', 'image/jpeg', 'en', expect.objectContaining({ uri: 'file:///local-only.jpg', from: 'fr', offlineOnly: true }));
});
