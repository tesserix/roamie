import { expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { StatementReview } from '../../components/statement-review';
import type { StatementRow } from '../statement';

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}) }));

const row = (merchant: string, patch: Partial<StatementRow> = {}): StatementRow => ({
  date: '2026-10-02', merchant, amountMinor: 1000, currency: 'AUD', category: 'food', homeMinor: 1000, duplicate: false, selected: true, ...patch,
});

it('adds only the ticked card spending', async () => {
  const add = jest.fn<(rows: StatementRow[]) => void>();
  await render(
    <StatementReview
      rows={[row('Pho 24'), row('Hotel', { duplicate: true, selected: false }), row('Taxi', { homeMinor: null, selected: false })]}
      home="AUD"
      range="2 Oct – 8 Oct"
      onAdd={add}
      onClose={() => {}}
    />,
  );
  expect(screen.getByText('Already added')).toBeTruthy();
  expect(screen.getByRole('checkbox', { name: /Taxi/ }).props.accessibilityState).toMatchObject({ disabled: true });
  await fireEvent.press(screen.getByRole('checkbox', { name: /Hotel/ }));
  await fireEvent.press(screen.getByRole('checkbox', { name: /Pho 24/ }));
  await fireEvent.press(screen.getByRole('button', { name: 'Add 1 expense' }));
  expect(add.mock.calls[0][0].map(r => r.merchant)).toEqual(['Hotel']);
});

it('explains when nothing on the statement falls inside the trip', async () => {
  await render(<StatementReview rows={[]} home="AUD" range="2 Oct – 8 Oct" onAdd={() => {}} onClose={() => {}} />);
  expect(screen.getByText('No card spending between 2 Oct – 8 Oct')).toBeTruthy();
});
