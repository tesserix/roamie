import { describe, expect, it } from '@jest/globals';

import { crossed, toHome, toMinor } from '../money';

describe('toMinor', () => {
  it.each([
    ['12.50', 'USD', 1250],
    ['1,200', 'JPY', 1200],
    ['3.5', 'KWD', 3500],
    ['0', 'EUR', 0],
    ['abc', 'USD', null],
    ['', 'USD', null],
    ['-5', 'USD', null],
  ])('%s %s -> %s', (input, currency, want) => {
    expect(toMinor(input, currency)).toBe(want);
  });
});

describe('toHome', () => {
  const rates = { THB: 36.5, JPY: 150, USD: 1 };

  it('keeps home-currency amounts unchanged', () => {
    expect(toHome(1234, 'USD', 'USD', rates)).toBe(1234);
  });

  it('converts THB into USD cents', () => {
    expect(toHome(36500, 'THB', 'USD', rates)).toBe(1000);
  });

  it('converts a zero-decimal currency', () => {
    expect(toHome(1500, 'JPY', 'USD', rates)).toBe(1000);
  });

  it('returns null for an unknown currency', () => {
    expect(toHome(100, 'XYZ', 'USD', rates)).toBeNull();
  });
});

describe('crossed', () => {
  it.each([
    [0, 4000, 10000, null],
    [4000, 5000, 10000, 50],
    [4000, 8500, 10000, 80],
    [7000, 12000, 10000, 100],
    [10000, 12000, 10000, null],
    [0, 500, 0, null],
  ])('%d -> %d of %d crosses %s', (before, after, budget, want) => {
    expect(crossed(before, after, budget)).toBe(want);
  });
});
