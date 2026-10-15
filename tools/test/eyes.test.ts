// Глаза снимка (src/engine/build/eyes.ts; разбор «Кота в окне», 15.10.2026): глаз мельче клетки
// пропадает в шерсти, а по рамке автора карточки сборка возвращает его нитью узора.
import { describe, expect, test } from 'bun:test';
import { findEyes, paintEyes, type Rect } from '../../src/engine/build/eyes';
import type { Raster } from '../../src/engine/build/grid';
import { buildPattern } from '../../src/engine/build/palette';
import { photoGrid } from '../../src/engine/build/photo';
import { rgbToLab } from '../../src/engine/color';

/** Снимок 420 × 300: слева тёмная стена, посреди рыжая морда, глаза — пятна радиусом 2,5 точки. */
const W = 420, H = 300;
const EYES: [number, number, number][] = [[190, 140, 0x161616], [236, 140, 0x161616]];
const PALE: [number, number, number] = [60, 200, 0xe6ebea];
function photo(): Raster {
  const data = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let c = x < 120 ? 0x202224 : 0xc8782e;
      for (const [ex, ey, ec] of [...EYES, PALE]) if ((x - ex) ** 2 + (y - ey) ** 2 <= 6.25) c = ec;
      data.set([c >> 16, (c >> 8) & 255, c & 255], (y * W + x) * 3);
    }
  }
  return { width: W, height: H, data };
}

/** Рамка вокруг точки снимка: ±`r` точек, доли кадра. */
const around = (x: number, y: number, r = 9): Rect => [(x - r) / W, (y - r) / H, (x + r) / W, (y + r) / H];
const L = (rgb: number) => rgbToLab(rgb)[0];

describe('глаза снимка', () => {
  const r = photo();
  const base = buildPattern(photoGrid(r, { size: 70, grid: 'dominant' }), { id: 'glaza', v: 1, threads: 6 }).pattern;
  const cell = (x: number, y: number) => base.cells[Math.floor((y / H) * base.h) * base.w + Math.floor((x / W) * base.w)];

  test('без рамок глаз нет: пятно мельче клетки уходит в шерсть', () => {
    for (const [ex, ey] of EYES) expect(L(base.threads[cell(ex, ey)].rgb)).toBeGreaterThan(0.5);
  });

  test('по рамке — клетка глаза тёмной нитью узора, новых нитей нет', () => {
    const eyes = findEyes(r, [0, 0, 1, 1], base.w, base.h, EYES.map(([x, y]) => around(x, y)));
    expect(eyes.length).toBeGreaterThanOrEqual(2);
    expect(eyes.length).toBeLessThanOrEqual(4);
    const p = paintEyes(base, eyes);
    expect(p.threads).toBe(base.threads);
    for (const [ex, ey] of EYES) {
      const i = Math.floor((ey / H) * p.h) * p.w + Math.floor((ex / W) * p.w);
      const near = [i, i - 1, i + 1, i - p.w, i + p.w].map((j) => L(p.threads[p.cells[j]].rgb));
      expect(Math.min(...near)).toBeLessThan(0.35);
    }
    // вне глаз узор тот же
    const changed = [...p.cells].filter((c, i) => c !== base.cells[i]).length;
    expect(changed).toBe(eyes.length);
  });

  test('светлый глаз на тёмном — светлой нитью', () => {
    const [ex, ey] = PALE;
    const eyes = findEyes(r, [0, 0, 1, 1], base.w, base.h, [around(ex, ey)]);
    expect(eyes.length).toBeGreaterThanOrEqual(1);
    const p = paintEyes(base, eyes);
    const e = eyes[0];
    expect(L(p.threads[p.cells[e.y * p.w + e.x]].rgb)).toBeGreaterThan(0.6);
  });

  test('рамка без глаза — ничего; рамка мельче клетки — клетка под её серединой', () => {
    expect(findEyes(r, [0, 0, 1, 1], base.w, base.h, [around(330, 250)])).toEqual([]);
    const [ex, ey] = EYES[0];
    const tiny = findEyes(r, [0, 0, 1, 1], base.w, base.h, [around(ex, ey, 0.5)]);
    expect(tiny.map((e) => [e.x, e.y])).toEqual([[Math.floor((ex / W) * base.w), Math.floor((ey / H) * base.h)]]);
  });

  test('та же рамка — те же глаза: сборка без случайности', () => {
    const rects = EYES.map(([x, y]) => around(x, y));
    expect(findEyes(r, [0, 0, 1, 1], base.w, base.h, rects)).toEqual(findEyes(r, [0, 0, 1, 1], base.w, base.h, rects));
  });
});
