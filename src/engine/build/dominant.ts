// Сетка снимка по преобладающему цвету и насыщенность (docs/specs/2026-09-content-pipeline.md, шаг 4;
// разбор «Райских яблочек» 14.10.2026). Среднее по площади клетки (toGrid) смешивает всё, что в неё
// попало: лист, небо и ветка дают мутную оливу, край яблока — бурую кайму. Здесь цвет клетки — того,
// чего в ней больше, а насыщенность можно поднять до палитры: у снимка нитей мало, и каждая на счету.
import { labToLinear, linear, linearToLabInto } from '../color';
import type { Grid, Raster } from './grid';

/** Точек клетки по каждой стороне — не больше стольких (через равный шаг): дальше цвет не меняется, растёт время. */
const SAMPLE = 12;
/** Кругов k-средних: две кучки устанавливаются за три-четыре. */
const ROUNDS = 6;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Кадр `crop` → сетка, как toGrid (те же клетки и размеры), но цвет клетки — преобладающий: точки
 * клетки делятся на две кучки k-средними в OKLab (начало — самая тёмная и самая светлая точка), цвет
 * клетки — середина большей кучки; поровну — тёмной. Однородная клетка выходит своим цветом, клетка
 * на границе — цветом той стороны, которой в ней больше, без смеси.
 */
export function toGridDominant(r: Raster, crop: [number, number, number, number], size: number): Grid {
  const [l, t, rr, b] = crop;
  const x0 = l * r.width;
  const y0 = t * r.height;
  const cw = (rr - l) * r.width;
  const ch = (b - t) * r.height;
  if (cw <= 0 || ch <= 0) throw new Error(`пустой кадр ${crop.join(', ')}`);
  const w = cw >= ch ? size : Math.max(1, Math.round((size * cw) / ch));
  const h = cw >= ch ? Math.max(1, Math.round((size * ch) / cw)) : size;
  const xs = Array.from({ length: w + 1 }, (_, x) => Math.min(r.width, Math.floor(x0 + (x * cw) / w)));
  const ys = Array.from({ length: h + 1 }, (_, y) => Math.min(r.height, Math.floor(y0 + (y * ch) / h)));
  let most = 1;
  for (let x = 0; x < w; x++) most = Math.max(most, xs[x + 1] - xs[x]);
  for (let y = 0; y < h; y++) most = Math.max(most, ys[y + 1] - ys[y]);
  const side = Math.min(most, 2 * SAMPLE);
  const lab = new Float64Array(side * side * 3);
  const rgb = new Float64Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const ya = Math.min(ys[y], r.height - 1);
    const yb = Math.max(ya + 1, ys[y + 1]);
    const sy = Math.max(1, Math.floor((yb - ya) / SAMPLE));
    for (let x = 0; x < w; x++) {
      const xa = Math.min(xs[x], r.width - 1);
      const xb = Math.max(xa + 1, xs[x + 1]);
      const sx = Math.max(1, Math.floor((xb - xa) / SAMPLE));
      let n = 0;
      for (let yy = ya; yy < yb; yy += sy) {
        for (let xx = xa; xx < xb; xx += sx) {
          const o = (yy * r.width + xx) * 3;
          linearToLabInto(linear(r.data[o]), linear(r.data[o + 1]), linear(r.data[o + 2]), lab, n * 3);
          n++;
        }
      }
      // начало: самая тёмная и самая светлая точки
      let dark = 0;
      let light = 0;
      for (let k = 1; k < n; k++) {
        if (lab[k * 3] < lab[dark * 3]) dark = k;
        if (lab[k * 3] > lab[light * 3]) light = k;
      }
      let a0 = lab[dark * 3], a1 = lab[dark * 3 + 1], a2 = lab[dark * 3 + 2];
      let b0 = lab[light * 3], b1 = lab[light * 3 + 1], b2 = lab[light * 3 + 2];
      let na = 0;
      let nb = 0;
      for (let round = 0; round < ROUNDS; round++) {
        let s0 = 0, s1 = 0, s2 = 0, q0 = 0, q1 = 0, q2 = 0;
        na = 0;
        nb = 0;
        for (let k = 0; k < n; k++) {
          const p0 = lab[k * 3], p1 = lab[k * 3 + 1], p2 = lab[k * 3 + 2];
          const da = (p0 - a0) ** 2 + (p1 - a1) ** 2 + (p2 - a2) ** 2;
          const db = (p0 - b0) ** 2 + (p1 - b1) ** 2 + (p2 - b2) ** 2;
          if (da <= db) {
            s0 += p0; s1 += p1; s2 += p2; na++;
          } else {
            q0 += p0; q1 += p1; q2 += p2; nb++;
          }
        }
        if (na) { a0 = s0 / na; a1 = s1 / na; a2 = s2 / na; }
        if (nb) { b0 = q0 / nb; b1 = q1 / nb; b2 = q2 / nb; }
      }
      const out = na >= nb ? labToLinear([a0, a1, a2]) : labToLinear([b0, b1, b2]);
      const o = (y * w + x) * 3;
      rgb[o] = clamp01(out[0]);
      rgb[o + 1] = clamp01(out[1]);
      rgb[o + 2] = clamp01(out[2]);
    }
  }
  return { w, h, rgb };
}

/** Насыщенность сетки: хрома в OKLab ×k при той же светлоте и оттенке; что вышло за sRGB — обрезается по каналам. */
export function saturate(g: Grid, k: number): Grid {
  const rgb = new Float64Array(g.rgb.length);
  const lab = new Float64Array(3);
  for (let i = 0; i < g.w * g.h; i++) {
    linearToLabInto(g.rgb[i * 3], g.rgb[i * 3 + 1], g.rgb[i * 3 + 2], lab, 0);
    const out = labToLinear([lab[0], lab[1] * k, lab[2] * k]);
    rgb[i * 3] = clamp01(out[0]);
    rgb[i * 3 + 1] = clamp01(out[1]);
    rgb[i * 3 + 2] = clamp01(out[2]);
  }
  return g.paper ? { ...g, rgb } : { w: g.w, h: g.h, rgb };
}
