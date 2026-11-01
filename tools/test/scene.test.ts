// Сцена готовой работы (0.21.0; src/engine/scene.ts, src/engine/share.ts): рама или пяльцы, паспарту, ткань,
// гвоздь — вложены друг в друга, в сцене и с полем; без паспарту ткань — сразу за рамой; резная рама шире;
// работа на стене висит ниже — над рамой гвоздь.
import { describe, expect, test } from 'bun:test';
import { MARGIN_DP, MAX_DP } from '../../src/canvas/camera';
import { type Rect, STAGE, stageLayout, twinePoints } from '../../src/engine/scene';
import { shareLayout } from '../../src/engine/share';

const inside = (a: Rect, b: Rect) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
const spec = { w: 40, h: 30, hoop: false, mat: true, hang: false, carved: false };

describe('сцена «Готово»', () => {
  test('рама ⊃ паспарту ⊃ ткань, в сцене и с полем; между ними — толщина рамы и паспарту', () => {
    const L = stageLayout(spec, 400, 500, MAX_DP, MARGIN_DP);
    expect(inside(L.cloth, L.mat)).toBe(true);
    expect(inside(L.mat, L.frame)).toBe(true);
    expect(inside(L.frame, { x: 0, y: 0, w: 400, h: 500 })).toBe(true);
    expect(L.mat.x - L.frame.x).toBe(STAGE.frame);
    expect(L.cloth.x - L.mat.x).toBe(STAGE.mat);
    // ткань — узор с полем канвы вокруг
    expect(L.cloth.w).toBe(Math.floor(spec.w * L.s + 2 * MARGIN_DP));
    expect(L.frame.w).toBeLessThanOrEqual(400 * STAGE.fill + 1);
    expect(L.nail).toBeUndefined();
  });

  test('без паспарту ткань — сразу за рамой; резная рама шире', () => {
    const bare = stageLayout({ ...spec, mat: false }, 400, 500, MAX_DP, MARGIN_DP);
    expect(bare.mat).toEqual(bare.cloth);
    const carved = stageLayout({ ...spec, carved: true }, 400, 500, MAX_DP, MARGIN_DP);
    expect(carved.mat.x - carved.frame.x).toBe(STAGE.carved);
    expect(STAGE.carved).toBeGreaterThan(STAGE.frame);
  });

  test('на стене: работа ниже, гвоздь над рамой посередине, бечёвка — к верхней грани', () => {
    const plain = stageLayout(spec, 400, 500, MAX_DP, MARGIN_DP);
    const hung = stageLayout({ ...spec, hang: true }, 400, 500, MAX_DP, MARGIN_DP);
    expect(hung.nail).toBeDefined();
    expect(hung.nail!.y).toBeLessThan(hung.frame.y);
    expect(hung.nail!.y).toBeGreaterThan(0);
    expect(hung.nail!.x).toBeCloseTo(hung.frame.x + hung.frame.w / 2, 6);
    expect(hung.frame.y + hung.frame.h / 2).toBeGreaterThan(plain.frame.y + plain.frame.h / 2);
    const [a, b] = twinePoints(hung.frame);
    expect(a.y).toBeCloseTo(hung.frame.y + 2, 6);
    expect(a.x).toBeLessThan(hung.nail!.x);
    expect(b.x).toBeGreaterThan(hung.nail!.x);
  });

  test('пяльцы: круг ткани в ободе, узор целиком внутри круга', () => {
    const L = stageLayout({ ...spec, hoop: true, mat: true }, 400, 500, MAX_DP, MARGIN_DP);
    expect(L.cloth.w).toBe(L.cloth.h);
    expect(L.mat).toEqual(L.cloth);
    expect(L.cloth.x - L.frame.x).toBe(STAGE.hoop);
    // диагональ узора с полями — не больше круга ткани
    expect(Math.hypot(spec.w, spec.h) * L.s + 2 * MARGIN_DP).toBeLessThanOrEqual(L.cloth.w + 1e-9);
  });
});

describe('«Поделиться» с 0.21.0', () => {
  test('с паспарту — раскладка как до 0.21.0; без него — поле ткани уже; резная рама шире', () => {
    // работа 640 × 512 — не больше SHARE_BASE: толщины — как до 0.21.0, без роста
    const before = shareLayout(10, 8);
    expect(shareLayout(10, 8, false, { mat: true })).toEqual(before);
    expect(before.mat.x - before.frame.x).toBe(18);
    expect(before.work.x - before.mat.x).toBe(44);
    const bare = shareLayout(10, 8, false, { mat: false });
    expect(bare.work.x - bare.mat.x).toBeLessThan(before.work.x - before.mat.x);
    expect(bare.width).toBeLessThan(before.width);
    const carved = shareLayout(10, 8, false, { carved: true });
    expect(carved.mat.x - carved.frame.x).toBeGreaterThan(before.mat.x - before.frame.x);
    // большая работа: рама толще, но вся картинка — в пределе
    const big = shareLayout(40, 30);
    expect(big.mat.x - big.frame.x).toBeGreaterThan(18);
    expect(Math.max(big.width, big.height)).toBeLessThanOrEqual(2000);
    // пяльцы — как были
    expect(shareLayout(10, 8, true, { mat: false, carved: true })).toEqual(shareLayout(10, 8, true));
  });
});
