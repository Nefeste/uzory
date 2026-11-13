// «Светлица» (1.1.0, docs/specs/2026-11-svetlitsa.md; src/engine/gallery.ts): все готовые работы висят, каждая —
// один раз и по порядку; рамы с гвоздями и табличками — на стене, между рушником и полом, и не наезжают друг на
// друга; большие — выше обычных; рама работы — из рам игрока и всегда одна и та же.
import { describe, expect, test } from 'bun:test';
import { BIG_CELLS, frameFor, hangWalls, type HangItem, openingOf, pictureIn, ROOM, wallOf } from '../../src/engine/gallery';
import { FRAMES } from '../../src/engine/looks';
import type { Rect } from '../../src/engine/scene';

const item = (i: number, w: number, h: number, hoop = false): HangItem => ({ id: `w${i}`, w, h, hoop, big: w * h > BIG_CELLS });
const inside = (a: Rect, b: Rect) => a.x >= b.x - 0.5 && a.y >= b.y - 0.5 && a.x + a.w <= b.x + b.w + 0.5 && a.y + a.h <= b.y + b.h + 0.5;
const meet = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
/** рама с гвоздём над ней и табличкой под ней — место работы на стене */
const spot = (h: { frame: Rect; plaque: Rect }): Rect => {
  const x = Math.min(h.frame.x, h.plaque.x);
  const y = h.frame.y - ROOM.hang;
  return { x, y, w: Math.max(h.frame.x + h.frame.w, h.plaque.x + h.plaque.w) - x, h: h.plaque.y + h.plaque.h - y };
};

// разные: орнаменты, «Детям», вытянутые, большие картины, пяльцы
const MIX: HangItem[] = Array.from({ length: 41 }, (_, i) => {
  const shapes: [number, number][] = [[20, 20], [40, 30], [30, 60], [70, 40], [131, 178], [852, 556], [16, 14], [120, 40], [266, 360]];
  const [w, h] = shapes[i % shapes.length];
  return item(i, w, h, i % 5 === 3);
});

describe('«Светлица»: раскладка стен', () => {
  for (const [W, H] of [[400, 688], [360, 560], [412, 800], [800, 1000], [343, 220]] as const) {
    test(`${W} × ${H}: все работы по разу и по порядку, на стене, не наезжают`, () => {
      const walls = hangWalls(MIX, W, H);
      expect(walls.every((w) => w.items.length > 0)).toBe(true);
      // большие висят рядами больших — порядок внутри стены может сдвинуться, но каждая работа — ровно одна
      const ids = walls.flatMap((w) => w.items.map((h) => h.id));
      expect([...ids].sort()).toEqual(MIX.map((m) => m.id).sort());
      // новые — первыми: стена с первой работой — первая, с последней — последняя
      expect(wallOf(walls, MIX[0].id)).toBe(0);
      expect(wallOf(walls, MIX[MIX.length - 1].id)).toBe(walls.length - 1);
      const area = { x: ROOM.pad, y: ROOM.band + ROOM.pad, w: W - 2 * ROOM.pad, h: H - ROOM.band - ROOM.floor - 2 * ROOM.pad };
      for (const wall of walls) {
        for (const h of wall.items) {
          expect(inside(spot(h), area)).toBe(true);
          expect(h.frame.w).toBeGreaterThan(20);
          expect(h.nail.y).toBeLessThan(h.frame.y);
          expect(h.plaque.y).toBeGreaterThan(h.frame.y + h.frame.h);
        }
        for (let a = 0; a < wall.items.length; a++) {
          for (let b = a + 1; b < wall.items.length; b++) expect(meet(spot(wall.items[a]), spot(wall.items[b]))).toBe(false);
        }
      }
    });
  }

  test('на стене телефона — три ряда по три орнамента; большая картина — выше обычной работы', () => {
    const small = Array.from({ length: 9 }, (_, i) => item(i, 20, 20));
    const walls = hangWalls(small, 400, 688);
    expect(walls.length).toBe(1);
    expect(new Set(walls[0].items.map((h) => h.frame.y)).size).toBe(3);
    const both = hangWalls([item(0, 20, 20), item(1, 852, 556)], 400, 688)[0].items;
    expect(both[1].frame.h).toBeGreaterThan(both[0].frame.h);
    expect(both[0].frame.h).toBeLessThanOrEqual(ROOM.frame);
  });

  test('ни одной готовой работы — ни одной стены; чужой работы на стенах нет', () => {
    expect(hangWalls([], 400, 688)).toEqual([]);
    expect(wallOf(hangWalls(MIX, 400, 688), 'w-none')).toBe(-1);
  });

  test('пяльцы — круг: рама квадратная, узор поперёк круга целиком', () => {
    const hoop = hangWalls([item(0, 40, 30, true)], 400, 688)[0].items[0];
    expect(hoop.frame.w).toBe(hoop.frame.h);
    const look = FRAMES.find((f) => f.kind === 'hoop')!;
    const { cloth } = openingOf(hoop.frame, look, true);
    const p = pictureIn(cloth, 40, 30, true);
    const r = cloth.w / 2;
    const cx = cloth.x + r;
    const cy = cloth.y + r;
    for (const [x, y] of [[p.x, p.y], [p.x + p.w, p.y], [p.x, p.y + p.h], [p.x + p.w, p.y + p.h]]) {
      expect(Math.hypot(x - cx, y - cy)).toBeLessThanOrEqual(r);
    }
  });

  test('рама со скосом: паспарту и ткань внутри рамы, узор внутри ткани', () => {
    const h = hangWalls([item(0, 70, 40)], 400, 688)[0].items[0];
    for (const look of FRAMES.filter((f) => f.kind !== 'hoop')) {
      for (const mat of [true, false]) {
        const o = openingOf(h.frame, look, mat);
        expect(inside(o.mat, h.frame)).toBe(true);
        expect(inside(o.cloth, o.mat)).toBe(true);
        expect(inside(pictureIn(o.cloth, 70, 40, false), o.cloth)).toBe(true);
      }
    }
  });
});

describe('«Светлица»: рамы работ', () => {
  test('без купленных — у всех бесплатная тёмная', () => {
    expect(new Set(MIX.map((m) => frameFor(m.id, []).id))).toEqual(new Set(['walnut']));
    expect(new Set(MIX.map((m) => frameFor(m.id, ['walnut']).id))).toEqual(new Set(['walnut']));
  });

  test('только свои рамы, вперемешку, у работы всегда одна и та же', () => {
    const mine = ['walnut', 'baguette', 'hoop'] as const;
    const got = MIX.map((m) => frameFor(m.id, mine).id);
    expect(got.every((id) => (mine as readonly string[]).includes(id))).toBe(true);
    expect(new Set(got).size).toBe(3);
    expect(MIX.map((m) => frameFor(m.id, mine).id)).toEqual(got);
  });
});
