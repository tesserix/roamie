import { expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { TripDatePicker } from '../../components/trip-date-picker';
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
test('selects a future date across a year boundary and closes the calendar', async () => {
 const change = jest.fn();
 await render(<TripDatePicker value="" minimumDate="2026-12-20" onChange={change} />);
 await fireEvent.press(screen.getByRole('button', { name: 'Departure date: Choose a date' }));
 await fireEvent.press(screen.getByRole('button', { name: 'Next month' }));
 await fireEvent.press(screen.getByRole('button', { name: '10 January 2027' }));
 expect(change).toHaveBeenCalledWith('2027-01-10');
 expect(screen.queryByText('Choose your departure')).toBeNull();
});
test('prevents past dates and cancellation leaves the departure unchanged', async () => {
 const change = jest.fn();
 await render(<TripDatePicker value="2026-12-25" minimumDate="2026-12-20" onChange={change} />);
 await fireEvent.press(screen.getByRole('button', { name: 'Departure date: 25 Dec 2026' }));
 expect(screen.getByRole('button', { name: '19 December 2026' }).props.accessibilityState.disabled).toBe(true);
 await fireEvent.press(screen.getByRole('button', { name: '19 December 2026' }));
 await fireEvent.press(screen.getByRole('button', { name: 'Cancel date selection' }));
 expect(change).not.toHaveBeenCalled();
});
