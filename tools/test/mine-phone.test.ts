// «Свой узор» на телефоне (решение владельца 31.10.2026, issue 118, вариант В; docs/specs/2026-09-custom.md):
// первый свой узор — бесплатно, дальше новые — по «Узорам+»; день первого — в записи игрока; рамка кадра —
// сдвиг, колёсико и щипок двумя пальцами (src/engine/build/crop.ts).
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CROP_MIN, dragFrame, gripAt, insideOval, mainHandle, pinchCrop, scaleRect, shiftCrop, zoomCrop } from '../../src/engine/build/crop';
import type { Crop } from '../../src/engine/build/mine';
import { normalizePlayer } from '../../src/engine/player';
import { mineAccess } from '../../src/engine/plus';

describe('доступ к новому своему узору', () => {
  test('сборка не запирает (0.x для проверки) — открыто, и бесплатный не тратится', () => {
    expect(mineAccess({ gate: false, plus: false, freeUsed: false })).toBe('open');
    expect(mineAccess({ gate: false, plus: false, freeUsed: true })).toBe('open');
  });

  test('без подписки: первый — бесплатно, следующий — заперт', () => {
    expect(mineAccess({ gate: true, plus: false, freeUsed: false })).toBe('free');
    expect(mineAccess({ gate: true, plus: false, freeUsed: true })).toBe('locked');
  });

  test('с подпиской — открыто, был бесплатный или нет', () => {
    expect(mineAccess({ gate: true, plus: true, freeUsed: false })).toBe('open');
    expect(mineAccess({ gate: true, plus: true, freeUsed: true })).toBe('open');
  });

  test('день первого своего узора хранится у игрока; испорченный — отбрасывается', () => {
    expect(normalizePlayer({ installed: '2026-10-01', mineFreeUsed: '2026-10-31' }, '2026-10-31').mineFreeUsed).toBe('2026-10-31');
    expect('mineFreeUsed' in normalizePlayer({ installed: '2026-10-01', mineFreeUsed: 'да' }, '2026-10-31')).toBe(false);
    expect('mineFreeUsed' in normalizePlayer(null, '2026-10-31')).toBe(false);
  });
});

describe('рамка кадра', () => {
  const near = (a: Crop, b: Crop) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9));
  const mid = ([l, t, r, b]: Crop) => [(l + r) / 2, (t + b) / 2];

  test('щипок: развели вдвое — рамка вдвое меньше, середина на месте', () => {
    const c: Crop = [0.2, 0.2, 0.8, 0.6];
    const z = pinchCrop(c, 100, 200);
    near(z, [0.35, 0.3, 0.65, 0.5]);
    const [mx, my] = mid(z);
    const [cx, cy] = mid(c);
    expect(mx).toBeCloseTo(cx, 9);
    expect(my).toBeCloseTo(cy, 9);
  });

  test('щипок: свели — рамка больше, но не больше снимка и не за его краем', () => {
    const z = pinchCrop([0.6, 0.6, 0.9, 0.9], 200, 50);
    near(z, [0, 0, 1, 1]);
    const edge = pinchCrop([0.7, 0.1, 0.9, 0.3], 100, 50);
    expect(edge[2]).toBeLessThanOrEqual(1);
    expect(edge[0]).toBeGreaterThanOrEqual(0);
    expect(edge[2] - edge[0]).toBeCloseTo(0.4, 9);
  });

  test('щипок: рамка не уже CROP_MIN; пальцы без расстояния — рамка как была', () => {
    const z = pinchCrop([0.4, 0.4, 0.5, 0.5], 10, 1000);
    expect(z[2] - z[0]).toBeCloseTo(CROP_MIN, 9);
    expect(z[3] - z[1]).toBeCloseTo(CROP_MIN, 9);
    near(pinchCrop([0.4, 0.4, 0.5, 0.5], 0, 100), [0.4, 0.4, 0.5, 0.5]);
  });

  test('колёсико: точка под курсором на месте; сдвиг не выпускает рамку за снимок', () => {
    const z = zoomCrop([0, 0, 1, 1], 0.25, 0.5, 0.5);
    near(z, [0.125, 0.25, 0.625, 0.75]);
    near(shiftCrop([0.5, 0.5, 0.9, 0.9], 0.3, -0.7), [0.6, 0, 1, 0.4]);
  });
});

