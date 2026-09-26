import { expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { CommunicationCards } from '../../components/communication-cards';
jest.mock('@react-native-async-storage/async-storage',()=>({getItem:jest.fn(async()=>null),setItem:jest.fn(async()=>{})}));
jest.mock('react-native-safe-area-context',()=>({useSafeAreaInsets:()=>({top:0,bottom:0,left:0,right:0})}));
test('traveller can choose an offline card, edit it and show the exact message',async()=>{
 await render(<CommunicationCards/>);
 await fireEvent.press(screen.getByRole('button',{name:'Communication cards'}));
 await fireEvent.press(screen.getByRole('button',{name:'Please write your reply'}));
 const input=screen.getByLabelText('Card message in English');
 await fireEvent.changeText(input,'Please type your reply. Thank you.');
 await fireEvent.press(screen.getByRole('button',{name:'Show message'}));
 expect(screen.getByText('Please type your reply. Thank you.')).toBeTruthy();
 await fireEvent.press(screen.getByRole('button',{name:'Edit message'}));
 expect(screen.getByLabelText('Card message in English').props.value).toBe('Please type your reply. Thank you.');
 await fireEvent.changeText(screen.getByLabelText('Card message in English'),'   ');
 expect(screen.getByRole('button',{name:'Show message'}).props.accessibilityState.disabled).toBe(true);
});
