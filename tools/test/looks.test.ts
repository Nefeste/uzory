// Оформления (решение владельца 31.10.2026, issue 116, вариант Б; src/engine/looks.ts): рамки навсегда, тёмное
// дерево — у всех. Канва с 0.20.0 (владелец 01.11.2026: «делай канву фоном узора») — бесплатно и у каждой работы
// своя, по умолчанию — подходящая узору; у узора без невышитого фона игра выглядит, как прежде, до точки.
import { describe, expect, test } from 'bun:test';
import { CANVAS, type Pattern } from '../../src/engine/pattern';
import {
  ALL_LOOKS, CANVAS_LOST, CANVASES, canvasLook, clothRgb, FRAMES, frameLook, FREE_CANVAS, FREE_FRAME, isCanvasId, isFree, LOOK_PRODUCTS, lookOwned,
  luminance, ownedOf, productOf, shownFrame, suitedCanvas, workCanvas,
} from '../../src/engine/looks';
import { FAKE_DETAIL, FAKE_LOOK_PRICES, fakeBilling } from '../../src/state/fakeBilling';
import { renderFrame } from '../canvas/ck';

describe('каталог оформлений', () => {
  test('кремовая канва — прежние константы шейдера до точки', () => {
    const cream = canvasLook(FREE_CANVAS);
    expect(cream.cloth).toEqual([0.953, 0.941, 0.902]);
    expect(cream.hole).toEqual([0.6, 0.576, 0.518]);
    expect(cream.ghost).toEqual([0.965, 0.965, 0.949]);
    expect(frameLook(FREE_FRAME)).toMatchObject({ kind: 'bevel', light: '#8b6d52', dark: '#4e3b2b' });
  });

  test('пять канв и четыре рамки; товары — по одному на платную рамку и «Все оформления», канв среди них нет', () => {
    expect(CANVASES.map((c) => c.id)).toEqual(['cream', 'white', 'linen', 'black', 'blue']);
    expect(FRAMES.map((f) => f.id)).toEqual(['walnut', 'baguette', 'birch', 'hoop']);
    expect(LOOK_PRODUCTS).toEqual(['uzory_look_baguette', 'uzory_look_birch', 'uzory_look_hoop', ALL_LOOKS]);
    expect(new Set(LOOK_PRODUCTS).size).toBe(LOOK_PRODUCTS.length);
  });

  test('ткань кремовой канвы в превью — прежний цвет превью до точки (src/render/preview.ts)', () => {
    expect(clothRgb(canvasLook(FREE_CANVAS))).toBe(0xf3f0e6);
    expect(clothRgb(canvasLook('black'))).toBe(0x262628);
  });

  test('дырочки темнее нити канвы, невышитое издалека — светлее: у светлых и у чёрной', () => {
    for (const c of CANVASES) {
      expect(luminance(c.hole), c.id).toBeLessThan(luminance(c.cloth));
      expect(luminance(c.ghost), c.id).toBeGreaterThan(luminance(c.cloth));
    }
    expect(luminance(canvasLook('black').cloth)).toBeLessThan(0.05);
  });

  test('незнакомое оформление (будущая версия, испорченная запись) — кремовая канва и бесплатная рамка', () => {
    expect(canvasLook('velvet').id).toBe(FREE_CANVAS);
    expect(isCanvasId('velvet')).toBe(false);
    expect(isCanvasId('linen')).toBe(true);
    expect(frameLook(undefined).id).toBe(FREE_FRAME);
  });
});

describe('есть ли рамка у игрока', () => {
  test('тёмное дерево — у всех; сборка для проверки — все', () => {
    expect(lookOwned('walnut', [], false)).toBe(true);
    expect(lookOwned('hoop', [], false)).toBe(false);
    expect(lookOwned('hoop', [], true)).toBe(true);
    expect(isFree('walnut')).toBe(true);
    expect(isFree('hoop')).toBe(false);
  });

  test('купленная отдельно — только она; «Все оформления» — все рамки', () => {
    expect(lookOwned('hoop', [productOf('hoop')], false)).toBe(true);
    expect(lookOwned('birch', [productOf('hoop')], false)).toBe(false);
    for (const f of FRAMES) expect(lookOwned(f.id, [ALL_LOOKS], false)).toBe(true);
  });

  test('показывается выбранная, если она есть; иначе бесплатная — и после возврата денег', () => {
    expect(shownFrame('hoop', [productOf('hoop')], false).id).toBe('hoop');
    expect(shownFrame('hoop', [productOf('birch')], false).id).toBe('walnut');
    expect(shownFrame('hoop', [], false).id).toBe('walnut');
    expect(shownFrame('hoop', [], true).id).toBe('hoop');
    expect(shownFrame('velvet', [ALL_LOOKS], false).id).toBe('walnut');
  });
});

