// Упрощение (docs/09-content.md, §4, «Упрощение»; docs/specs/2026-09-custom.md): сетка
// цветов ровнее перед палитрой — пятна однороднее, границы остаются на месте, одиночных
// клеток и мелких пятен меньше, вышивать проще. Свой детерминированный фильтр, не генератор
// изображений (ADR 0006): новых подробностей он не выдумывает, только выравнивает цвет
// внутри пятен.
//
// Фильтр Кувахары по клеткам: у каждой клетки четыре квадрата со стороной radius + 1, в
// которые она входит углом; цвет клетки — средний цвет того квадрата, где цвет ровнее всего.
// На границе двух пятен ровный квадрат лежит по одну её сторону — граница не размывается.
import { type Lab, labToLinear, linearToLab } from '../color';
import type { Grid } from './grid';
import { CLEAN, type Clean } from './palette';

/** Упрощение: 0 — нет, 1 — немного, 2 — сильно. */
export type Simplify = 0 | 1 | 2;

/**
 * Сторона квадрата — radius + 1 клеток, один проход: два прохода с радиусом 2 дают квадратные
 * пятна, которых на снимке нет (сравнение 29.09.2026 на «Зонтиках» и «Селезне»).
 */
const PASSES: Record<Simplify, { radius: number; passes: number }> = {
  0: { radius: 0, passes: 0 },
  1: { radius: 1, passes: 1 },
  2: { radius: 2, passes: 1 },
};

/**
 * Чистка после палитры (palette.ts, cleanup): с упрощением сливаются области до пяти клеток,
 * а не до двух, и по одной — шашечки, которые фильтр оставляет в листве, не меняются цветами,
 * а сливаются. Без упрощения — как было, CLEAN.
 */
export const SIMPLIFY_CLEAN: Record<Simplify, Clean> = {
  0: CLEAN,
  1: { minRegion: 6, oneByOne: true },
  2: { minRegion: 6, oneByOne: true },
};

export function simplifyGrid(g: Grid, level: Simplify): Grid {
  const { radius, passes } = PASSES[level];
  return kuwahara(g, radius, passes);
}

/** Фильтр Кувахары по клеткам: квадраты со стороной `radius` + 1, `passes` проходов. */
export function kuwahara(g: Grid, radius: number, passes: number): Grid {
  if (!passes || !radius) return g;
  const { w, h } = g;
  let lab: Lab[] = Array.from({ length: w * h }, (_, i) => linearToLab(g.rgb[i * 3], g.rgb[i * 3 + 1], g.rgb[i * 3 + 2]));
  // клетки фона (бумага схемы, канва) не трогаются и в квадраты не входят
  const skip = (i: number) => g.paper?.[i] === 1;
  for (let pass = 0; pass < passes; pass++) {
    const src = lab;
    const out: Lab[] = new Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (skip(i)) {
          out[i] = src[i];
          continue;
        }
        let best = src[i];
        let bestVar = Infinity;
        for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const x0 = Math.min(x, x + sx * radius), x1 = Math.max(x, x + sx * radius);
          const y0 = Math.min(y, y + sy * radius), y1 = Math.max(y, y + sy * radius);
          let n = 0, sl = 0, sa = 0, sb = 0, ql = 0, qa = 0, qb = 0;
          for (let yy = Math.max(0, y0); yy <= Math.min(h - 1, y1); yy++) {
            for (let xx = Math.max(0, x0); xx <= Math.min(w - 1, x1); xx++) {
              const k = yy * w + xx;
              if (skip(k)) continue;
              const [l, a, b] = src[k];
              sl += l; sa += a; sb += b;
              ql += l * l; qa += a * a; qb += b * b;
              n++;
            }
          }
          if (!n) continue;
          const v = ql / n - (sl / n) ** 2 + qa / n - (sa / n) ** 2 + qb / n - (sb / n) ** 2;
          // равная ровность — первый по порядку квадрат: результат не зависит от случая
          if (v < bestVar - 1e-12) {
            bestVar = v;
            best = [sl / n, sa / n, sb / n];
          }
        }
        out[i] = best;
      }
    }
    lab = out;
  }
  const rgb = new Float64Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    if (skip(i)) {
      rgb.set(g.rgb.subarray(i * 3, i * 3 + 3), i * 3);
      continue;
    }
    const [r, gg, b] = labToLinear(lab[i]);
    // среднее в OKLab может чуть выйти за цвета экрана — обратно в [0, 1]
    rgb[i * 3] = Math.min(1, Math.max(0, r));
    rgb[i * 3 + 1] = Math.min(1, Math.max(0, gg));
    rgb[i * 3 + 2] = Math.min(1, Math.max(0, b));
  }
  return { ...g, rgb };
}
