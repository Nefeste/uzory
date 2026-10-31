// Оформления (решение владельца 31.10.2026, issue 116, вариант Б; src/engine/looks.ts): канвы и рамки навсегда,
// кремовая канва и тёмное дерево — у всех; без покупки игра выглядит, как до оформлений, до точки.
import { describe, expect, test } from 'bun:test';
import { CANVAS, type Pattern } from '../../src/engine/pattern';
import {
  ALL_LOOKS, CANVASES, canvasLook, FRAMES, frameLook, FREE_CANVAS, FREE_FRAME, isFree, LOOK_PRODUCTS, lookOwned, luminance, productOf,
  shownLooks,
} from '../../src/engine/looks';
import { renderFrame } from '../canvas/ck';

describe('каталог оформлений', () => {
  test('кремовая канва — прежние константы шейдера до точки', () => {
    const cream = canvasLook(FREE_CANVAS);
    expect(cream.cloth).toEqual([0.953, 0.941, 0.902]);
    expect(cream.hole).toEqual([0.6, 0.576, 0.518]);
    expect(cream.ghost).toEqual([0.965, 0.965, 0.949]);
    expect(frameLook(FREE_FRAME)).toMatchObject({ kind: 'bevel', light: '#8b6d52', dark: '#4e3b2b' });
  });

  test('пять канв и четыре рамки; товары — по одному на платное оформление и «Все оформления»', () => {
    expect(CANVASES.map((c) => c.id)).toEqual(['cream', 'white', 'linen', 'black', 'blue']);
    expect(FRAMES.map((f) => f.id)).toEqual(['walnut', 'baguette', 'birch', 'hoop']);
    expect(LOOK_PRODUCTS).toEqual([
      'uzory_look_white', 'uzory_look_linen', 'uzory_look_black', 'uzory_look_blue',
      'uzory_look_baguette', 'uzory_look_birch', 'uzory_look_hoop', ALL_LOOKS,
    ]);
    expect(new Set(LOOK_PRODUCTS).size).toBe(LOOK_PRODUCTS.length);
  });

  test('дырочки темнее нити канвы, невышитое издалека — светлее: у светлых и у чёрной', () => {
    for (const c of CANVASES) {
      expect(luminance(c.hole), c.id).toBeLessThan(luminance(c.cloth));
      expect(luminance(c.ghost), c.id).toBeGreaterThan(luminance(c.cloth));
    }
    expect(luminance(canvasLook('black').cloth)).toBeLessThan(0.05);
  });

  test('незнакомое оформление (будущая версия, испорченная настройка) — бесплатное', () => {
    expect(canvasLook('velvet').id).toBe(FREE_CANVAS);
    expect(frameLook(undefined).id).toBe(FREE_FRAME);
  });
});

describe('есть ли оформление у игрока', () => {
  test('бесплатные — у всех; сборка для проверки — все', () => {
    expect(lookOwned('cream', [], false)).toBe(true);
    expect(lookOwned('walnut', [], false)).toBe(true);
    expect(lookOwned('black', [], false)).toBe(false);
    expect(lookOwned('black', [], true)).toBe(true);
    expect(isFree('hoop')).toBe(false);
  });

  test('купленное отдельно — только оно; «Все оформления» — все', () => {
    expect(lookOwned('black', [productOf('black')], false)).toBe(true);
    expect(lookOwned('blue', [productOf('black')], false)).toBe(false);
    for (const id of [...CANVASES.map((c) => c.id), ...FRAMES.map((f) => f.id)]) expect(lookOwned(id, [ALL_LOOKS], false)).toBe(true);
  });

  test('показывается выбранное, если оно есть; иначе бесплатное — и после возврата денег', () => {
    expect(shownLooks({ canvas: 'black', frame: 'hoop' }, [productOf('black')], false)).toMatchObject({ canvas: { id: 'black' }, frame: { id: 'walnut' } });
    expect(shownLooks({ canvas: 'black', frame: 'hoop' }, [], false)).toMatchObject({ canvas: { id: 'cream' }, frame: { id: 'walnut' } });
    expect(shownLooks({ canvas: 'black', frame: 'hoop' }, [], true)).toMatchObject({ canvas: { id: 'black' }, frame: { id: 'hoop' } });
  });
});

describe('канва оформления в шейдере', () => {
  // 4 × 3: клетки канвы по краям, две нити посередине
  const p: Pattern = {
    key: 'looks-test@1', w: 4, h: 3, threads: [{ rgb: 0xc8102e, name: 'красная' }, { rgb: 0x2e4a1e, name: 'зелёная' }],
    cells: Uint8Array.from([CANVAS, CANVAS, CANVAS, CANVAS, CANVAS, 0, 1, CANVAS, CANVAS, CANVAS, CANVAS, CANVAS]),
  } as Pattern;
  const stitched = Uint8Array.from([0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0]);
  const s = 8;
  const at = (f: { pixels: Uint8Array }, width: number, x: number, y: number) => {
    const o = (y * width + x) * 4;
    return [f.pixels[o], f.pixels[o + 1], f.pixels[o + 2]];
  };

  test('клетка канвы издалека — ровно цвет канвы оформления; за краем узора — темнее, в пяльцах — та же ткань', async () => {
    const width = (p.w + 2) * s;
    const height = (p.h + 2) * s;
    for (const c of CANVASES) {
      const want = c.cloth.map((v) => Math.round(v * 255));
      const f = await renderFrame(p, stitched, { width, height, tx: s, ty: s, s, near: false, canvas: c });
      at(f, width, s + 4, s + 4).forEach((v, k) => expect(Math.abs(v - want[k]), c.id).toBeLessThanOrEqual(1));
      const beyond = at(f, width, 2, 2);
      beyond.forEach((v, k) => expect(v, c.id).toBeLessThanOrEqual(want[k]));
      const even = await renderFrame(p, stitched, { width, height, tx: s, ty: s, s, near: false, canvas: c, even: true });
      at(even, width, 2, 2).forEach((v, k) => expect(Math.abs(v - want[k]), `${c.id}, пяльцы`).toBeLessThanOrEqual(1));
    }
  }, 60_000);
});
