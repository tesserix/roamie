import { jest } from '@jest/globals';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(),
  setAudioModeAsync: jest.fn(async () => {}),
}));

jest.mock('expo-network', () => ({
  ...jest.requireActual<object>('expo-network'),
  getNetworkStateAsync: jest.fn(async () => ({ type: 'WIFI', isConnected: true, isInternetReachable: true })),
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
}));
