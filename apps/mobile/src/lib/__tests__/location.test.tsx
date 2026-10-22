import { beforeEach, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import { useHere } from '../location';
jest.mock('expo-router', () => ({ useIsFocused: () => true }));
jest.mock('expo-localization', () => ({ getLocales: () => [{ regionCode: 'US' }] }));
jest.mock('expo-location', () => ({ requestForegroundPermissionsAsync: jest.fn(), getForegroundPermissionsAsync: jest.fn(), hasServicesEnabledAsync: jest.fn(), getCurrentPositionAsync: jest.fn(), reverseGeocodeAsync: jest.fn(), Accuracy: { Balanced: 3 } }));
beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue({ granted: false, canAskAgain: true } as never);
  jest.mocked(Location.hasServicesEnabledAsync).mockResolvedValue(true);
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

it('waits for the permission decision before starting the position timeout', async () => {
  let allow!: (permission: never) => void;
  jest.mocked(Location.requestForegroundPermissionsAsync).mockImplementation(() => new Promise(resolve => { allow = resolve; }));
  jest.mocked(Location.getCurrentPositionAsync).mockResolvedValue({ coords: { latitude: -37, longitude: 145 } } as never);
  jest.mocked(Location.reverseGeocodeAsync).mockResolvedValue([]);
  jest.useFakeTimers();
  try {
    const { result } = await renderHook(() => useHere());
    await act(async () => { await jest.advanceTimersByTimeAsync(20000); });
    expect(result.current.status).toBe('loading');
    await act(async () => allow({ granted: true } as never));
    expect(result.current.status).toBe('ready');
    expect(result.current.coords).toEqual({ lat: -37, lng: 145 });
  } finally { jest.useRealTimers(); }
});

it('does not request permission again after permanent denial and detects disabled services', async () => {
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue({ granted: false, canAskAgain: false } as never);
  const denied = await renderHook(() => useHere());
  await waitFor(() => expect(denied.result.current.status).toBe('denied'));
  expect(denied.result.current.canAskAgain).toBe(false);
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  await denied.unmount();
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue({ granted: true } as never);
  jest.mocked(Location.hasServicesEnabledAsync).mockResolvedValue(false);
  const disabled = await renderHook(() => useHere());
  await waitFor(() => expect(disabled.result.current.status).toBe('denied'));
  expect(disabled.result.current.servicesEnabled).toBe(false);
  expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
});
