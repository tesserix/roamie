import { expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { CameraTranslate } from '../../components/camera-translate';

jest.mock('../accessibility', () => ({ useAccessibility: () => ({ highContrast: false }) }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn(async () => ({ canceled: false, assets: [{ uri: 'file:///photo.jpg', width: 100, height: 100, base64: '/9j/AAAA', mimeType: 'image/jpeg' }] })) }));
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
