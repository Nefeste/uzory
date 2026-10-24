// Сглаживание с сохранением деталей (src/engine/build/smooth.ts): без него сборка та же до байта;
// сдвиг среднего выравнивает фактуру внутри пятна и не двигает границу; охрана в чистке оставляет
// контрастную деталь, которую чистка без охраны стирает.
import { describe, expect, test } from 'bun:test';
import { linear } from '../../src/engine/color';
import { type Grid, type Raster, toGrid } from '../../src/engine/build/grid';
import { buildPattern } from '../../src/engine/build/palette';
import { buildGuarded, GUARD_GROW, GUARD_START, SMOOTH_CLEAN, smoothRaster } from '../../src/engine/build/smooth';
import { CANVAS } from '../../src/engine/pattern';
import { hash32 } from '../../src/engine/seed';

/** Снимок w × h, точка — по функции цвета 0xRRGGBB. */
function raster(w: number, h: number, at: (x: number, y: number) => number): Raster {
  const data = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = at(x, y);
    data.set([(c >> 16) & 255, (c >> 8) & 255, c & 255], (y * w + x) * 3);
  }
  return { width: w, height: h, data };
}

/** Цвет с шумом ±amp по каналам — один и тот же на любой машине. */
function noisy(c: number, x: number, y: number, amp: number): number {
  const ch = (v: number, k: number) => Math.min(255, Math.max(0, v + Math.round(((hash32(`${x},${y},${k}`) % 1000) / 1000 - 0.5) * 2 * amp)));
  return (ch((c >> 16) & 255, 0) << 16) | (ch((c >> 8) & 255, 1) << 8) | ch(c & 255, 2);
}

const RED = 0xb03028;
const GREEN = 0x307038;
/** Среднее расстояние точек до цвета своей стороны (левая половина — красная) в линейном свете. */
function spread(r: Raster): number {
  let sum = 0;
  for (let y = 0; y < r.height; y++) for (let x = 0; x < r.width; x++) {
    const c = x < r.width / 2 ? RED : GREEN;
    const o = (y * r.width + x) * 3;
    sum += Math.hypot(linear(r.data[o]) - linear((c >> 16) & 255), linear(r.data[o + 1]) - linear((c >> 8) & 255), linear(r.data[o + 2]) - linear(c & 255));
  }
  return sum / (r.width * r.height);
}

describe('сглаживание', () => {
  test('0 и 1 — снимок и кадр как есть: узоры без поля smooth не меняются', () => {
    const r = raster(40, 30, (x, y) => noisy(RED, x, y, 30));
    for (const level of [0, 1] as const) {
      const s = smoothRaster(r, [0.1, 0.1, 0.9, 0.9], 20, level);
      expect(s.raster).toBe(r);
      expect(s.crop).toEqual([0.1, 0.1, 0.9, 0.9]);
    }
  });

  test('2 — клеток столько же, по K × K точек; фактура внутри пятна уходит, граница остаётся', () => {
    const r = raster(120, 60, (x, y) => noisy(x < 60 ? RED : GREEN, x, y, 25));
    const s = smoothRaster(r, [0, 0, 1, 1], 20, 2);
    const g = toGrid(r, [0, 0, 1, 1], 20);
    const K = s.raster.width / g.w;
    expect(Number.isInteger(K)).toBe(true);
    expect([s.raster.width, s.raster.height, ...s.crop]).toEqual([g.w * K, g.h * K, 0, 0, 1, 1]);
    const g2 = toGrid(s.raster, s.crop, 20);
    expect([g2.w, g2.h]).toEqual([g.w, g.h]);
    // клетки по свою сторону границы — своего цвета, а разброс внутри пятна — вдвое меньше
    for (let i = 0; i < g2.w * g2.h; i++) {
      const left = i % g2.w < g2.w / 2;
      expect(g2.rgb[i * 3] > g2.rgb[i * 3 + 1]).toBe(left);
    }
    expect(spread(s.raster)).toBeLessThan(spread(r) * 0.5);
    // и ровно так же во второй раз
    expect(Buffer.from(smoothRaster(r, [0, 0, 1, 1], 20, 2).raster.data).equals(Buffer.from(s.raster.data))).toBe(true);
  });
});

describe('охрана деталей в чистке', () => {
  /** Светлое поле с рябью двух близких оттенков и десять тёмных «окон» в одну клетку. */
  function field(): Grid {
    const w = 40, h = 30;
    const windows = new Set(Array.from({ length: 10 }, (_, k) => (6 + 10 * Math.floor(k / 5)) * w + 5 + 7 * (k % 5)));
    const rgb = new Float64Array(w * h * 3);
    for (let i = 0; i < w * h; i++) rgb.set(windows.has(i) ? [0.02, 0.02, 0.03] : hash32(`поле${i}`) % 3 ? [0.62, 0.58, 0.5] : [0.56, 0.52, 0.45], i * 3);
    return { w, h, rgb };
  }
  const dark = (p: { cells: Uint8Array; threads: { rgb: number }[] }) => [...p.cells].filter((c) => c !== CANVAS && p.threads[c].rgb >> 16 < 0x30).length;

  test('без охраны тёмные окна в одну клетку уходят в соседнюю нить, с охраной — остаются', () => {
    const g = field();
    expect(dark(buildPattern(g, { id: 'okna', v: 1, threads: 3, clean: SMOOTH_CLEAN }).pattern)).toBe(0);
    expect(dark(buildPattern(g, { id: 'okna', v: 1, threads: 3, clean: { ...SMOOTH_CLEAN, guard: GUARD_START } }).pattern)).toBe(10);
  });

  test('охрана ослабляется, пока узор не примут; не приняли ни разу — чистка без охраны', () => {
    const g = field();
    let calls = 0;
    const third = buildGuarded(g, { id: 'okna', v: 1, threads: 3 }, () => ++calls === 3);
    expect(calls).toBe(3);
    expect(third.guard).toBeCloseTo(GUARD_START * GUARD_GROW * GUARD_GROW, 12);
    const never = buildGuarded(g, { id: 'okna', v: 1, threads: 3 }, () => false);
    expect(never.guard).toBeUndefined();
    expect(never.pattern).toEqual(buildPattern(g, { id: 'okna', v: 1, threads: 3, clean: SMOOTH_CLEAN }).pattern);
  });
});
