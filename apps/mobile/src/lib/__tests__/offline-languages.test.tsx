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
  await fireEvent.press(screen.getByRole('button', { name: 'To: Choose downloaded language' }));
  expect(screen.queryByRole('button', { name: 'French' })).toBeNull();
  expect(screen.getByRole('button', { name: 'English' })).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
  expect(screen.getByRole('button', { name: 'Translate on this phone' }).props.accessibilityState.disabled).toBe(true);
});

test('downloads five selected languages and restricts translation choices to installed packs', async () => {
  const downloaded: string[] = [];
  mockNative.status.mockImplementation(async () => ({ online: true, wifi: true, supported: ['en', 'hi', 'fr', 'de', 'ja'], downloaded: [...downloaded] }));
  mockNative.download.mockImplementation(async (...args: unknown[]) => {
    for (const code of args.slice(0, 2) as string[]) if (!downloaded.includes(code)) downloaded.push(code);
  });
  await render(<OfflineLanguages />);
  await fireEvent.press(screen.getByRole('button', { name: 'Offline languages' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Choose languages to download' }));
  for (const name of ['English', 'Hindi', 'French', 'German', 'Japanese']) {
    await fireEvent.changeText(screen.getByLabelText('Search languages'), name);
    await fireEvent.press(screen.getByRole('checkbox', { name }));
  }
  await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Download selected languages' }));
  await waitFor(() => expect(screen.getByText('5 languages downloaded')).toBeTruthy());
  await fireEvent.press(screen.getByRole('button', { name: 'From: English' }));
  expect(screen.queryByRole('button', { name: 'Spanish' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Hindi' })).toBeTruthy();
});
test('a partial download keeps completed packs visible and can be retried', async () => {
  const downloaded = ['en'];
  mockNative.status.mockImplementation(async () => ({ online: true, wifi: true, supported: ['en', 'fr', 'hi'], downloaded: [...downloaded] }));
  mockNative.download.mockImplementationOnce(async () => { downloaded.push('fr'); throw new Error('Connection interrupted'); });
  await render(<OfflineLanguages />);
  await fireEvent.press(screen.getByRole('button', { name: 'Offline languages' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Choose languages to download' }));
  await fireEvent.press(screen.getByRole('checkbox', { name: 'French' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Download selected languages' }));
  await waitFor(() => expect(screen.getByText('Connection interrupted')).toBeTruthy());
  expect(screen.getByText('2 languages downloaded')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Download selected languages' }).props.accessibilityState.disabled).toBe(false);
});