describe('экран кадра (0.19.0): что берёт палец и куда двигается рамка', () => {
  // на 0.18.x рамка стояла в прокрутке экрана, и на Android палец у угла и два пальца ей так и не дались
  // (владелец 01.11.2026); теперь кадр — свой экран без прокрутки, жесты — react-native-gesture-handler,
  // как у канвы, а решения — чистые функции src/engine/build/crop.ts
  const crop: Crop = [0.1, 0.1, 0.9, 0.9];
  const main: Crop = [0.3, 0.2, 0.7, 0.8];
  const [dw, dh] = [400, 300];

  test('уголок рамки, уголок овала, овал, рамка — по месту касания; уголок ловит палец вокруг', () => {
    expect(gripAt(0.9 * dw - 20, 0.9 * dh - 20, crop, null, dw, dh, 34)).toEqual({ target: 'crop', mode: 'resize' });
    expect(gripAt(0.5 * dw, 0.5 * dh, crop, null, dw, dh, 34)).toEqual({ target: 'crop', mode: 'move' });
    // овал: внутри — овал, мимо него в рамке — рамка; его уголок — на краю под 45°
    expect(gripAt(0.5 * dw, 0.5 * dh, crop, main, dw, dh, 34)).toEqual({ target: 'main', mode: 'move' });
    expect(gripAt(0.2 * dw, 0.5 * dh, crop, main, dw, dh, 34)).toEqual({ target: 'crop', mode: 'move' });
    const [hx, hy] = mainHandle(main);
    expect(gripAt(hx * dw + 10, hy * dh - 10, crop, main, dw, dh, 34)).toEqual({ target: 'main', mode: 'resize' });
    expect(insideOval(0.5, 0.5, main)).toBe(true);
    expect(insideOval(0.31, 0.21, main)).toBe(false);
  });

  test('палец двигает рамку, не выпуская за снимок; угол — не уже CROP_MIN и не длиннее 5 : 1', () => {
    expect(dragFrame(crop, 'move', 0.05, -0.02, 400, 300).map((x) => +x.toFixed(6))).toEqual([0.15, 0.08, 0.95, 0.88]);
    expect(dragFrame(crop, 'move', 0.5, 0.5, 400, 300).map((x) => +x.toFixed(6))).toEqual([0.2, 0.2, 1, 1]);
    // угол: уже — сжимается, не меньше CROP_MIN; вытянуть больше 5 : 1 нельзя
    expect(dragFrame(crop, 'resize', -0.3, -0.3, 400, 300).map((x) => +x.toFixed(6))).toEqual([0.1, 0.1, 0.6, 0.6]);
    const thin = dragFrame(crop, 'resize', -2, 0, 400, 300);
    expect(thin[2] - thin[0]).toBeCloseTo(CROP_MIN, 9);
    const long = dragFrame([0.1, 0.1, 0.2, 0.2], 'resize', 0.8, 0, 400, 300);
    expect(((long[2] - long[0]) * 400) / ((long[3] - long[1]) * 300)).toBeCloseTo(5, 6);
  });

  test('два пальца на овале — овал больше и меньше вокруг своей середины, не за снимок', () => {
    const big = scaleRect(main, 1.5);
    expect((big[0] + big[2]) / 2).toBeCloseTo(0.5, 9);
    expect(big[2] - big[0]).toBeCloseTo(0.6, 9);
    expect(scaleRect(main, 10)).toEqual([0, 0, 1, 1]);
    expect(scaleRect(main, 0)).toEqual(main);
  });

  test('экран кадра — без прокрутки, жесты — как у канвы: один палец и щипок', () => {
    const src = readFileSync(join(import.meta.dir, '../../src/ui/FrameEditor.tsx'), 'utf8');
    expect(src).toContain("from 'react-native-gesture-handler'");
    expect(src).toContain('Gesture.Pan()');
    expect(src).toContain('Gesture.Pinch()');
    expect(src).toContain('Gesture.Simultaneous(pan, pinch)');
    expect(src).not.toContain('ScrollView');
  });
});
