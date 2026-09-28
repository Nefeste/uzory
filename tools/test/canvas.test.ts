// Кисть и камера (docs/06-testing.md, «Канва»): обход сетки против перебора, пределы камеры.
import { describe, expect, test } from 'bun:test';
import { clampScale, clampX, fitScale, MAX_DP, NUMBERS_DP, openCamera, wheelFactor, zoomAround } from '../../src/canvas/camera';
import { traverse } from '../../src/canvas/traverse';
import { rng } from '../../src/engine/seed';

/** Пересекает ли отрезок клетку (открытый квадрат) — точная проверка отсечением. */
function hits(x0: number, y0: number, x1: number, y1: number, cx: number, cy: number): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const clip = (p: number, q: number) => {
    if (p === 0) return q > 0;
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };
  return clip(-dx, x0 - cx) && clip(dx, cx + 1 - x0) && clip(-dy, y0 - cy) && clip(dy, cy + 1 - y0) && t0 <= t1;
}

describe('кисть: обход сетки', () => {
  test('проходит все клетки, которые пересекает отрезок, и только их', () => {
    const r = rng(5);
    const w = 40;
    const h = 30;
    for (let k = 0; k < 3000; k++) {
      const x0 = r() * 44 - 2;
      const y0 = r() * 34 - 2;
      const len = k % 3 === 0 ? r() * 2 : r() * 25;
      const a = r() * Math.PI * 2;
      const x1 = x0 + Math.cos(a) * len;
      const y1 = y0 + Math.sin(a) * len;
      const got: number[] = [];
      traverse(x0, y0, x1, y1, w, h, got);
      const want = new Set<number>();
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (hits(x0, y0, x1, y1, x, y)) want.add(y * w + x);
      expect(new Set(got)).toEqual(want);
      expect(new Set(got).size).toBe(got.length);
    }
  });

  test('клетки — в порядке движения пальца', () => {
    const out: number[] = [];
    traverse(0.5, 0.5, 5.5, 0.5, 10, 10, out);
    expect(out).toEqual([0, 1, 2, 3, 4, 5]);
    const back: number[] = [];
    traverse(5.5, 0.5, 0.5, 0.5, 10, 10, back);
    expect(back).toEqual([5, 4, 3, 2, 1, 0]);
  });

  test('касание без движения — одна клетка; за краем узора — ничего', () => {
    const out: number[] = [];
    traverse(3.2, 4.7, 3.2, 4.7, 10, 10, out);
    expect(out).toEqual([43]);
    const none: number[] = [];
    traverse(-3, -3, -1, -2, 10, 10, none);
    expect(none).toEqual([]);
  });
});

describe('камера', () => {
  test('масштаб не выходит за пределы', () => {
    const fit = fitScale(120, 120, 400, 700);
    expect(clampScale(0.1, 120, 120, 400, 700)).toBe(fit);
    expect(clampScale(1000, 120, 120, 400, 700)).toBe(MAX_DP);
  });

  test('канву нельзя увести за край дальше половины экрана', () => {
    expect(clampX(10000, 30, 120, 400)).toBe(200);
    expect(clampX(-10000, 30, 120, 400)).toBe(200 - 120 * 30);
  });

  test('малая картинка открывается целиком, большая — в рабочем масштабе', () => {
    const small = openCamera(17, 17, 400, 700, false);
    expect(small.s).toBeGreaterThanOrEqual(NUMBERS_DP);
    expect(small.tx).toBeCloseTo((400 - 17 * small.s) / 2);
    expect(openCamera(120, 120, 400, 700, false).s).toBe(28);
    expect(openCamera(120, 120, 400, 700, true).s).toBe(36);
  });

  test('масштаб вокруг точки: клетка под курсором остаётся под ним', () => {
    const c = { s: 20, tx: -300, ty: -500 };
    const z = zoomAround(c, 130, 240, 1.5, 120, 120, 400, 700);
    expect(z.s).toBe(30);
    expect((130 - z.tx) / z.s).toBeCloseTo((130 - c.tx) / c.s);
    expect((240 - z.ty) / z.s).toBeCloseTo((240 - c.ty) / c.s);
    // дальше «всего узора» и ближе предела — нельзя
    expect(zoomAround(c, 0, 0, 0.001, 120, 120, 400, 700).s).toBe(fitScale(120, 120, 400, 700));
    expect(zoomAround(c, 0, 0, 1000, 120, 120, 400, 700).s).toBe(MAX_DP);
  });

  test('колёсико: щелчок — в 1,22 раза, обратно — столько же; строки и страницы — в точках', () => {
    expect(wheelFactor(-100, 0, false, 700)).toBeCloseTo(1.2214, 3);
    expect(wheelFactor(-100, 0, false, 700) * wheelFactor(100, 0, false, 700)).toBeCloseTo(1);
    expect(wheelFactor(-3, 1, false, 700)).toBeCloseTo(wheelFactor(-48, 0, false, 700));
    expect(wheelFactor(1, 2, false, 700)).toBeCloseTo(wheelFactor(700, 0, false, 700));
    // щипок на тачпаде: мелкие шаги с Ctrl
    expect(wheelFactor(-10, 0, true, 700)).toBeCloseTo(Math.exp(0.1));
  });
});
