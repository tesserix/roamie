import { beforeEach, expect, jest, test } from '@jest/globals';
import { render } from '@testing-library/react-native';
import AppTabs from '../../components/app-tabs';

const mockReplace = jest.fn();
let mockNavigation: { key: string } | undefined;
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useRootNavigationState: () => mockNavigation,
}));
jest.mock('expo-router/unstable-native-tabs', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const Trigger = Object.assign(View, { Label: () => null, Icon: () => null });
  return { NativeTabs: Object.assign((props: object) => <View {...props} />, { Trigger }) };
});
jest.mock('../../constants/theme', () => ({ useColors: () => ({ accent: '#0066aa' }) }));

beforeEach(() => { mockReplace.mockClear(); mockNavigation = { key: 'signed-in-tabs' }; });

test('a newly authenticated or restored session lands on Translate once', async () => {
  const view = await render(<AppTabs />);
  expect(mockReplace).toHaveBeenCalledWith('/');
  expect(mockReplace).toHaveBeenCalledTimes(1);
  mockNavigation = { key: 'traveller-selected-budget' };
  await view.rerender(<AppTabs />);
  expect(mockReplace).toHaveBeenCalledTimes(1);
});

test('waits for the navigator before opening Translate', async () => {
  mockNavigation = undefined;
  const view = await render(<AppTabs />);
  expect(mockReplace).not.toHaveBeenCalled();
  mockNavigation = { key: 'ready' };
  await view.rerender(<AppTabs />);
  expect(mockReplace).toHaveBeenCalledWith('/');
});

test('a later sign-in opens Translate again', async () => {
  const first = await render(<AppTabs />);
  await first.unmount();
  await render(<AppTabs />);
  expect(mockReplace).toHaveBeenNthCalledWith(2, '/');
});
