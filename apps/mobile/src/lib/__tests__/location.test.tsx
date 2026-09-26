import { beforeEach, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import { useHere } from '../location';
jest.mock('expo-router', () => ({ useIsFocused: () => true }));
jest.mock('expo-localization', () => ({ getLocales: () => [{ regionCode: 'US' }] }));
jest.mock('expo-location', () => ({ requestForegroundPermissionsAsync: jest.fn(), getCurrentPositionAsync: jest.fn(), reverseGeocodeAsync: jest.fn(), Accuracy: { Balanced: 3 } }));
beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
});
it('does not treat the device region as the current country after permission denial', async () => {
  jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue({ granted: false } as never);
  const { result } = await renderHook(() => useHere());
  await waitFor(() => expect(result.current.status).toBe('denied'));
  expect(result.current.country).toBeNull();
});
it('keeps the country unknown when coordinates cannot be reverse geocoded', async () => {
  jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue({ granted: true } as never);
  jest.mocked(Location.getCurrentPositionAsync).mockResolvedValue({ coords: { latitude: -37, longitude: 145 } } as never);
  jest.mocked(Location.reverseGeocodeAsync).mockResolvedValue([]);
  const { result } = await renderHook(() => useHere());
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(result.current.country).toBeNull();
  expect(result.current.coords).toEqual({ lat: -37, lng: 145 });
});
it('handles permission service failures without leaving the screen loading', async () => {
  jest.mocked(Location.requestForegroundPermissionsAsync).mockRejectedValue(new Error('unavailable'));
  const { result } = await renderHook(() => useHere());
  await waitFor(() => expect(result.current.status).toBe('error'));
  expect(result.current.country).toBeNull();
});
it('refreshes the country when the app returns to the foreground', async () => {
  jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue({ granted: true } as never);
  jest.mocked(Location.getCurrentPositionAsync).mockResolvedValue({ coords: { latitude: -37, longitude: 145 } } as never);
  jest.mocked(Location.reverseGeocodeAsync).mockResolvedValueOnce([{ isoCountryCode: 'AU' }] as never).mockResolvedValueOnce([{ isoCountryCode: 'JP' }] as never);
  const { result } = await renderHook(() => useHere());
  await waitFor(() => expect(result.current.country).toBe('AU'));
  const listener = jest.mocked(AppState.addEventListener).mock.calls[0][1];
  await act(async () => listener('active'));
  await waitFor(() => expect(result.current.country).toBe('JP'));
  expect(result.current.checkedAt).not.toBeNull();
});
