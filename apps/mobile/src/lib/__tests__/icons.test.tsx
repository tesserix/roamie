import { expect, jest, test } from '@jest/globals';
import { render } from '@testing-library/react-native';
import { SymbolView, type SFSymbol, type AndroidSymbol } from 'expo-symbols';
import { Icon } from '../../components/ui';

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}) }));
jest.mock('expo-symbols', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { SymbolView: jest.fn((props: object) => React.createElement(View, props)) };
});

const cases: { name: SFSymbol; android: AndroidSymbol }[] = [
  { name: 'keyboard', android: 'keyboard' },
  { name: 'arrow.left.arrow.right', android: 'swap_horiz' },
  { name: 'bubble.left.and.bubble.right.fill', android: 'forum' },
];
test.each(cases)('the $name icon supplies an Android symbol instead of disappearing', async ({ name, android }) => {
  await render(<Icon name={name} size={24} color="#123456" />);
  expect(jest.mocked(SymbolView).mock.calls.at(-1)![0]).toMatchObject({
    name: { ios: name, android, web: android },
    size: 24, tintColor: '#123456', accessible: false,
  });
});
