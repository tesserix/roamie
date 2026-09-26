import { expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SearchPicker } from '../../components/search-picker';
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
it('filters options by name or code and selects a result', async () => {
 const choose = jest.fn();
 await render(<SearchPicker title="Country" value="" options={[{value:'AU',label:'Australia'},{value:'JP',label:'Japan'}]} onChange={choose}/>);
 await fireEvent.press(screen.getByRole('button', {name:'Country: Choose'}));
 await fireEvent.changeText(screen.getByLabelText('Search Country'), 'jap');
 expect(screen.queryByText('Australia')).toBeNull();
 await fireEvent.press(screen.getByRole('button',{name:'Japan'}));
 expect(choose).toHaveBeenCalledWith('JP');
 expect(screen.queryByLabelText('Search Country')).toBeNull();
});
