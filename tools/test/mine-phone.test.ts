// «Свой узор» на телефоне (решение владельца 31.10.2026, issue 118, вариант В; docs/specs/2026-09-custom.md):
// первый свой узор — бесплатно, дальше новые — по «Узорам+»; день первого — в записи игрока; рамка кадра —
// сдвиг, колёсико и щипок двумя пальцами (src/engine/build/crop.ts).
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CROP_MIN, pinchCrop, shiftCrop, zoomCrop } from '../../src/engine/build/crop';
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

describe('рамка кадра на телефоне (0.18.2)', () => {
  // на Android прокрутка экрана забирала палец, едва он сдвигался: обработчик захвата не отвечал true
  // (blockNativeResponder системы касаний React Native), и рамка стояла, а экран ехал — 0.18.1 у владельца
  const src = readFileSync(join(import.meta.dir, '../../src/ui/CropBox.tsx'), 'utf8');

  test('захват касания отвечает true — прокрутка экрана палец не забирает', () => {
    const grant = src.slice(src.indexOf('const grant = '), src.indexOf('\n  };', src.indexOf('const grant = ')));
    expect(grant).toContain('return true;');
    // три обработчика: снимок (два пальца мимо рамки), рамка и угол — все через grant
    expect(src.match(/onResponderGrant=\{\(e\) => grant\('(move|resize)', e\)\}/g)?.length).toBe(3);
  });

  test('касание отняли — рамку отпускают, и экран снова прокручивается', () => {
    expect(src.match(/onResponderTerminate=\{onRelease\}/g)?.length).toBe(3);
    expect(src.match(/onResponderRelease=\{onRelease\}/g)?.length).toBe(3);
    const release = src.slice(src.indexOf('const onRelease = '), src.indexOf('\n  };', src.indexOf('const onRelease = ')));
    expect(release).toContain('onActive?.(false)');
  });
});
