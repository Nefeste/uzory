// Раскладка картинки «Поделиться» (src/engine/share.ts; docs/specs/2026-09-library.md, «Готово»):
// работа — до 1600 точек по длинной стороне, клетка — до 64, вся картинка — до 2000; рамка,
// паспарту и работа вложены друг в друга, подпись — под рамкой.
import { describe, expect, test } from 'bun:test';
import { MAX_SIDE } from '../../src/engine/pattern';
import { SHARE_CELL_MAX, SHARE_PICTURE_MAX, SHARE_STITCHES_FROM, shareLayout, type ShareRect, shareStitches } from '../../src/engine/share';

const inside = (a: ShareRect, b: ShareRect) => a.x > b.x && a.y > b.y && a.x + a.w < b.x + b.w && a.y + a.h < b.y + b.h;

describe('картинка «Поделиться»', () => {
  test('малый узор — клетка 64 точки, размеры по формуле; рама и поля растут с работой (0.21.0)', () => {
    const L = shareLayout(16, 18);
    expect(L.cell).toBe(SHARE_CELL_MAX);
    // работа 1024 × 1152 — в 1,44 раза больше SHARE_BASE: рама 25, паспарту 63, поле 103 точки (вниз)
    expect(L.work).toEqual({ x: 103 + 25 + 63, y: 103 + 25 + 63, w: 16 * 64, h: 18 * 64 });
    expect([L.width, L.height]).toEqual([16 * 64 + 2 * (103 + 25 + 63), 18 * 64 + 2 * (25 + 63) + 103 + 190]);
    expect(L.k).toBeCloseTo(2 * 1.44, 9);
    // работа не больше SHARE_BASE — как до 0.21.0
    const small = shareLayout(10, 10);
    expect(small.work.w).toBe(640);
    expect([small.width, small.height]).toEqual([640 + 268, 640 + 386]);
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

  test('пяльцы (оформление, 0.18.0): картинка до 2000, углы работы — внутри круга ткани, ткань — внутри обода', () => {
    for (const [w, h] of [[1, 1], [16, 18], [25, 25], [37, 20], [120, 80], [180, 240], [MAX_SIDE, MAX_SIDE], [MAX_SIDE, 30]]) {
      const L = shareLayout(w, h, true);
      const at = `${w} × ${h}`;
      expect([at, L.cell >= 1 && L.cell <= SHARE_CELL_MAX && Math.hypot(L.work.w, L.work.h) <= Math.max(SHARE_PICTURE_MAX, Math.hypot(w, h))]).toEqual([at, true]);
      expect([at, L.width <= 2000 && L.height <= 2000]).toEqual([at, true]);
      const cx = L.mat.x + L.mat.w / 2;
      const cy = L.mat.y + L.mat.h / 2;
      const corners = [[L.work.x, L.work.y], [L.work.x + L.work.w, L.work.y], [L.work.x, L.work.y + L.work.h], [L.work.x + L.work.w, L.work.y + L.work.h]];
      expect([at, corners.every(([x, y]) => Math.hypot(x - cx, y - cy) < L.mat.w / 2)]).toEqual([at, true]);
      expect([at, L.mat.w === L.mat.h && L.frame.w === L.frame.h && inside(L.mat, L.frame)]).toEqual([at, true]);
      expect([at, L.frame.y + L.frame.h < L.title && L.mark < L.height]).toEqual([at, true]);
    }
  });

  test('стежки — с клетки 14 точек: у узоров до 114 клеток по длинной стороне', () => {
    // решение владельца 09.10.2026 — по образцам; на канве стиль виден с 18 dp, вместе с номерами
    expect(SHARE_STITCHES_FROM).toBe(14);
    expect(shareLayout(114, 60).cell).toBeGreaterThanOrEqual(SHARE_STITCHES_FROM);
    expect(shareLayout(115, 60).cell).toBeLessThan(SHARE_STITCHES_FROM);
  });

  test('стежки — только по настройке «Стежки на картинке „Поделиться“»', () => {
    // владелец 15.10.2026: стежки на «Поделиться» — на усмотрение игрока; что сразу она выключена,
    // проверяет сценарий (tools/e2e/smoke.ts)
    expect(shareStitches(SHARE_CELL_MAX, false)).toBe(false);
    expect(shareStitches(SHARE_CELL_MAX, true)).toBe(true);
    expect(shareStitches(SHARE_STITCHES_FROM, true)).toBe(true);
    expect(shareStitches(SHARE_STITCHES_FROM - 1, true)).toBe(false);
  });

  test('клетка — наибольшая, при которой работа помещается в 1600 точек', () => {
    for (const side of [25, 26, 64, 100, 400]) {
      const { cell } = shareLayout(side, side);
      expect(cell).toBe(Math.max(1, Math.min(SHARE_CELL_MAX, Math.floor(SHARE_PICTURE_MAX / side))));
    }
  });
});
