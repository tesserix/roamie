import { expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { CameraTranslate } from '../../components/camera-translate';
import { translateSign } from '../api';

jest.mock('../accessibility', () => ({ useAccessibility: () => ({ highContrast: false }) }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn(async () => ({ canceled: false, assets: [{ uri: 'file:///IMG_0001.HEIC', width: 3024, height: 4032, mimeType: 'image/heic' }] })) }));
jest.mock('expo-image-manipulator', () => {
  const image = { width: 1536, height: 2048, release: () => undefined, saveAsync: async () => ({ uri: 'file:///cache/photo.jpg', width: 1536, height: 2048, base64: '/9j/JPEG' }) };
  const context = { resize: () => context, renderAsync: async () => image, release: () => undefined };
  return { SaveFormat: { JPEG: 'jpeg' }, ImageManipulator: { manipulate: () => context } };
});
jest.mock('../api', () => ({ ApiError: class extends Error {}, translateSign: jest.fn(async () => ({ detected: 'ja', gist: 'Exit', lines: [], reviewRequired: true })) }));
jest.mock('../../components/ui', () => {
  const { Pressable, Text, View } = jest.requireActual<typeof import('react-native')>('react-native');
  const button = ({ label, onPress }: { label: string; onPress: () => void }) => <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}><Text>{label}</Text></Pressable>;
  return { Badge: () => null, SpeakButton: () => null, Button: button, Chip: button, Message: ({ action }: { action: React.ReactNode }) => <View>{action}</View> };
});

test('uncertain photo text asks the traveller to check the original', async () => {
  await render(<CameraTranslate mine="en" bottom={0} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Choose from photos' }));
  expect(await screen.findByText('Some text is uncertain. Check the original photo before relying on this translation.')).toBeTruthy();
  expect(screen.getByText('Exit')).toBeTruthy();
});

test('an iPhone HEIC photo is read as an upright JPEG', async () => {
  await render(<CameraTranslate mine="en" bottom={0} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Choose from photos' }));
  expect(await screen.findByText('Exit')).toBeTruthy();
  expect(translateSign).toHaveBeenCalledWith('/9j/JPEG', 'image/jpeg', 'en');
});
