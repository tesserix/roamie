import { expect, jest, test } from '@jest/globals';
import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AccessibilityProvider, useAccessibility } from '../accessibility';
import { Text, TextInput } from '../../components/typography';

jest.mock('@react-native-async-storage/async-storage', () => ({getItem: jest.fn(async () => null), setItem: jest.fn(async () => {})}));

function Sample() {
 const { ready, update } = useAccessibility();
 const [note, setNote] = useState('Dinner');
 return <>
   <Pressable accessibilityRole="button" accessibilityLabel="Large" disabled={!ready} onPress={() => update({textSize: 'large'})}><Text>Large</Text></Pressable>
   <Pressable accessibilityRole="button" accessibilityLabel="Normal" disabled={!ready} onPress={() => update({textSize: 'normal'})}><Text>Normal</Text></Pressable>
   <Text style={{fontSize: 20, lineHeight: 28}}>Trip <Text accessibilityLabel="Nested label">total</Text></Text>
   <TextInput accessibilityLabel="Expense note" value={note} onChangeText={setNote} style={{fontSize: 16, lineHeight: 22, minHeight: 48}} />
 </>;
}

test('forms resize with their text without losing edits and nested labels inherit one scale', async () => {
 await render(<AccessibilityProvider><Sample /></AccessibilityProvider>);
 await waitFor(() => expect(screen.getByRole('button', {name: 'Large'}).props.accessibilityState.disabled).not.toBe(true));
 await fireEvent.changeText(screen.getByLabelText('Expense note'), 'Dinner in Hanoi');
 await fireEvent.press(screen.getByRole('button', {name: 'Large'}));
 expect(StyleSheet.flatten(screen.getByText('Trip total').props.style)).toMatchObject({fontSize: 24, lineHeight: 33.6});
 expect(StyleSheet.flatten(screen.getByLabelText('Nested label').props.style)?.fontSize).toBeUndefined();
 const input = screen.getByLabelText('Expense note');
 expect(StyleSheet.flatten(input.props.style)).toMatchObject({fontSize: 19.2, lineHeight: 26.4, minHeight: 48});
 expect(input.props.value).toBe('Dinner in Hanoi');
 expect(input.props.allowFontScaling).toBe(false);
 await fireEvent.press(screen.getByRole('button', {name: 'Normal'}));
 expect(StyleSheet.flatten(screen.getByLabelText('Expense note').props.style)).toMatchObject({fontSize: 16, lineHeight: 22, minHeight: 48});
 expect(screen.getByLabelText('Expense note').props.value).toBe('Dinner in Hanoi');
});