describe('канва — фон узора (0.20.0)', () => {
  /** Узор `w` × `h` из строк: «.» — невышитый фон, буква — нить из `legend`. */
  const draw = (rows: string[], legend: Record<string, number>): Pattern => {
    const keys = Object.keys(legend);
    const cells = Uint8Array.from(rows.join('').split(''), (ch) => (ch === '.' ? CANVAS : keys.indexOf(ch)));
    return { key: 'canvas-test@1', w: rows[0].length, h: rows.length, threads: keys.map((k) => ({ rgb: legend[k], name: k })), cells } as Pattern;
  };
  const ring = (inner: string, edge: string) => [
    '........', `..${edge.repeat(4)}..`, `.${edge}${inner.repeat(4)}${edge}.`, `.${edge}${inner.repeat(4)}${edge}.`, `..${edge.repeat(4)}..`, '........',
  ];

  test('узор без невышитых клеток — на кремовой, как было', () => {
    expect(suitedCanvas(draw(['kk', 'kk'], { k: 0xb3162f }))).toBe('cream');
  });

  test('кумач, мёд и ель по краю фона — кремовая', () => {
    expect(suitedCanvas(draw(ring('l', 'k'), { k: 0xb3162f, l: 0xd9a441 }))).toBe('cream');
    expect(suitedCanvas(draw(ring('k', 'e'), { k: 0xb3162f, e: 0x1f3c34 }))).toBe('cream');
  });

  test('бежевый край — белая: на кремовой бежевое теряется', () => {
    // лисичка «Детям»: бежевое — заметная часть края
    expect(suitedCanvas(draw(ring('r', 'b'), { r: 0xc8642a, b: 0xe2d2b4 }))).toBe('white');
  });

  test('немного светлого у края — кремовая остаётся: кайма бумаги старинной схемы', () => {
    // край — 20 касаний с фоном, у бледной клетки из них 2: десятая часть — меньше CANVAS_LOST
    const rows = ['........', '..gggg..', '.gkkkkg.', '.gkkkkm.', '..gggg..', '........'];
    expect(2 / 20).toBeLessThan(CANVAS_LOST);
    expect(suitedCanvas(draw(rows, { g: 0x4f7a3a, k: 0xb3162f, m: 0xdfdad2 }))).toBe('cream');
  });

  test('белый край — на светлой канве, где он виден; чёрную сама игра не выбирает', () => {
    // белая кошка «Своего узора» с фоном «не вышивать»: край — белый мех с серыми тенями
    expect(suitedCanvas(draw(ring('g', 'w'), { g: 0x9a9a9a, w: 0xfbfbf8 }))).toBe('linen');
    // бледный край, теряется на любой светлой канве: светлая всё равно, а не чёрная, на которой он виден
    const pale = draw(['..........', '..wwwddd..', '.mkkkkkkm.', '.mkkkkkkm.', '..wwwddd..', '..........'],
      { w: 0xfbfbf8, d: 0xd8cbb0, m: 0xdfdad2, k: 0xb3162f });
    const c = suitedCanvas(pale);
    expect(c).not.toBe('black');
    expect(luminance(canvasLook(c).cloth)).toBeGreaterThan(0.3);
  });

  test('канва работы — записанная у неё; нет или незнакомая — подходящая узору', () => {
    const fox = draw(ring('r', 'b'), { r: 0xc8642a, b: 0xe2d2b4 });
    expect(workCanvas('blue', fox).id).toBe('blue');
    expect(workCanvas(undefined, fox).id).toBe('white');
    expect(workCanvas('velvet', fox).id).toBe('white');
  });
});

describe('канва в шейдере', () => {
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

  test('клетка канвы издалека — ровно цвет канвы работы; за краем узора — темнее, в пяльцах — та же ткань', async () => {
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

describe('покупка навсегда (0.18.1)', () => {
  test('купленное из хранилища и от магазина — только наши товары, без повторов, в порядке каталога', () => {
    expect(ownedOf([ALL_LOOKS, 'uzory_look_hoop', 'uzory_look_hoop', 'coins_100', 7])).toEqual(['uzory_look_hoop', ALL_LOOKS]);
    expect(ownedOf('uzory_look_hoop')).toEqual([]);
    expect(ownedOf(null)).toEqual([]);
  });

  test('канвы — больше не товары: прежняя покупка канвы из сборки для проверки забывается', () => {
    expect(ownedOf(['uzory_look_black', 'uzory_look_white', ALL_LOOKS])).toEqual([ALL_LOOKS]);
  });

  /** заглушка сценария с записью в памяти — как ./billing.web.ts с хранилищем браузера */
  const stub = (mode: string) => {
    let raw: string | null = JSON.stringify({ mode });
    return { b: fakeBilling(() => raw, (r) => { raw = r; }, () => 0), set: (m: string) => { raw = JSON.stringify({ ...JSON.parse(raw ?? '{}'), mode: m }); } };
  };

  test('заглушка: цены — не 99 и 299 ₽ из описания; купленное остаётся и после «перезагрузки»', async () => {
    const { b } = stub('ok');
    expect(await b.lookPrices()).toEqual(FAKE_LOOK_PRICES);
    expect(FAKE_LOOK_PRICES.map((p) => p.price)).not.toContain('99 ₽');
    expect(await b.looks()).toEqual([]);
    expect(await b.buyLook(productOf('baguette'))).toEqual({ ok: true, owned: [productOf('baguette')] });
    expect(await b.buyLook(ALL_LOOKS)).toEqual({ ok: true, owned: [productOf('baguette'), ALL_LOOKS] });
    expect(await b.looks()).toEqual([productOf('baguette'), ALL_LOOKS]);
  });

  test('заглушка: отказ, сбой с ответом RuStore, нет сети и нет RuStore — так магазин и отвечает', async () => {
    const { b, set } = stub('cancelled');
    expect(await b.buyLook(productOf('hoop'))).toEqual({ ok: false, fail: 'cancelled' });
    set('failed');
    expect(await b.buyLook(productOf('hoop'))).toEqual({ ok: false, fail: 'failed', detail: FAKE_DETAIL });
    set('offline');
    expect(await b.buyLook(productOf('hoop'))).toEqual({ ok: false, fail: 'offline' });
    expect(await b.lookPrices()).toBeNull();
    expect(await b.looks()).toBeNull();
    set('no-store');
    expect(await b.buyLook(productOf('hoop'))).toEqual({ ok: false, fail: 'no-store' });
  });
});
