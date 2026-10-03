// Раскладка картинки «Поделиться» (src/engine/share.ts; docs/specs/2026-09-library.md, «Готово»):
// работа — до 1600 точек по длинной стороне, клетка — до 64, вся картинка — до 2000; рамка,
// паспарту и работа вложены друг в друга, подпись — под рамкой.
import { describe, expect, test } from 'bun:test';
import { MAX_SIDE } from '../../src/engine/pattern';
import { SHARE_CELL_MAX, SHARE_PICTURE_MAX, shareLayout, type ShareRect } from '../../src/engine/share';

const inside = (a: ShareRect, b: ShareRect) => a.x > b.x && a.y > b.y && a.x + a.w < b.x + b.w && a.y + a.h < b.y + b.h;

describe('картинка «Поделиться»', () => {
  test('малый узор — клетка 64 точки, размеры по формуле', () => {
    const L = shareLayout(16, 18);
    expect(L.cell).toBe(SHARE_CELL_MAX);
    expect(L.work).toEqual({ x: 134, y: 134, w: 16 * 64, h: 18 * 64 });
    expect([L.width, L.height]).toEqual([16 * 64 + 268, 18 * 64 + 386]);
  });

  test('на любых размерах: клетка 1–64, работа до 1600, картинка до 2000, всё вложено', () => {
    for (const [w, h] of [[1, 1], [16, 18], [25, 25], [26, 40], [37, 20], [120, 80], [180, 240], [MAX_SIDE, MAX_SIDE], [MAX_SIDE, 30]]) {
      const L = shareLayout(w, h);
      const at = `${w} × ${h}`;
      expect([at, L.cell >= 1 && L.cell <= SHARE_CELL_MAX]).toEqual([at, true]);
      expect([at, Math.max(L.work.w, L.work.h) <= Math.max(SHARE_PICTURE_MAX, Math.max(w, h))]).toEqual([at, true]);
      expect([at, L.width <= 2000 && L.height <= 2000]).toEqual([at, true]);
      expect([at, inside(L.work, L.mat) && inside(L.mat, L.frame) && inside(L.frame, { x: 0, y: 0, w: L.width + 1, h: L.height + 1 })]).toEqual([at, true]);
      const below = L.frame.y + L.frame.h;
      expect([at, below < L.title && L.title < L.caption && L.caption < L.mark && L.mark < L.height]).toEqual([at, true]);
      expect([at, L.title < L.markAlone && L.markAlone < L.mark]).toEqual([at, true]);
    }
  });

  test('клетка — наибольшая, при которой работа помещается в 1600 точек', () => {
    for (const side of [25, 26, 64, 100, 400]) {
      const { cell } = shareLayout(side, side);
      expect(cell).toBe(Math.max(1, Math.min(SHARE_CELL_MAX, Math.floor(SHARE_PICTURE_MAX / side))));
    }
  });
});
