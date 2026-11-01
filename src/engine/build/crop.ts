// Рамка кадра своего узора (docs/specs/2026-09-custom.md, «Кадр»): доли снимка [лево, верх, право, низ].
// Сдвиг, угол, «ближе и дальше» колёсиком у курсора и щипком двумя пальцами, овал главного — здесь, без
// интерфейса; экран кадра — src/ui/FrameEditor.tsx.
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

/** Что двигает касание: рамку кадра или овал главного (`index` — какой из овалов), целиком или за уголок. */
export interface FrameGrip {
  target: 'crop' | 'main';
  mode: 'move' | 'resize';
  index?: number;
}

/** Уголок овала — на его краю справа внизу, под 45°: cos 45°. */
export const MAIN_HANDLE = Math.SQRT1_2;

/** Уголок овала главного (доли снимка): на краю овала справа внизу, под 45°. */
export function mainHandle([l, t, r, b]: Crop): [number, number] {
  return [(l + r) / 2 + ((r - l) / 2) * MAIN_HANDLE, (t + b) / 2 + ((b - t) / 2) * MAIN_HANDLE];
}

/** Точка (x, y) в долях снимка — внутри овала, вписанного в рамку `main`. */
export function insideOval(x: number, y: number, [l, t, r, b]: Crop): boolean {
  const rx = (r - l) / 2;
  const ry = (b - t) / 2;
  if (!(rx > 0 && ry > 0)) return false;
  return ((x - (l + r) / 2) / rx) ** 2 + ((y - (t + b) / 2) / ry) ** 2 <= 1;
}

/**
 * Что берёт палец, коснувшийся точки (px, py) на снимке dw × dh (точки экрана): уголок овала главного,
 * уголок рамки (справа внизу), овал, иначе — рамку. Уголок ловит палец в `grab` точках вокруг: сам он
 * маленький, а палец — нет (на 0.18.x угол рамки на телефоне так и не давался — владелец 01.11.2026).
 * Овалов может быть несколько (с 0.24.0, «Найти лица»): берётся ближайший уголок, а внутри — меньший овал
 * (он лежит поверх).
 */
export function gripAt(px: number, py: number, crop: Crop, mains: readonly Crop[], dw: number, dh: number, grab: number): FrameGrip {
  let near = -1, best = grab;
  mains.forEach((m, i) => {
    const [hx, hy] = mainHandle(m);
    const d = Math.hypot(px - hx * dw, py - hy * dh);
    if (d > best) return;
    // маленький овал лица весь в пределах `grab` от уголка: внутри и ближе к середине — сдвиг, а не уголок
    const dc = Math.hypot(px - ((m[0] + m[2]) / 2) * dw, py - ((m[1] + m[3]) / 2) * dh);
    if (insideOval(px / dw, py / dh, m) && dc < d) return;
    [near, best] = [i, d];
  });
  if (near >= 0) return { target: 'main', mode: 'resize', index: near };
  if (Math.hypot(px - crop[2] * dw, py - crop[3] * dh) <= grab) return { target: 'crop', mode: 'resize' };
  const inside = ovalAt(px / dw, py / dh, mains);
  if (inside >= 0) return { target: 'main', mode: 'move', index: inside };
  return { target: 'crop', mode: 'move' };
}

/** Какой овал под точкой (доли снимка): меньший из накрывших, нет — −1. */
export function ovalAt(x: number, y: number, mains: readonly Crop[]): number {
  let at = -1, area = Infinity;
  mains.forEach((m, i) => {
    const a = (m[2] - m[0]) * (m[3] - m[1]);
    if (insideOval(x, y, m) && a < area) [at, area] = [i, a];
  });
  return at;
}

/**
 * Рамка после того, как палец сдвинулся на (dx, dy) доли снимка от начала касания: `move` — сдвиг, не
 * за снимок; `resize` — угол справа внизу: не уже CROP_MIN и не длиннее CROP_ASPECT : 1 в точках
 * снимка `width` × `height`.
 */
export function dragFrame(start: Crop, mode: FrameGrip['mode'], dx: number, dy: number, width: number, height: number): Crop {
  if (mode === 'move') return shiftCrop(start, dx, dy);
  const [l, t, r, b] = start;
  let nr = clamp(r + dx, l + CROP_MIN, 1);
  let nb = clamp(b + dy, t + CROP_MIN, 1);
  const wpx = (nr - l) * width;
  const hpx = (nb - t) * height;
  if (wpx > CROP_ASPECT * hpx) nr = l + (CROP_ASPECT * hpx) / width;
  if (hpx > CROP_ASPECT * wpx) nb = t + (CROP_ASPECT * wpx) / height;
  return [l, t, nr, nb];
}

/**
 * Овал главного больше в `k` раз (меньше — при k < 1) вокруг своей середины: пальцы развели — овал
 * больше, как предмет под пальцами. Не уже CROP_MIN и не за снимок.
 */
export function scaleRect(rect: Crop, k: number): Crop {
  if (!(k > 0)) return rect;
  const [l, t, r, b] = rect;
  return zoomCrop(rect, (l + r) / 2, (t + b) / 2, k);
}
