import { expect, test } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { TripMemoryCard } from '../../components/trip-memory-card';
import { createTrip } from '../trips';

test('the day share card names the selected destination instead of the first city', async () => {
  const trip = createTrip({title:'Japan',destination:'Tokyo, Japan',startDate:'2026-10-20',endDate:'2026-10-21',currency:'AUD',budgetMinor:250000,travellers:3,diet:'vegetarian',interests:''});
  trip.days[1].destination = 'Kyoto, Japan';
  await render(<TripMemoryCard trip={trip} day={1} />);
  expect(screen.getByText('Kyoto, Japan · 2026-10-21')).toBeTruthy();
  expect(screen.queryByText('Tokyo, Japan · 2026-10-21')).toBeNull();
});
