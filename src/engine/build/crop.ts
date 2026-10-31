// Рамка кадра своего узора (docs/specs/2026-09-custom.md, «Кадр»): доли снимка [лево, верх, право, низ].
// Сдвиг, «ближе и дальше» колёсиком у курсора и щипком двумя пальцами — здесь, без интерфейса; рамка —
// src/ui/CropBox.tsx.
import type { Crop } from './mine';

/** Самая узкая рамка — такая доля снимка по стороне. */
export const CROP_MIN = 0.04;
/** Рамка не длиннее стольких своих ширин: у малого узора (40 клеток) короткая сторона — от 8. */
export const CROP_ASPECT = 5;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Сдвигает рамку, не выпуская за снимок. */
export function shiftCrop([l, t, r, b]: Crop, dx: number, dy: number): Crop {
  const w = r - l;
  const h = b - t;
  const nl = clamp(l + dx, 0, 1 - w);
  const nt = clamp(t + dy, 0, 1 - h);
  return [nl, nt, nl + w, nt + h];
}

/** Рамка ближе или дальше в `f` раз; точка (ax, ay) снимка остаётся на месте. */
export function zoomCrop([l, t, r, b]: Crop, ax: number, ay: number, f: number): Crop {
  const w = clamp((r - l) * f, CROP_MIN, 1);
  const h = clamp((b - t) * f, CROP_MIN, 1);
  const nl = ax - (ax - l) * (w / (r - l));
  const nt = ay - (ay - t) * (h / (b - t));
  return shiftCrop([nl, nt, nl + w, nt + h], 0, 0);
}

/**
 * Щипок: пальцы были на расстоянии `from`, стали на `to`. Развели — рамка меньше (узор ближе), свели —
 * больше; середина рамки на месте, пока рамка не упрётся в край снимка. Как щипок на канве.
 */
export function pinchCrop(crop: Crop, from: number, to: number): Crop {
  if (!(from > 0) || !(to > 0)) return crop;
  const [l, t, r, b] = crop;
  return zoomCrop(crop, (l + r) / 2, (t + b) / 2, from / to);
}
