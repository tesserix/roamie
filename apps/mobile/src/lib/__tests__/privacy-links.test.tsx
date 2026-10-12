import { expect, jest, test, beforeEach } from '@jest/globals';
import { Linking } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { PrivacyLinks } from '../../components/privacy-links';

jest.mock('@react-native-async-storage/async-storage', () => ({getItem:jest.fn(async()=>null),setItem:jest.fn(async()=>{})}));

beforeEach(() => { jest.restoreAllMocks(); });
test('account deletion opens the public request page without requiring sign-in', async () => {
 const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
 await render(<PrivacyLinks />);
 await fireEvent.press(screen.getByRole('link', {name:'Delete my account'}));
 expect(open).toHaveBeenCalledWith('https://roamie-api.tesserix.app/account-deletion');
});
test('a failed link gives a usable support fallback without claiming a deletion happened', async () => {
 jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('unavailable'));
 await render(<PrivacyLinks />);
 await fireEvent.press(screen.getByRole('link', {name:'Privacy policy'}));
 await waitFor(() => expect(screen.getByRole('alert').props.children).toContain('sales@tesserix.app'));
 expect(screen.queryByText('Account deleted')).toBeNull();
});
