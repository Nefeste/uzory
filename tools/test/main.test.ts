// «Главное» и фон своего узора (src/engine/build/main.ts; 0.19.0, решения владельца 01.11.2026): овал
// в рамке, своя палитра и бережная чистка, резкие точки без упрощения; фон — как есть, одной нитью или
// не вышивать; одиночки главного приговор не считает.
import { describe, expect, test } from 'bun:test';
import type { Grid, Raster } from '../../src/engine/build/grid';
import { keepInside, ovalMask, SHARP_POINT, unionMask, withBackground } from '../../src/engine/build/main';
import { buildMine, type Crop, MINE_GRID } from '../../src/engine/build/mine';
import { mainMask, photoGrid } from '../../src/engine/build/photo';
import { deltaOK, linear, linearToLab, rgbToLab } from '../../src/engine/color';
import { CANVAS, type Pattern } from '../../src/engine/pattern';
import { patternStats } from '../../src/engine/stats';

const C = 4;
/** Снимок по клеткам: `cell(x, y)` → 0xRRGGBB, каждая клетка — C × C точек (усреднять нечего). */
function cells(w: number, h: number, cell: (x: number, y: number) => number): Raster {
  const data = new Uint8Array(w * C * h * C * 3);
  for (let y = 0; y < h * C; y++) {
    for (let x = 0; x < w * C; x++) {
      const c = cell(Math.floor(x / C), Math.floor(y / C));
      data.set([c >> 16, (c >> 8) & 255, c & 255], (y * w * C + x) * 3);
    }
  }
  return { width: w * C, height: h * C, data };
}

const lightness = (p: Pattern, i: number) => (p.cells[i] === CANVAS ? 1 : rgbToLab(p.threads[p.cells[i]].rgb)[0]);

/** Четыре «лица» на траве: светлые круги, в каждом два тёмных зрачка в клетку; внизу — тёмная земля той же нити. */
const W = 60, H = 45;
const faces = [[12, 12], [32, 14], [48, 30], [20, 32]];
const pupils = faces.flatMap(([fx, fy]) => [(fy - 2) * W + fx - 3, (fy - 2) * W + fx + 3]);
const scene = cells(W, H, (x, y) => {
  if (pupils.includes(y * W + x)) return 0x1e1810;
  if (faces.some(([fx, fy]) => (x - fx) ** 2 + (y - fy) ** 2 < 49)) return 0xe8c4a0;
  return y > 40 ? 0x1e1810 : 0x6f8a5a;
});
/** Главное — овал вокруг первого лица (доли снимка). */
const MAIN: Crop = [4 / W, 4 / H, 21 / W, 21 / H];

