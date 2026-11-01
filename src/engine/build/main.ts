// «Главное» и фон своего узора (0.19.0; владелец 01.11.2026: «добавляем рамку „главное“» и «да, добавь
// выбор» фона — по разбору статей о переводе фото в схему 31.10.2026: Pattern Maker отдаёт обведённому
// главному свою долю палитры, WinStitch советует не тратить нити на пёстрый фон).
//
// Главное — овал, вписанный в рамку `main` (доли снимка, как кадр). В нём — своя маленькая палитра и
// бережная чистка, как у лиц на снимках библиотеки (./focus.ts), а упрощение не трогает резких точек:
// зрачок и блик в клетку не смешиваются с кожей ещё до чистки, а рябь кожи и шерсти выравнивается, как
// везде. Фон — всё вне овала: как есть, одной нитью или не вышивать (невышитая канва, как поле листа у
// старинных схем).
import { deltaOK, labToLinear, linearToLab } from '../color';
import type { Rect } from './eyes';
import type { Grid } from './grid';

/** Фон вне главного: `one` — одной нитью, `none` — не вышивать; без поля — как есть. */
export type Background = 'one' | 'none';

/**
 * Клетки сетки `w` × `h` кадра `crop`, чей центр — внутри овала, вписанного в `main` (доли снимка,
 * как у кадра): 1 — главное. Ни одной такой клетки — `undefined`, узор как без главного.
 */
export function ovalMask(crop: Rect, w: number, h: number, main: Rect): Uint8Array | undefined {
  const cx = (main[0] + main[2]) / 2;
  const cy = (main[1] + main[3]) / 2;
  const rx = (main[2] - main[0]) / 2;
  const ry = (main[3] - main[1]) / 2;
  if (!(rx > 0 && ry > 0)) return undefined;
  const mask = new Uint8Array(w * h);
  let any = false;
  for (let y = 0; y < h; y++) {
    const dy = (crop[1] + ((y + 0.5) / h) * (crop[3] - crop[1]) - cy) / ry;
    if (dy * dy > 1) continue;
    for (let x = 0; x < w; x++) {
      const dx = (crop[0] + ((x + 0.5) / w) * (crop[2] - crop[0]) - cx) / rx;
      if (dx * dx + dy * dy <= 1) {
        mask[y * w + x] = 1;
        any = true;
      }
    }
  }
  return any ? mask : undefined;
}

/** Клетки, отмеченные хотя бы одной маской; нет ни одной маски — `undefined`. */
export function unionMask(...masks: (Uint8Array | undefined)[]): Uint8Array | undefined {
  const list = masks.filter((m): m is Uint8Array => !!m);
  if (!list.length) return undefined;
  if (list.length === 1) return list[0];
  const out = new Uint8Array(list[0].length);
  for (const m of list) for (let i = 0; i < out.length; i++) out[i] |= m[i];
  return out;
}

/**
 * Резкая точка: упрощение сдвинуло бы цвет клетки дальше этого (OKLab) — зрачок на коже, блик в глазу,
 * тёмная ноздря. Рябь соседних оттенков кожи и шерсти — ближе, её упрощение выравнивает.
 */
export const SHARP_POINT = 0.12;

/** В главном резкие точки — цветом сетки `raw` (до упрощения), всё остальное — `simple`. */
export function keepInside(simple: Grid, raw: Grid, mask: Uint8Array): Grid {
  const rgb = Float64Array.from(simple.rgb);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const o = i * 3;
    const was = linearToLab(raw.rgb[o], raw.rgb[o + 1], raw.rgb[o + 2]);
    const now = linearToLab(simple.rgb[o], simple.rgb[o + 1], simple.rgb[o + 2]);
    if (deltaOK(was, now) <= SHARP_POINT) continue;
    rgb[o] = raw.rgb[o];
    rgb[o + 1] = raw.rgb[o + 1];
    rgb[o + 2] = raw.rgb[o + 2];
  }
  return { ...simple, rgb };
}

/** Кругов k-средних: две кучки устанавливаются за три-четыре (как у преобладающего цвета клетки, ./dominant.ts). */
const ROUNDS = 6;

/**
 * Преобладающий цвет точек OKLab: две кучки k-средних (начало — самая тёмная и самая светлая точка),
 * середина большей; поровну — тёмной. Как цвет клетки в ./dominant.ts, только для всего фона.
 */
function dominantLab(labs: [number, number, number][]): [number, number, number] {
  let dark = 0;
  let light = 0;
  labs.forEach((p, k) => {
    if (p[0] < labs[dark][0]) dark = k;
    if (p[0] > labs[light][0]) light = k;
  });
  let a: [number, number, number] = [...labs[dark]];
  let b: [number, number, number] = [...labs[light]];
  let na = 0;
  let nb = 0;
  for (let round = 0; round < ROUNDS; round++) {
    const sa = [0, 0, 0];
    const sb = [0, 0, 0];
    na = 0;
    nb = 0;
    for (const p of labs) {
      const da = (p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2 + (p[2] - a[2]) ** 2;
      const db = (p[0] - b[0]) ** 2 + (p[1] - b[1]) ** 2 + (p[2] - b[2]) ** 2;
      const s = da <= db ? sa : sb;
      s[0] += p[0];
      s[1] += p[1];
      s[2] += p[2];
      if (da <= db) na++;
      else nb++;
    }
    if (na) a = [sa[0] / na, sa[1] / na, sa[2] / na];
    if (nb) b = [sb[0] / nb, sb[1] / nb, sb[2] / nb];
  }
  return na >= nb ? a : b;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Фон вне главного `mask`: `none` — клетки фона не вышиваются (`paper`, как поле листа у схем), `one` —
 * все одним цветом, преобладающим на фоне: пёстрый фон не тратит нитей и не сыплет одиночками.
 */
export function withBackground(g: Grid, mask: Uint8Array, bg: Background): Grid {
  if (bg === 'none') {
    const paper = new Uint8Array(g.w * g.h);
    for (let i = 0; i < paper.length; i++) paper[i] = mask[i] ? (g.paper?.[i] ?? 0) : 1;
    return { ...g, paper };
  }
  const labs: [number, number, number][] = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] && !g.paper?.[i]) labs.push(linearToLab(g.rgb[i * 3], g.rgb[i * 3 + 1], g.rgb[i * 3 + 2]));
  }
  if (!labs.length) return g;
  const [r, gg, b] = labToLinear(dominantLab(labs));
  const rgb = Float64Array.from(g.rgb);
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] || g.paper?.[i]) continue;
    rgb[i * 3] = clamp01(r);
    rgb[i * 3 + 1] = clamp01(gg);
    rgb[i * 3 + 2] = clamp01(b);
  }
  return { ...g, rgb };
}
