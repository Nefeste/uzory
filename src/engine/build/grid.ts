// Исходник → сетка цветов (docs/specs/2026-09-content-pipeline.md, шаги 2–4): кадр и
// уменьшение по площади в линейном свете — своим кодом: библиотеки часто усредняют без
// перевода в линейный свет и темнят. Общая для сборки картинок (tools/content) и своего
// узора в приложении (docs/specs/2026-09-custom.md): одна сетка — один узор до байта.
import { linear } from '../color';

export interface Raster {
  width: number;
  height: number;
  /** RGB, 3 байта на точку */
  data: Uint8Array;
}

export interface Grid {
  w: number;
  h: number;
  /** линейный свет, 3 числа на клетку */
  rgb: Float64Array;
  /** клетки фона, найденные заранее (бумага старинной схемы, chart.ts): их не вышивают */
  paper?: Uint8Array;
}

/** Веса точек для отрезка [a, b) в точках исходника: какие точки и какой долей входят. */
function spans(a: number, b: number): { i: number; w: number }[] {
  const out: { i: number; w: number }[] = [];
  for (let i = Math.floor(a); i < Math.ceil(b); i++) {
    const w = Math.min(b, i + 1) - Math.max(a, i);
    if (w > 1e-9) out.push({ i, w });
  }
  return out;
}

/**
 * Кадр `crop` (доли: слева, сверху, справа, снизу) → сетка: длинная сторона `size` клеток,
 * другая — по пропорции; цвет клетки — среднее по её площади в линейном свете.
 */
export function toGrid(r: Raster, crop: [number, number, number, number], size: number): Grid {
  const [l, t, rr, b] = crop;
  const x0 = l * r.width;
  const y0 = t * r.height;
  const cw = (rr - l) * r.width;
  const ch = (b - t) * r.height;
  if (cw <= 0 || ch <= 0) throw new Error(`пустой кадр ${crop.join(', ')}`);
  const w = cw >= ch ? size : Math.max(1, Math.round((size * cw) / ch));
  const h = cw >= ch ? Math.max(1, Math.round((size * ch) / cw)) : size;
  const cols = Array.from({ length: w }, (_, x) => spans(x0 + (x * cw) / w, x0 + ((x + 1) * cw) / w));
  const rows = Array.from({ length: h }, (_, y) => spans(y0 + (y * ch) / h, y0 + ((y + 1) * ch) / h));
  const rgb = new Float64Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sr = 0, sg = 0, sb = 0, sw = 0;
      for (const ry of rows[y]) {
        const row = ry.i * r.width;
        for (const cx of cols[x]) {
          const k = ry.w * cx.w;
          const o = (row + cx.i) * 3;
          sr += linear(r.data[o]) * k;
          sg += linear(r.data[o + 1]) * k;
          sb += linear(r.data[o + 2]) * k;
          sw += k;
        }
      }
      const o = (y * w + x) * 3;
      rgb[o] = sr / sw;
      rgb[o + 1] = sg / sw;
      rgb[o + 2] = sb / sw;
    }
  }
  return { w, h, rgb };
}