describe('главное — овал в рамке', () => {
  test('клетки овала: центр рамки — внутри, углы рамки — снаружи, доля — около π/4 рамки', () => {
    const m = ovalMask([0, 0, 1, 1], 100, 100, [0.2, 0.2, 0.6, 0.6])!;
    expect(m[40 * 100 + 40]).toBe(1);
    expect(m[21 * 100 + 21]).toBe(0);
    expect(m[58 * 100 + 58]).toBe(0);
    const n = m.reduce((s, v) => s + v, 0);
    expect(n / (40 * 40)).toBeCloseTo(Math.PI / 4, 1);
    // кадр — часть снимка: овал в долях снимка, клетки — кадра
    const half = ovalMask([0.5, 0, 1, 1], 50, 100, [0.2, 0.2, 0.6, 0.6])!;
    expect(half[40 * 50 + 0]).toBe(1);
    expect(half[40 * 50 + 20]).toBe(0);
    // овал вне кадра — главного нет
    expect(ovalMask([0, 0, 0.1, 0.1], 10, 10, [0.5, 0.5, 0.9, 0.9])).toBeUndefined();
    expect(unionMask(undefined, undefined)).toBeUndefined();
    expect(Array.from(unionMask(new Uint8Array([1, 0, 0]), new Uint8Array([0, 0, 1]))!)).toEqual([1, 0, 1]);
  });

  test('в главном упрощение не трогает резких точек: зрачок остаётся тёмным, рябь — выравнивается', () => {
    const plain = photoGrid(scene, { crop: [0, 0, 1, 1], size: W, ...MINE_GRID, simplify: 1 });
    const kept = photoGrid(scene, { crop: [0, 0, 1, 1], size: W, ...MINE_GRID, simplify: 1, main: MAIN });
    const L = (g: Grid, i: number) => linearToLab(g.rgb[i * 3], g.rgb[i * 3 + 1], g.rgb[i * 3 + 2])[0];
    const [left, right] = [pupils[0], pupils[1]];
    // без главного упрощение смешивает зрачок в клетку с кожей; в главном — нет
    expect(L(plain, left)).toBeGreaterThan(0.5);
    expect(L(kept, left)).toBeLessThan(0.3);
    expect(L(kept, right)).toBeLessThan(0.3);
    // зрачок второго лица — вне главного: как без него
    expect(L(kept, pupils[2])).toBeCloseTo(L(plain, pupils[2]), 6);
    // мелкая рябь (ближе SHARP_POINT) в главном выравнивается, как везде
    const ripple: Grid = { w: 2, h: 1, rgb: Float64Array.from([linear(200), linear(150), linear(120), linear(205), linear(150), linear(120)]) };
    const even: Grid = { w: 2, h: 1, rgb: Float64Array.from([linear(202), linear(150), linear(120), linear(202), linear(150), linear(120)]) };
    const mixed = keepInside(even, ripple, new Uint8Array([1, 1]));
    expect(deltaOK(linearToLab(ripple.rgb[0], ripple.rgb[1], ripple.rgb[2]), linearToLab(even.rgb[0], even.rgb[1], even.rgb[2]))).toBeLessThan(SHARP_POINT);
    expect(Array.from(mixed.rgb)).toEqual(Array.from(even.rgb));
  });

  test('фон: «не вышивать» — канва вне овала; «одной нитью» — преобладающий цвет фона', () => {
    // фон: трава и меньше неба
    const g: Grid = { w: 10, h: 1, rgb: new Float64Array(30) };
    const green = [linear(0x4f), linear(0x8a), linear(0x3c)];
    const sky = [linear(0x9c), linear(0xc3), linear(0xe6)];
    for (let i = 0; i < 10; i++) g.rgb.set(i < 6 ? green : sky, i * 3);
    // в главном — две клетки неба; на фоне — шесть травы и две неба
    const mask = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 1, 1]);
    const none = withBackground(g, mask, 'none');
    expect(Array.from(none.paper!)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 0, 0]);
    const one = withBackground(g, mask, 'one');
    // вне главного — один цвет, и это трава (её на фоне больше); главное — как было
    const lab = (i: number) => linearToLab(one.rgb[i * 3], one.rgb[i * 3 + 1], one.rgb[i * 3 + 2]);
    for (const i of [0, 3, 6, 7]) expect(deltaOK(lab(i), lab(0))).toBeLessThan(1e-9);
    expect(deltaOK(lab(0), linearToLab(green[0], green[1], green[2]))).toBeLessThan(0.02);
    expect(deltaOK(lab(9), linearToLab(sky[0], sky[1], sky[2]))).toBeLessThan(1e-9);
  });

  test('одиночки главного проверка не считает, а нить из одних таких одиночек — не «одинокая»', () => {
    // 4 × 3: в главном — одна клетка другой нити посреди фона
    const p: Pattern = { key: 'proba@1', w: 4, h: 3, threads: [{ rgb: 0x6f8a5a, name: 'трава' }, { rgb: 0x1e1810, name: 'зрачок' }], cells: new Uint8Array([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]) };
    const all = patternStats(p);
    expect(all.singles).toBeGreaterThan(0);
    expect(all.lonely).toEqual([1]);
    const skip = new Uint8Array(12);
    skip[5] = 1;
    const judged = patternStats(p, false, skip);
    expect(judged.singles).toBe(0);
    expect(judged.small).toBe(0);
    expect(judged.lonely).toEqual([]);
  });

  test('«Свой узор» с главным: зрачки на месте, и при фоне «не вышивать» узор подходит', () => {
    const o = { crop: [0, 0, 1, 1] as Crop, side: W, threads: 8, simplify: 1 as const };
    const plain = buildMine(scene, o);
    const main = buildMine(scene, { ...o, main: MAIN });
    expect(pupils.slice(0, 2).map((i) => lightness(plain.pattern, i) < 0.4)).toEqual([false, false]);
    expect(pupils.slice(0, 2).map((i) => lightness(main.pattern, i) < 0.4)).toEqual([true, true]);
    expect(main.verdict.level).not.toBe('bad');
    // фон не вышивается: вне овала — канва, вышивается только главное
    const none = buildMine(scene, { ...o, main: MAIN, background: 'none' });
    const mask = mainMask({ crop: o.crop, main: MAIN }, none.pattern)!;
    for (let i = 0; i < mask.length; i++) if (!mask[i]) expect(none.pattern.cells[i]).toBe(CANVAS);
    expect(none.checked.stats.cells).toBe(mask.reduce((s, v) => s + v, 0));
    expect(none.verdict.level).not.toBe('bad');
    // фон одной нитью: вне овала — одна нить
    const one = buildMine(scene, { ...o, main: MAIN, background: 'one' });
    const outside = new Set<number>();
    for (let i = 0; i < mask.length; i++) if (!mask[i]) outside.add(one.pattern.cells[i]);
    expect(outside.size).toBe(1);
  });
});
