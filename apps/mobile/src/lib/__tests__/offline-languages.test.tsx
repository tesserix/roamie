import { expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { OfflineLanguages } from '../../components/offline-languages';
import { ProfileSettings } from '../../components/profile-settings';
const mockNative = {
  status: jest.fn(async () => ({ online: false, wifi: false, supported: ['en', 'fr'], downloaded: ['en', 'fr'] })),
  translate: jest.fn(async () => 'Bonjour'),
  download: jest.fn(async () => {}),
  remove: jest.fn(async () => {}),
};
jest.mock('expo', () => ({ ...jest.requireActual<Record<string, unknown>>('expo'), requireOptionalNativeModule: () => mockNative }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
test('traveller opens installed languages and translates locally without an account', async () => {
  await render(<OfflineLanguages />);
  await fireEvent.press(screen.getByRole('button', { name: 'Offline languages' }));
  await waitFor(() => expect(screen.getByText('Ready for offline text translation')).toBeTruthy());
  await fireEvent.changeText(screen.getByLabelText('Text to translate offline'), 'Hello');
  await fireEvent.press(screen.getByRole('button', { name: 'Translate on this phone' }));
  await waitFor(() => expect(screen.getByText('Bonjour')).toBeTruthy());
  expect(mockNative.translate).toHaveBeenCalledWith('Hello', 'en', 'fr');
});
test('profile exposes language downloads', async () => {
  await render(<ProfileSettings />);
  await fireEvent.press(screen.getByRole('button', { name: 'Profile settings' }));
  expect(screen.getByRole('button', { name: 'Offline languages' })).toBeTruthy();
});
test('removing a language updates readiness from the device inventory', async () => {
  mockNative.remove.mockImplementationOnce(async () => {
    mockNative.status.mockResolvedValue({ online: false, wifi: false, supported: ['en', 'fr'], downloaded: ['en'] });
  });
  await render(<OfflineLanguages />);
  await fireEvent.press(screen.getByRole('button', { name: 'Offline languages' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Remove French' }));
  await waitFor(() => expect(screen.getByText('Download both languages to use this pair offline')).toBeTruthy());
  expect(mockNative.remove).toHaveBeenCalledWith('fr');
  expect(screen.getByRole('button', { name: 'Translate on this phone' }).props.accessibilityState.disabled).toBe(true);
});
