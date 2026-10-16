// Глаза снимка (src/engine/build/eyes.ts; разбор «Кота в окне», 15.10.2026): глаз мельче клетки
// пропадает в шерсти, а по рамке автора карточки сборка возвращает его нитью узора.
import { describe, expect, test } from 'bun:test';
import { findEyes, findLines, paintEyes, type Rect } from '../../src/engine/build/eyes';
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

// Кресты на главах (`pattern.lines`, 16.10.2026): линия креста тоньше клетки, клетка берёт цвет неба.
describe('кресты на главах', () => {
  /**
   * Небо 420 × 300 (клетка узора — 6 точек), внизу тёмная глава, над ней тёмный крест линиями в две
   * точки: столб x 200–201, y 60–139, перекладина y 85–86, x 180–223. Трос от конца перекладины к главе —
   * в одну точку и бледнее; птица — тёмное пятно в рамке, но не на кресте.
   */
  const SKY = 0xb4cce6, CROSS = 0x2a2018, WIRE = 0x8c97a4, DOME = 0x26292c;
  const BIRD: [number, number] = [150, 120];
  function sky(): Raster {
    const data = new Uint8Array(W * H * 3);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let c = y >= 140 && ((x - 200) / 60) ** 2 + ((y - 200) / 60) ** 2 <= 1 ? DOME : SKY;
        if (x >= 224 && x < 262 && Math.abs(y - (86 + (x - 224) * 1.6)) < 0.5) c = WIRE;
        if ((x === 200 || x === 201) && y >= 60 && y < 140) c = CROSS;
        if ((y === 85 || y === 86) && x >= 180 && x < 224) c = CROSS;
        if ((x - BIRD[0]) ** 2 + (y - BIRD[1]) ** 2 <= 9) c = CROSS;
        data.set([c >> 16, (c >> 8) & 255, c & 255], (y * W + x) * 3);
      }
    }
    return { width: W, height: H, data };
  }
  const r = sky();
  // нитей больше, чем цветов: у креста была бы своя нить, если бы он вышел в клетки
  const base = buildPattern(photoGrid(r, { size: 70, grid: 'dominant' }), { id: 'krest', v: 1, threads: 4 }).pattern;
  const box: Rect = [140 / W, 50 / H, 280 / W, 170 / H];
  const at = (x: number, y: number) => Math.floor((y / H) * base.h) * base.w + Math.floor((x / W) * base.w);

  test('без рамки креста нет: линия в треть клетки уходит в небо', () => {
    for (let y = 62; y < 140; y += 6) expect(L(base.threads[base.cells[at(200, y)]].rgb)).toBeGreaterThan(0.7);
  });

  test('по рамке — столб и перекладина одной тёмной нитью узора; трос и птица — нет', () => {
    const marks = findLines(r, [0, 0, 1, 1], base.w, base.h, [box]);
    const p = paintEyes(base, marks);
    expect(p.threads).toBe(base.threads);
    const dark = (x: number, y: number) => L(p.threads[p.cells[at(x, y)]].rgb) < 0.4;
    // столб — от верха до низа, перекладина — от края до края
    for (let y = 62; y < 138; y += 6) expect(dark(200, y)).toBe(true);
    for (let x = 182; x < 222; x += 6) expect(dark(x, 86)).toBe(true);
    // всё отмеченное — на кресте, в клетке от его линий
    for (const m of marks) {
      const x = (m.x + 0.5) * (W / base.w), y = (m.y + 0.5) * (H / base.h);
      expect(Math.abs(x - 200.5) <= 6 || Math.abs(y - 85.5) <= 6).toBe(true);
    }
    expect(dark(BIRD[0], BIRD[1])).toBe(false);
    expect(dark(250, 86 + 26 * 1.6)).toBe(false);
    // крест — одним цветом
    expect(new Set(marks.map((m) => p.cells[m.y * p.w + m.x])).size).toBe(1);
  });

  test('рамка без креста — ничего; та же рамка — тот же крест', () => {
    expect(findLines(r, [0, 0, 1, 1], base.w, base.h, [[300 / W, 200 / H, 400 / W, 290 / H]])).toEqual([]);
    expect(findLines(r, [0, 0, 1, 1], base.w, base.h, [box])).toEqual(findLines(r, [0, 0, 1, 1], base.w, base.h, [box]));
  });
});
