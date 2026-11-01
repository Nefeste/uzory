// Важные части снимка — лица (src/engine/build/focus.ts; владелец 15.10.2026: «Важные части — это
// например лица»). Лицо — малая доля кадра: без рамки палитра всего снимка отдаёт его чужим нитям, а
// чистка «конфетти» стирает глаза и рот; по рамке у лица свои нити, и глаза с ртом остаются.
import { describe, expect, test } from 'bun:test';
import { focusMask, focusThreads, FOCUS_THREADS, MAIN_SHARE, mainThreads } from '../../src/engine/build/focus';
import type { Raster } from '../../src/engine/build/grid';
import { buildPattern } from '../../src/engine/build/palette';
import { photoGrid } from '../../src/engine/build/photo';
import { deltaOK, linearToLab, rgbToLab } from '../../src/engine/color';

/**
 * Снимок 400 × 300: полосы восьми цветов — фон, светлая сиреневая рубаха внизу, посреди — лицо:
 * тёмные волосы сверху, светлая щека и щека в тени, тёмные глаза ровно в клетку, красный рот в
 * четыре клетки. Клетка узора — 5 точек. Глаза в клетку стирает чистка, а нить в две клетки реже
 * нижней границы — у настоящего лица глаз берёт нить волос и бровей, здесь так же.
 */
const W = 400, H = 300;
const BANDS = [0x6f9fd8, 0x9cc4e8, 0x5f8f3a, 0x8fb04a, 0xc8b060, 0x7a5a3a, 0x8a8a8a, 0x4a4a6a];
const SHIRT = 0xdcd8ec;
const LIT = 0xf0c8b8, SHADE = 0xc08878, HAIR = 0x3a2418, EYE = 0x2a1a14, MOUTH = 0xa83c3c;
const FACE = { cx: 200, cy: 120, rx: 32, ry: 40 };
/** Левый верхний угол глаза: квадрат 5 × 5 точек — одна клетка узора. */
const EYES: [number, number][] = [[185, 110], [210, 110]];

function photo(): Raster {
  const data = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let c = y > 200 ? SHIRT : BANDS[Math.floor((x * BANDS.length) / W)];
      if (((x - FACE.cx) / FACE.rx) ** 2 + ((y - FACE.cy) / FACE.ry) ** 2 <= 1) c = y < FACE.cy - 22 ? HAIR : x < FACE.cx + 6 ? LIT : SHADE;
      for (const [ex, ey] of EYES) if (x >= ex && x < ex + 5 && y >= ey && y < ey + 5) c = EYE;
      if (x >= 190 && x < 210 && y >= 140 && y < 145) c = MOUTH;
      data.set([c >> 16, (c >> 8) & 255, c & 255], (y * W + x) * 3);
    }
  }
  return { width: W, height: H, data };
}

/** Рамка лица в долях снимка — с запасом в клетку. */
const FACE_RECT: [number, number, number, number] = [(FACE.cx - FACE.rx - 5) / W, (FACE.cy - FACE.ry - 5) / H, (FACE.cx + FACE.rx + 5) / W, (FACE.cy + FACE.ry + 5) / H];
const L = (rgb: number) => rgbToLab(rgb)[0];

describe('важные части снимка — лица', () => {
  const r = photo();
  const grid = photoGrid(r, { size: 80 });
  const opts = { id: 'litso', v: 1, threads: 20 };
  const mask = focusMask([0, 0, 1, 1], grid.w, grid.h, [FACE_RECT])!;
  const plain = buildPattern(grid, opts).pattern;
  const focused = buildPattern(grid, { ...opts, focus: mask }).pattern;
  const cellOf = (x: number, y: number) => Math.floor((y / H) * grid.h) * grid.w + Math.floor((x / W) * grid.w);
  /** Самая тёмная нить у глаза: клетка глаза и её соседи по сторонам. */
  const eyeL = (p: typeof plain, x: number, y: number) => {
    const i = cellOf(x, y);
    return Math.min(...[i, i - 1, i + 1, i - grid.w, i + grid.w].map((j) => L(p.threads[p.cells[j]].rgb)));
  };
  /** Средняя ошибка цвета в рамке: насколько нить клетки далека от её цвета на снимке. */
  const error = (p: typeof plain) => {
    let sum = 0, n = 0;
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      sum += deltaOK(linearToLab(grid.rgb[i * 3], grid.rgb[i * 3 + 1], grid.rgb[i * 3 + 2]), rgbToLab(p.threads[p.cells[i]].rgb));
      n++;
    }
    return sum / n;
  };

  test('рамка — клетки с центром внутри, в долях снимка с учётом кадра', () => {
    const m = focusMask([0.5, 0, 1, 1], 10, 10, [[0.5, 0.2, 0.75, 0.5]])!;
    const on = [...m.keys()].filter((i) => m[i]);
    // кадр — правая половина снимка: рамка 0,5…0,75 — левая половина узора, 0,2…0,5 по высоте
    expect(on).toEqual([2, 3, 4].flatMap((y) => [0, 1, 2, 3, 4].map((x) => y * 10 + x)));
    expect(focusMask([0, 0, 1, 1], 10, 10, [[0.31, 0.31, 0.34, 0.34]])).toBeUndefined();
  });

  test('без рамки глаза уходят в кожу: пятно в клетку стирает чистка', () => {
    for (const [ex, ey] of EYES) expect(eyeL(plain, ex, ey)).toBeGreaterThan(0.45);
  });

  test('по рамке глаза тёмные, рот темнее кожи, цвет лица ближе к снимку', () => {
    for (const [ex, ey] of EYES) expect(eyeL(focused, ex, ey)).toBeLessThan(0.35);
    // рот в четыре клетки — реже нижней границы нити (8 клеток): своей красной нити у него нет, но он темнее кожи
    const L2 = (x: number, y: number) => L(focused.threads[focused.cells[cellOf(x, y)]].rgb);
    expect(L2(200, 142)).toBeLessThan(L2(200, 132) - 0.2);
    expect(error(focused)).toBeLessThan(error(plain) * 0.75);
  });

  test('нитей на лицо — не больше шести и не больше пятой части; всего — не больше заказанного', () => {
    expect(focusThreads(40)).toBe(FOCUS_THREADS);
    expect(focusThreads(20)).toBe(4);
    expect(focusThreads(9)).toBe(1);
    expect(focused.threads.length).toBeLessThanOrEqual(opts.threads);
  });

  test('главному «Своего узора» — половина нитей (0.20.0), лицам библиотеки — как было', () => {
    expect(MAIN_SHARE).toBe(0.5);
    expect(mainThreads(24)).toBe(12);
    expect(mainThreads(32)).toBe(16);
    expect(mainThreads(3)).toBe(1);
    expect(focusThreads(24)).toBe(4);
  });

  test('та же рамка — тот же узор: сборка без случайности', () => {
    expect(buildPattern(grid, { ...opts, focus: mask }).pattern).toEqual(focused);
  });
});
