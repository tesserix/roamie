import { describe, expect, it } from '@jest/globals';

import { type Label, placeLabels } from '../sign-layout';

const line = (translation: string, x: number, y: number, w: number, h: number) => ({ translation, box: { x, y, w, h } });
const overlaps = (a: Label, b: Label) =>
  a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

describe('placeLabels', () => {
  it('widens a narrow label so whole words fit on one line', () => {
    const [label] = placeLabels([line('Chicken pho', 0.1, 0.1, 0.1, 0.06)], 300, 300);
    expect(label.width).toBeGreaterThanOrEqual('Chicken pho'.length * label.fontSize * 0.5);
    expect(label.left + label.width).toBeLessThanOrEqual(300);
  });

  it('stops short of the next text on the same row', () => {
    const [dish, price] = placeLabels([line('Grilled pork with rice noodles', 0.05, 0.2, 0.15, 0.06), line('40,000', 0.6, 0.2, 0.2, 0.06)], 300, 300);
    expect(dish.left + dish.width).toBeLessThanOrEqual(price.left);
  });

  it('grows leftwards at the right edge of the photo', () => {
    const [label] = placeLabels([line('Entrance hall', 0.85, 0.5, 0.1, 0.05)], 300, 300);
    expect(label.left).toBeGreaterThanOrEqual(0);
    expect(label.left + label.width).toBeLessThanOrEqual(300);
    expect(label.width).toBeGreaterThan(30);
  });

  it('never stacks one label on another', () => {
    const labels = placeLabels([line('HANOI STATION', 0.1, 0.1, 0.8, 0.1), line('120 Le Duan', 0.2, 0.15, 0.6, 0.06), line('Exit', 0.3, 0.17, 0.2, 0.05)], 300, 300);
    expect(overlaps(labels[0], labels[1])).toBe(false);
    expect(overlaps(labels[0], labels[2])).toBe(false);
    expect(overlaps(labels[1], labels[2])).toBe(false);
  });

  it('sizes text from the height of the original, within readable limits', () => {
    const [tiny, mid, huge] = placeLabels([line('a', 0, 0, 0.1, 0.01), line('b', 0, 0.2, 0.1, 0.06), line('c', 0, 0.5, 0.1, 0.4)], 300, 300);
    expect(tiny.fontSize).toBe(10);
    expect(mid.fontSize).toBeCloseTo(12.6);
    expect(huge.fontSize).toBe(22);
    expect(mid.height).toBeGreaterThanOrEqual(18);
  });
});
