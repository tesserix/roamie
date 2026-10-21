import { expect, jest, test, beforeEach } from '@jest/globals';
import { Linking } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { PrivacyLinks } from '../../components/privacy-links';
import { fetch } from 'expo/fetch';

jest.mock('@react-native-async-storage/async-storage', () => ({getItem:jest.fn(async()=>null),setItem:jest.fn(async()=>{})}));
jest.mock('expo/fetch', () => ({fetch:jest.fn()}));
jest.mock('../auth-client', () => ({API_BASE:'https://roamie-api.tesserix.app',session:{current:()=>({sub:'alice'}),revision:()=>1,accessToken:async()=>'token'}}));

beforeEach(() => { jest.restoreAllMocks(); jest.mocked(fetch).mockReset(); });
test('account deletion is submitted in the app only after confirmation', async () => {
 const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
 jest.mocked(fetch).mockResolvedValue({ok:true,status:202,json:async()=>({id:'request-1',status:'pending',owner:'sales@tesserix.app',requestedAt:'2026-10-21T00:00:00Z',dueAt:'2026-11-20T00:00:00Z'})} as Awaited<ReturnType<typeof fetch>>);
 await render(<PrivacyLinks />);
 await fireEvent.press(screen.getByRole('button', {name:'Delete my account'}));
 expect(fetch).not.toHaveBeenCalled();
 expect(screen.getByText(/within 30 days/)).toBeTruthy();
 await fireEvent.press(screen.getByRole('button', {name:'Request account deletion'}));
 await waitFor(()=>expect(screen.getByText('Deletion requested')).toBeTruthy());
 expect(fetch).toHaveBeenCalledWith('https://roamie-api.tesserix.app/v1/auth/deletion-request',expect.objectContaining({method:'POST',body:'{}',headers:expect.objectContaining({Authorization:'Bearer token'})}));
 expect(open).not.toHaveBeenCalled();
 expect(screen.queryByText('Account deleted')).toBeNull();
});
test('a failed link gives a usable support fallback without claiming a deletion happened', async () => {
 jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('unavailable'));
 await render(<PrivacyLinks />);
 await fireEvent.press(screen.getByRole('link', {name:'Privacy policy'}));
 await waitFor(() => expect(screen.getByRole('alert').props.children).toContain('sales@tesserix.app'));
 expect(screen.queryByText('Account deleted')).toBeNull();
});
test('a failed deletion request stays retryable and never claims acceptance', async () => {
 jest.mocked(fetch).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ok:true,status:202,json:async()=>({id:'request-2',status:'pending',owner:'sales@tesserix.app',requestedAt:'2026-10-21T00:00:00Z',dueAt:'2026-11-20T00:00:00Z'})} as Awaited<ReturnType<typeof fetch>>);
 await render(<PrivacyLinks />);
 await fireEvent.press(screen.getByRole('button',{name:'Delete my account'}));
 await fireEvent.press(screen.getByRole('button',{name:'Request account deletion'}));
 await waitFor(()=>expect(screen.getByRole('alert').props.children).toContain('offline'));
 expect(screen.queryByText('Deletion requested')).toBeNull();
 await fireEvent.press(screen.getByRole('button',{name:'Request account deletion'}));
 await waitFor(()=>expect(screen.getByText('Deletion requested')).toBeTruthy());
 expect(fetch).toHaveBeenCalledTimes(2);
});
test('keeping an account cancels the confirmation without a request', async () => {
 await render(<PrivacyLinks />);
 await fireEvent.press(screen.getByRole('button',{name:'Delete my account'}));
 await fireEvent.press(screen.getByRole('button',{name:'Keep my account'}));
 expect(screen.queryByText('Delete your Roamie account?')).toBeNull();
 expect(fetch).not.toHaveBeenCalled();
});
