import { afterEach, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { TextTranslate } from '../../components/text-translate';
import { ApiError, translateText } from '../api';

jest.mock('../api', () => ({ ApiError: class extends Error {}, translateText: jest.fn() }));
jest.mock('../feedback', () => ({ signalFeedback: jest.fn() }));
jest.mock('../../components/language-picker', () => ({ LanguagePicker: () => null }));
jest.mock('../../components/show-them', () => ({ ShowThem: () => null }));
jest.mock('../../components/ui', () => {
  const { Pressable, Text } = jest.requireActual<typeof import('react-native')>('react-native');
  const button = ({ label, onPress }: { label: string; onPress: () => void }) => <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}><Text>{label}</Text></Pressable>;
  return { Icon: () => null, SpeakButton: () => null, IconButton: button, Button: button };
});

afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); jest.clearAllMocks(); });

test('editing text hides the previous translation immediately', async () => {
  jest.useFakeTimers();
  jest.mocked(translateText).mockResolvedValue({ detected: 'en', translation: 'Bonjour', romanized: '', sourceRomanized: '', alternatives: [] });
  await render(<TextTranslate mine="en" partner="fr" bottom={0} />);
  await fireEvent.changeText(screen.getByLabelText('Text to translate'), 'Hello');
  await act(async () => { await jest.advanceTimersByTimeAsync(701); });
  expect(screen.getByText('Bonjour')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Text to translate'), 'Goodbye');
  expect(screen.queryByText('Bonjour')).toBeNull();
});

test('a failed translation can be retried without editing the text', async () => {
  jest.useFakeTimers();
  jest.mocked(translateText).mockRejectedValueOnce(new ApiError('Connection lost.'));
  await render(<TextTranslate mine="en" partner="fr" bottom={0} />);
  await fireEvent.changeText(screen.getByLabelText('Text to translate'), 'Hello');
  await act(async () => { await jest.advanceTimersByTimeAsync(701); });
  expect(screen.getByText('Connection lost.')).toBeTruthy();
  jest.mocked(translateText).mockResolvedValueOnce({ detected: 'en', translation: 'Bonjour', romanized: '', sourceRomanized: '', alternatives: [] });
  await fireEvent.press(screen.getByRole('button', { name: 'Retry translation' }));
  await act(async () => { await jest.advanceTimersByTimeAsync(701); });
  expect(screen.getByText('Bonjour')).toBeTruthy();
  expect(screen.queryByText('Connection lost.')).toBeNull();
});
