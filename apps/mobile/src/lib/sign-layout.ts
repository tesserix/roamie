import type { SignLine } from './api';

export type Label = { left: number; top: number; width: number; height: number; fontSize: number };
type Rect = Omit<Label, 'fontSize'>;

const GAP = 2;
const PAD = 8;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const sameRow = (a: Rect, b: Rect) => Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top) > Math.min(a.height, b.height) / 2;
const overlaps = (a: Rect, b: Rect) =>
  a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

/** One single-line label per line of text: sized from the text height, wide enough for its words, never on top of another. */
export function placeLabels(lines: Pick<SignLine, 'translation' | 'box'>[], w: number, h: number): Label[] {
  const boxes = lines.map(({ box }) => ({ left: box.x * w, top: box.y * h, width: box.w * w, height: box.h * h }));
  const labels = lines.map(({ translation }, i) => {
    const b = boxes[i];
    const fontSize = clamp(b.height * 0.7, 10, 22);
    // Grow sideways only into the space between neighbouring text on the same row.
    const row = boxes.filter((o) => o !== b && sameRow(b, o));
    const lo = Math.max(0, ...row.filter((o) => o.left + o.width <= b.left + 1).map((o) => o.left + o.width + GAP));
    const hi = Math.min(w, ...row.filter((o) => o.left >= b.left + b.width - 1).map((o) => o.left - GAP));
    const width = clamp(translation.length * fontSize * 0.55 + PAD, b.width, Math.max(b.width, hi - lo));
    return { left: clamp(b.left, lo, hi - width), top: b.top, width, height: Math.max(b.height, fontSize * 1.3), fontSize };
  });
  const placed: Label[] = [];
  for (const l of [...labels].sort((a, b) => a.top - b.top)) {
    for (let hit = placed.find((p) => overlaps(l, p)); hit; hit = placed.find((p) => overlaps(l, p))) l.top = hit.top + hit.height + GAP;
    placed.push(l);
  }
  return labels;
}
