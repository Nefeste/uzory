// Мягкое небо (src/engine/build/soft.ts) и тон (src/engine/build/tone.ts): без полей карточки сборка та
// же до байта; на ровном небе граница полос идёт волной, а детали не трогаются; тон темнит середину и
// насыщает выцветший снимок, а снимок с полным светом не меняет.
import { describe, expect, test } from 'bun:test';
import { labToLinear, linearToLab, rgbToLab } from '../../src/engine/color';
import type { Grid, Raster } from '../../src/engine/build/grid';
import { buildPattern } from '../../src/engine/build/palette';
import { photoGrid } from '../../src/engine/build/photo';
import { GUARD_START, SMOOTH_CLEAN } from '../../src/engine/build/smooth';
import { SOFT_AMP, softField, softMask } from '../../src/engine/build/soft';
import { toneGrid } from '../../src/engine/build/tone';
import { hash32 } from '../../src/engine/seed';

/** Сетка w × h по цвету клетки в OKLab. */
function grid(w: number, h: number, at: (x: number, y: number) => [number, number, number]): Grid {
  const rgb = new Float64Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgb.set(labToLinear(at(x, y)).map((v) => Math.min(1, Math.max(0, v))), (y * w + x) * 3);
  return { w, h, rgb };
}

/** Небо: сверху синее, к горизонту светлее — ровно, без шума. */
const sky = () => grid(120, 60, (_, y) => [0.55 + (0.35 * y) / 59, -0.03, -0.09 + (0.06 * y) / 59]);
const opts = { id: 'nebo', v: 1, threads: 6, clean: { ...SMOOTH_CLEAN, guard: GUARD_START } };

/** Сколько строк узора — не одной нитью: у прямых полос таких нет. */
const mixedRows = (p: { w: number; h: number; cells: Uint8Array }) => {
  let n = 0;
  for (let y = 0; y < p.h; y++) if (new Set(p.cells.subarray(y * p.w, (y + 1) * p.w)).size > 1) n++;
  return n;
};

describe('мягкое небо', () => {
  test('без поля и с нулевым сдвигом — ближняя нить, узор тот же до клетки', () => {
    const g = sky();
    const plain = buildPattern(g, opts).pattern;
    expect(buildPattern(g, { ...opts, soft: new Float32Array(g.w * g.h) }).pattern).toEqual(plain);
  });

  test('ровное небо: без поля — прямые полосы, с ним — граница волной, а пятен мельче чистки нет', () => {
    const g = sky();
    const plain = buildPattern(g, opts).pattern;
    expect(plain.threads.length).toBeGreaterThanOrEqual(4);
    expect(mixedRows(plain)).toBe(0);
    const soft = buildPattern(g, { ...opts, soft: softField(g, 'nebo') }).pattern;
    expect(Math.abs(soft.threads.length - plain.threads.length)).toBeLessThanOrEqual(1);
    expect(mixedRows(soft)).toBeGreaterThan(g.h / 3);
    // клетка берёт свою нить или соседнюю по полосе — не дальше одного шага светлоты
    const light = (p: typeof plain, i: number) => rgbToLab(p.threads[p.cells[i]].rgb)[0];
    let far = 0;
    for (let i = 0; i < g.w * g.h; i++) if (Math.abs(light(soft, i) - light(plain, i)) > 0.12) far++;
    expect(far).toBe(0);
  });

  test('ровное — только большое и гладкое: крупная шашечка контрастных цветов и мелкое ровное пятно — мимо', () => {
    const blocks = grid(80, 60, (x, y) => (((x >> 2) + (y >> 2)) % 2 ? [0.3, 0.1, 0.05] : [0.85, -0.05, 0.08]));
    expect(softMask(blocks).every((m) => m === 0)).toBe(true);
    expect(softField(blocks, 'shashki').every((m) => m === 0)).toBe(true);
    // пёстрое поле с ровным пятном 6 × 6 клеток — меньше сотой доли кадра
    const spot = grid(80, 60, (x, y) => (x >= 37 && x < 43 && y >= 27 && y < 33 ? [0.7, 0, 0] : [0.4 + (hash32(`${x},${y}`) % 100) / 400, 0.05, 0.02]));
    expect(softMask(spot).every((m) => m === 0)).toBe(true);
  });

  test('сдвиг — до ±SOFT_AMP, из зерна карточки: одна карточка — один узор', () => {
    const g = sky();
    const a = softField(g, 'nebo');
    expect(Math.max(...a)).toBeLessThanOrEqual(SOFT_AMP);
    expect(Math.min(...a)).toBeGreaterThanOrEqual(-SOFT_AMP);
    expect(Math.max(...a)).toBeGreaterThan(SOFT_AMP * 0.9);
    expect(Buffer.from(softField(g, 'nebo').buffer).equals(Buffer.from(a.buffer))).toBe(true);
    expect(Buffer.from(softField(g, 'drugoe').buffer).equals(Buffer.from(a.buffer))).toBe(false);
  });
});

describe('тон', () => {
  const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const stats = (g: Grid) => {
    const L: number[] = [], C: number[] = [];
    for (let i = 0; i < g.w * g.h; i++) {
      const [l, a, b] = linearToLab(g.rgb[i * 3], g.rgb[i * 3 + 1], g.rgb[i * 3 + 2]);
      L.push(l); C.push(Math.hypot(a, b));
    }
    return { L: median(L), C: median(C), min: Math.min(...L), max: Math.max(...L) };
  };

  test('выцветший снимок: светлота растянута, середина темнее, цвета насыщеннее', () => {
    // светлота 0,75…0,97, хрома 0,02 — как у «Ниловой пустыни»
    const pale = grid(60, 40, (x, y) => [0.75 + 0.22 * ((hash32(`${x},${y}`) % 1000) / 999), 0.014, -0.014]);
    const before = stats(pale);
    const after = stats(toneGrid(pale, 1));
    expect(after.min).toBeLessThan(0.2);
    expect(after.L).toBeLessThan(before.L - 0.1);
    expect(after.C).toBeGreaterThan(before.C * 1.3);
    // половина силы — между
    const half = stats(toneGrid(pale, 0.5));
    expect(half.L).toBeLessThan(before.L);
    expect(half.L).toBeGreaterThan(after.L);
  });

  test('снимок с полным светом и цветом — как есть', () => {
    // светлота 0,1…0,98 ровно, медиана — 0,54; середина — с цветом (хрома 0,053), края — серые: в охвате sRGB
    const full = grid(60, 40, (x, y) => {
      const L = 0.1 + (0.88 * (y * 60 + x)) / 2399;
      return L >= 0.3 && L <= 0.8 ? [L, 0.04, 0.035] : [L, 0, 0];
    });
    const toned = toneGrid(full, 1);
    let d = 0;
    for (let i = 0; i < full.rgb.length; i++) d = Math.max(d, Math.abs(toned.rgb[i] - full.rgb[i]));
    // туда и обратно через OKLab — до 1e-6; шаг цвета в наборе — 1/255
    expect(d).toBeLessThan(1e-6);
  });

  test('в сетке снимка — после насыщенности; без поля — как раньше', () => {
    const r: Raster = { width: 40, height: 30, data: Uint8Array.from({ length: 40 * 30 * 3 }, (_, i) => 150 + (hash32(`т${i}`) % 90)) };
    const base = photoGrid(r, { size: 20, chroma: 1.2 });
    expect(photoGrid(r, { size: 20, chroma: 1.2, tone: 0.6 })).toEqual(toneGrid(base, 0.6));
    expect(photoGrid(r, { size: 20, chroma: 1.2 })).toEqual(base);
  });
});
