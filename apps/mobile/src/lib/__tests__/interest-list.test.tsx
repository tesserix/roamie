import { expect, it, jest } from '@jest/globals';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { InterestList } from '../../components/interest-list';
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}) }));
function Harness({ seen }: { seen: (value: string) => void }) {
 const [value, setValue] = useState('');
 return <InterestList label="Things you love" value={value} change={next => { setValue(next); seen(next); }} />;
}
it('adds each entry below on enter, skips duplicates and removes on tap', async () => {
 const seen = jest.fn<(value: string) => void>();
 await render(<Harness seen={seen} />);
 const input = screen.getByLabelText('Things you love');
 await fireEvent.changeText(input, ' Shopping ');
 await fireEvent(input, 'submitEditing');
 expect(screen.getByRole('button', { name: 'Remove Shopping' })).toBeTruthy();
 expect(input.props.value).toBe('');
 await fireEvent.changeText(input, 'Street food, shopping');
 await fireEvent(input, 'submitEditing');
 expect(seen).toHaveBeenLastCalledWith('Shopping, Street food');
 await fireEvent.press(screen.getByRole('button', { name: 'Remove Shopping' }));
 expect(seen).toHaveBeenLastCalledWith('Street food');
});
it('keeps a typed entry when the field loses focus', async () => {
 const seen = jest.fn<(value: string) => void>();
 await render(<Harness seen={seen} />);
 const input = screen.getByLabelText('Things you love');
 await fireEvent.changeText(input, 'Museums');
 await fireEvent(input, 'blur');
 expect(seen).toHaveBeenLastCalledWith('Museums');
});
