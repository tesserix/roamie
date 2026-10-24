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
  expect(screen.getByText(/Tap Merchant in the Roamie action/)).toBeTruthy();
  expect(screen.getByText(/Search actions for Roamie and choose Log card payment/)).toBeTruthy();
  expect(screen.getByText(/Add a trip in Trips/)).toBeTruthy();
  expect(screen.getByText(/For a test trip that includes today/)).toBeTruthy();
  expect(screen.getByText(/1.00 AUD/)).toBeTruthy();
  expect(screen.getByText(/Tap Amount → Select Variable → Shortcut Input → Amount/)).toBeTruthy();
  expect(screen.getByRole('header', { name: 'If a payment does not appear' })).toBeTruthy();
  const launch = jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('Unavailable'));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await fireEvent.press(screen.getByRole('button', { name: 'Open Shortcuts' }));
  expect(launch).toHaveBeenCalledWith('shortcuts://');
  await waitFor(() => expect(alert).toHaveBeenCalledWith('Open Shortcuts manually', expect.stringContaining('Automation')));
});
