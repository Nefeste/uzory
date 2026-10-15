// Сетка снимка по преобладающему цвету и насыщенность (src/engine/build/dominant.ts; разбор
// «Райских яблочек», 14.10.2026): клетка берёт цвет того, чего в ней больше, а не смесь.
import { describe, expect, test } from 'bun:test';
import { labToLch, linear, linearToLab } from '../../src/engine/color';
import { saturate, toGridDominant } from '../../src/engine/build/dominant';
import { type Raster, toGrid } from '../../src/engine/build/grid';
import { rng } from '../../src/engine/seed';

/** Снимок w × h, точка — по функции цвета 0xRRGGBB. */
function raster(w: number, h: number, at: (x: number, y: number) => number): Raster {
  const data = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = at(x, y);
    data.set([(c >> 16) & 255, (c >> 8) & 255, c & 255], (y * w + x) * 3);
  }
  return { width: w, height: h, data };
}
const lin = (c: number) => [linear((c >> 16) & 255), linear((c >> 8) & 255), linear(c & 255)];
const cell = (g: { rgb: Float64Array }, i: number) => [g.rgb[i * 3], g.rgb[i * 3 + 1], g.rgb[i * 3 + 2]];
// круг «линейный свет → OKLab → линейный свет» точен до 2,3·10⁻⁷ — сравнение с запасом
const near = (a: number[], b: number[], eps = 1e-6) => a.every((v, k) => Math.abs(v - b[k]) <= eps);

const RED = 0xc8102e;
const BLUE = 0x2050c0;

describe('сетка по преобладающему цвету', () => {
  test('клетка, где красного 70 %, а синего 30 %, — красная, а не лиловая смесь', () => {
    // клетка 10 × 10: первые 7 столбцов красные, 3 — синие
    const r = raster(20, 10, (x) => (x % 10 < 7 ? RED : BLUE));
    const dom = toGridDominant(r, [0, 0, 1, 1], 2);
    const mean = toGrid(r, [0, 0, 1, 1], 2);
    expect([dom.w, dom.h]).toEqual([2, 1]);
    expect(near(cell(dom, 0), lin(RED), 1e-6)).toBe(true);
    expect(near(cell(mean, 0), lin(RED), 0.05)).toBe(false);
  });

  test('ровная клетка — ровно свой цвет; поровну — тёмная половина', () => {
    const flat = toGridDominant(raster(8, 8, () => RED), [0, 0, 1, 1], 1);
    expect(near(cell(flat, 0), lin(RED), 1e-6)).toBe(true);
    const half = toGridDominant(raster(8, 8, (x) => (x < 4 ? 0xeeeeee : 0x202020)), [0, 0, 1, 1], 1);
    expect(near(cell(half, 0), lin(0x202020), 1e-6)).toBe(true);
  });

  test('клетки и размеры — как у toGrid; две сборки подряд — одинаковы', () => {
    const r1 = rng(7);
    const r = raster(97, 61, () => Math.floor(r1() * 0xffffff));
    for (const [crop, size] of [[[0, 0, 1, 1], 40], [[0.1, 0.2, 0.9, 0.7], 33], [[0.3, 0, 0.6, 1], 25]] as const) {
      const a = toGridDominant(r, [...crop] as [number, number, number, number], size);
      const b = toGrid(r, [...crop] as [number, number, number, number], size);
      expect([a.w, a.h]).toEqual([b.w, b.h]);
      expect(a.rgb).toEqual(toGridDominant(r, [...crop] as [number, number, number, number], size).rgb);
    }
  });
});

describe('насыщенность', () => {
  const g = { w: 3, h: 1, rgb: Float64Array.from([...lin(0x6f8f3a), ...lin(0x7aa6d9), ...lin(0x808080)]) };
  const lch = (v: number[]) => labToLch(linearToLab(v[0], v[1], v[2]));

  test('×1,15: хрома — в 1,15 раза, светлота и оттенок те же; серое остаётся серым', () => {
    const s = saturate(g, 1.15);
    for (const i of [0, 1]) {
      const [L0, C0, h0] = lch(cell(g, i));
      const [L1, C1, h1] = lch(cell(s, i));
      expect(Math.abs(L1 - L0)).toBeLessThan(1e-6);
      expect(Math.abs(C1 / C0 - 1.15)).toBeLessThan(1e-6);
      expect(Math.abs(h1 - h0)).toBeLessThan(1e-4);
    }
    expect(lch(cell(s, 2))[1]).toBeLessThan(1e-6);
  });

  test('×1 — та же сетка; вышедшее за sRGB обрезается по каналам', () => {
    expect(near([...saturate(g, 1).rgb], [...g.rgb], 1e-6)).toBe(true);
    const bright = { w: 1, h: 1, rgb: Float64Array.from(lin(0xff2000)) };
    for (const v of saturate(bright, 1.5).rgb) expect(v >= 0 && v <= 1).toBe(true);
  });
});
