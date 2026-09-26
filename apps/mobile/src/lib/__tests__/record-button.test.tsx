import { expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { RecordButton } from '../../components/record-button';
jest.mock('@react-native-async-storage/async-storage',()=>({getItem:jest.fn(async()=>null),setItem:jest.fn(async()=>{})}));
test('recording works with a single accessible activation and exposes its state',async()=>{
 const toggle=jest.fn();
 const view=await render(<RecordButton phase="idle" onPress={toggle}/>);
 await fireEvent.press(screen.getByRole('button',{name:'Start recording'}));
 expect(toggle).toHaveBeenCalledTimes(1);
 await view.rerender(<RecordButton phase="listening" onPress={toggle}/>);
 await fireEvent.press(screen.getByRole('button',{name:'Finish and translate'}));
 expect(toggle).toHaveBeenCalledTimes(2);
 await view.rerender(<RecordButton phase="thinking" onPress={toggle}/>);
 await fireEvent.press(screen.getByRole('button',{name:'Translating'}));
 expect(toggle).toHaveBeenCalledTimes(2);
});

test('shows concise instructions and a distinct recording state', async () => {
 const view = await render(<RecordButton phase="idle" onPress={jest.fn()} />);
 expect(screen.getByText('Tap to talk')).toBeTruthy();
 await view.rerender(<RecordButton phase="listening" onPress={jest.fn()} />);
 expect(screen.getByText('Tap to translate')).toBeTruthy();
 expect(screen.getByRole('button', { name: 'Finish and translate' }).props.accessibilityState.selected).toBe(true);
});
