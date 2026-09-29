// Упрощение (src/engine/build/simplify.ts): фильтр выравнивает цвет внутри пятен и не двигает
// границы, а чистка по одной сливает шашечки, которые чистка «все сразу» только перекрашивает.
import { describe, expect, test } from 'bun:test';
import type { Grid } from '../../src/engine/build/grid';
import { CLEAN, cleanup, regions } from '../../src/engine/build/palette';
import { kuwahara, SIMPLIFY_CLEAN, simplifyGrid } from '../../src/engine/build/simplify';
import { hash32 } from '../../src/engine/seed';

/** Сетка из функции цвета клетки в линейном свете. */
function grid(w: number, h: number, color: (x: number, y: number) => [number, number, number], paper?: (x: number, y: number) => boolean): Grid {
  const rgb = new Float64Array(w * h * 3);
  const mask = paper ? new Uint8Array(w * h) : undefined;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      rgb.set(color(x, y), (y * w + x) * 3);
      if (mask && paper!(x, y)) mask[y * w + x] = 1;
    }
  }
  return { w, h, rgb, paper: mask };
}

/** Шум ±`amp` от клетки — один и тот же на любой машине. */
const noise = (x: number, y: number, amp: number) => ((hash32(`${x},${y}`) % 1000) / 1000 - 0.5) * 2 * amp;
const RED: [number, number, number] = [0.6, 0.08, 0.05];
const GREEN: [number, number, number] = [0.05, 0.3, 0.08];
const dist = (g: Grid, i: number, c: [number, number, number]) => Math.hypot(g.rgb[i * 3] - c[0], g.rgb[i * 3 + 1] - c[1], g.rgb[i * 3 + 2] - c[2]);

describe('упрощение', () => {
  test('«нет» — та же сетка; граница двух пятен остаётся на месте, шум внутри уходит', () => {
    const w = 24, h = 12, edge = 11;
    const g = grid(w, h, (x, y) => (x < edge ? RED : GREEN).map((v) => v + noise(x, y, 0.04)) as [number, number, number]);
    expect(simplifyGrid(g, 0)).toBe(g);
    for (const level of [1, 2] as const) {
      const s = simplifyGrid(g, level);
      let before = 0, after = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const own = x < edge ? RED : GREEN;
          // каждая клетка — по свою сторону границы: к своему цвету ближе, чем к чужому
          expect(dist(s, i, own)).toBeLessThan(dist(s, i, x < edge ? GREEN : RED));
          before += dist(g, i, own);
          after += dist(s, i, own);
        }
      }
      expect(after).toBeLessThan(before * 0.7);
    }
  });

  test('бумага схемы не трогается и в соседние клетки не подмешивается', () => {
    const w = 16, h = 10;
    const paper = (x: number) => x >= 8;
    const g = grid(w, h, (x, y) => (paper(x) ? [0.9, 0.88, 0.8] : RED.map((v) => v + noise(x, y, 0.03)) as [number, number, number]), paper);
    const s = kuwahara(g, 2, 1);
    for (let i = 0; i < w * h; i++) {
      if (g.paper![i]) expect([s.rgb[i * 3], s.rgb[i * 3 + 1], s.rgb[i * 3 + 2]]).toEqual([g.rgb[i * 3], g.rgb[i * 3 + 1], g.rgb[i * 3 + 2]]);
      else expect(dist(s, i, RED)).toBeLessThan(0.05);
    }
  });

  test('шашечку чистка по одной сливает, а все сразу — только меняет цветами', () => {
    const w = 8, h = 8;
    const chess = () => Int32Array.from({ length: w * h }, (_, i) => ((i % w) + Math.floor(i / w)) % 2);
    const smallest = (cells: Int32Array) => Math.min(...regions(cells, w, h).sizes);
    const together = chess();
    cleanup(together, w, h, undefined, { ...CLEAN, minRegion: 6 });
    expect(smallest(together)).toBe(1);
    for (const clean of [SIMPLIFY_CLEAN[1], SIMPLIFY_CLEAN[2]]) {
      const one = chess();
      expect(cleanup(one, w, h, undefined, clean)).toBe(true);
      expect(smallest(one)).toBeGreaterThanOrEqual(clean.minRegion);
    }
    // канва (−1) не перекрашивается и цветом для соседей не служит
    const withCanvas = chess();
    for (let i = 0; i < w; i++) withCanvas[i] = -1;
    cleanup(withCanvas, w, h, undefined, SIMPLIFY_CLEAN[2]);
    expect([...withCanvas.slice(0, w)]).toEqual(Array(w).fill(-1));
    expect([...withCanvas.slice(w)].every((c) => c >= 0)).toBe(true);
  });
});
