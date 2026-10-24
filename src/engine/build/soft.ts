// Мягкое небо (отбор 0.15.9, 24.10.2026: «градиент не нравится» — ровное небо снимка выходило
// стопкой прямых полос соседних нитей). На большом ровном месте — небе, спокойной воде — клетка
// между двумя соседними оттенками берёт светлый или тёмный по крупному шуму (palette.ts,
// nearestSoft): граница полос идёт волной, как облака, а не по линейке. Пятна шума — в несколько
// клеток, вытянуты по горизонтали: мельче чистки они не выходят, одиночных крестиков не
// прибавляется. На деталях — стенах, листве, лицах — шума нет. Свой детерминированный приём, не
// генератор изображений (ADR 0006).
import { linearToLabInto } from '../color';
import { hash32, rng } from '../seed';
import type { Grid } from './grid';

/**
 * Сдвиг клетки — до ±SOFT_AMP пути между двумя ближними нитями: при 0,5 переход идёт через всю
 * полосу (листы сравнения 24.10.2026: при 0,25 полосы остаются полосами).
 */
export const SOFT_AMP = 0.5;
/** Узлы шума — через столько клеток по вертикали и в SOFT_STRETCH раз реже по горизонтали. */
export const SOFT_CELL = 6;
export const SOFT_STRETCH = 2;
/** Ровное место: средняя разница соседних клеток в окне 9 × 9 до LO — шум полностью, до HI — частично. */
export const SOFT_LO = 0.006;
export const SOFT_HI = 0.012;
/** Ровное место меньше такой доли клеток (стена, крыша) — не трогаем: только небо и вода. */
export const SOFT_MIN_AREA = 0.01;

const smoothstep = (t: number) => t * t * (3 - 2 * t);

/** Насколько клетка — ровное место: 1 — небо, вода; 0 — деталь или мелкое ровное пятно. */
export function softMask(g: Grid): Float32Array {
  const { w, h } = g;
  const n = w * h;
  const lab = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) linearToLabInto(g.rgb[i * 3], g.rgb[i * 3 + 1], g.rgb[i * 3 + 2], lab, i * 3);
  const dE = (i: number, j: number) => Math.hypot(lab[i * 3] - lab[j * 3], lab[i * 3 + 1] - lab[j * 3 + 1], lab[i * 3 + 2] - lab[j * 3 + 2]);
  // разница с соседями справа и снизу, затем среднее в окне 9 × 9 — по суммам
  const d = new Float64Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    let s = 0, k = 0;
    if (x + 1 < w) { s += dE(i, i + 1); k++; }
    if (y + 1 < h) { s += dE(i, i + w); k++; }
    d[i] = k ? s / k : 0;
  }
  const S = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) S[(y + 1) * (w + 1) + x + 1] = d[y * w + x] + S[y * (w + 1) + x + 1] + S[(y + 1) * (w + 1) + x] - S[y * (w + 1) + x];
  const R = 4;
  const mask = new Float32Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.max(0, x - R), x1 = Math.min(w, x + R + 1), y0 = Math.max(0, y - R), y1 = Math.min(h, y + R + 1);
    const t = (S[y1 * (w + 1) + x1] - S[y0 * (w + 1) + x1] - S[y1 * (w + 1) + x0] + S[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0));
    mask[y * w + x] = t <= SOFT_LO ? 1 : t >= SOFT_HI ? 0 : (SOFT_HI - t) / (SOFT_HI - SOFT_LO);
  }
  // мелкие ровные места — мимо
  const seen = new Uint8Array(n);
  const stack: number[] = [];
  for (let i = 0; i < n; i++) {
    if (seen[i] || mask[i] < 0.5) continue;
    const comp: number[] = [];
    seen[i] = 1;
    stack.push(i);
    while (stack.length) {
      const j = stack.pop()!;
      comp.push(j);
      const x = j % w, y = (j - x) / w;
      for (const k of [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, y > 0 ? j - w : -1, y < h - 1 ? j + w : -1]) if (k >= 0 && !seen[k] && mask[k] >= 0.5) { seen[k] = 1; stack.push(k); }
    }
    if (comp.length < SOFT_MIN_AREA * n) for (const j of comp) mask[j] = 0;
  }
  return mask;
}

/**
 * Сдвиг клетки к светлому оттенку (+) или тёмному (−) в долях пути между двумя ближними нитями:
 * до ±SOFT_AMP на ровном месте, 0 — на деталях. Шум — из зерна `id`: одна карточка — один узор.
 */
export function softField(g: Grid, id: string): Float32Array {
  const { w, h } = g;
  const n = w * h;
  const mask = softMask(g);
  // шум: решётка узлов, между ними — гладко; две октавы, затем — равномерно по рангу
  const r = rng(hash32(`${id}#soft`));
  const octave = (c: number) => {
    const cx = c * SOFT_STRETCH;
    const gw = Math.ceil(w / cx) + 2, gh = Math.ceil(h / c) + 2;
    const node = Float64Array.from({ length: gw * gh }, () => r());
    const out = new Float64Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const fx = x / cx, fy = y / c;
      const ix = Math.floor(fx), iy = Math.floor(fy);
      const tx = smoothstep(fx - ix), ty = smoothstep(fy - iy);
      const a = node[iy * gw + ix], b = node[iy * gw + ix + 1], cc = node[(iy + 1) * gw + ix], dd = node[(iy + 1) * gw + ix + 1];
      out[y * w + x] = (a + (b - a) * tx) * (1 - ty) + (cc + (dd - cc) * tx) * ty;
    }
    return out;
  };
  const o1 = octave(SOFT_CELL), o2 = octave(SOFT_CELL / 2);
  const v = Float64Array.from({ length: n }, (_, i) => o1[i] + 0.4 * o2[i]);
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => v[a] - v[b] || a - b);
  const out = new Float32Array(n);
  order.forEach((i, rank) => (out[i] = mask[i] * SOFT_AMP * ((2 * (rank + 0.5)) / n - 1)));
  return out;
}
