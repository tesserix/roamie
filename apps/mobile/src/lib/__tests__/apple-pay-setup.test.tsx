import { afterEach, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, Linking } from 'react-native';
import { ApplePaySetup } from '../../components/apple-pay-setup';

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}) }));
afterEach(() => { jest.restoreAllMocks(); });

test('explains the blank-automation step, transaction variables and a synthetic test before opening Shortcuts', async () => {
  await render(<ApplePaySetup home="AUD" tripCount={0} onClose={() => {}} />);
  expect(screen.getByText(/Get Started/)).toBeTruthy();
  expect(screen.getByText(/New Blank Automation/)).toBeTruthy();
  expect(screen.getByText(/Shortcut Input/)).toBeTruthy();
  expect(screen.getByText(/Log card payment/)).toBeTruthy();
  expect(screen.getByText(/Add a trip in Trips/)).toBeTruthy();
  expect(screen.getByText(/Test cafe/)).toBeTruthy();
  expect(screen.getByText(/1.00 AUD/)).toBeTruthy();
  const launch = jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('Unavailable'));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await fireEvent.press(screen.getByRole('button', { name: 'Open Shortcuts' }));
  expect(launch).toHaveBeenCalledWith('shortcuts://');
  await waitFor(() => expect(alert).toHaveBeenCalledWith('Open Shortcuts manually', expect.stringContaining('Automation')));
});
