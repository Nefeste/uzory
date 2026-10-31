// Сглаживание с сохранением деталей (просьба владельца 24.10.2026: «чтобы не было лишней
// пикселизации, но картина выглядела как оригинал»; разбор отбора 0.15.9 — «недостаточно
// детализации», «всё слилось», «слились линии»). Детали губил не шум, а чистка «конфетти»
// (palette.ts, cleanup): на снимках «России в цвете» она перекрашивала треть клеток — окна, лица,
// голову верблюда — в соседнюю нить, какой бы контрастной деталь ни была. Здесь:
//   1 — упрощение по клеткам (simplify.ts, радиус 1) и чистка с охраной: мелкое пятно уходит только
//       в нить ближе guard, а контрастная деталь остаётся; guard — самый строгий, при котором узор
//       проходит проверки (одиночных до 1 %, в мелких пятнах до 3 %);
//   2 — то же, а до клеток — сдвиг среднего по цвету на самом снимке: фактура внутри пятна
//       (мазки, зерно, листва) сходится к цвету пятна, граница пятен остаётся. Ровнее, «мультяшнее»,
//       но мелкой детали меньше, чем у 1.
// Свой детерминированный фильтр, не генератор изображений (ADR 0006).
import { fromLinear, labToLinear, LINEAR, linearToLabInto } from '../color';
import type { Pattern } from '../pattern';
import type { Grid, Raster } from './grid';
import { type BuildLog, type BuildOptions, buildPattern, type Clean } from './palette';

/** Сглаживание: 0 — нет (как без поля), 1 — детали, 2 — ровнее. */
export type Smooth = 0 | 1 | 2;

/** Чистка сглаживания: области до пяти клеток, по одной (как SIMPLIFY_CLEAN), и охрана. */
export const SMOOTH_CLEAN: Clean = { minRegion: 6, oneByOne: true };

/**
 * Охрана: с какой начинать (OKLab — чуть больше порога различимости нитей «Огромной», 0,025 ×
 * 3), во сколько раз ослаблять, пока узор не пройдёт проверки, и сколько раз. Не прошёл и
 * последний — чистка без охраны, как у узоров без сглаживания.
 */
export const GUARD_START = 0.08;
export const GUARD_GROW = 1.25;
export const GUARD_TRIES = 6;

/** Точек на клетку для сдвига среднего — до шести; рабочий кадр — не больше стольких точек. */
const PX_PER_CELL = 6;
const WORK_PIXELS = 1_200_000;
/** Сдвиг среднего: окно — две клетки в каждую сторону, близкий цвет — ближе 0,08 OKLab, до 6 шагов. */
const SHIFT_RANGE = 0.08;
const SHIFT_STEPS = 6;

type Crop = [number, number, number, number];

/** Клеток по сторонам — как у toGrid (grid.ts): длинная сторона `size`. */
function cellsOf(r: Raster, crop: Crop, size: number): { w: number; h: number; cw: number; ch: number } {
  const cw = (crop[2] - crop[0]) * r.width;
  const ch = (crop[3] - crop[1]) * r.height;
  const w = cw >= ch ? size : Math.max(1, Math.round((size * cw) / ch));
  const h = cw >= ch ? Math.max(1, Math.round((size * ch) / cw)) : size;
  return { w, h, cw, ch };
}

function spans(a: number, b: number, max: number): { i: number; w: number }[] {
  const out: { i: number; w: number }[] = [];
  for (let i = Math.floor(a); i < Math.min(max, Math.ceil(b)); i++) {
    const w = Math.min(b, i + 1) - Math.max(a, i);
    if (w > 1e-9) out.push({ i, w });
  }
  return out;
}

/**
 * Кадр → W × H точек по площади в линейном свете (как toGrid): `put(i, r, g, b)` получает точку `i`
 * (построчно) в линейном свете.
 */
function areaResample(r: Raster, crop: Crop, W: number, H: number, put: (i: number, lr: number, lg: number, lb: number) => void): void {
  const x0 = crop[0] * r.width, y0 = crop[1] * r.height;
  const cw = (crop[2] - crop[0]) * r.width, ch = (crop[3] - crop[1]) * r.height;
  const cols = flat(Array.from({ length: W }, (_, x) => spans(x0 + (x * cw) / W, x0 + ((x + 1) * cw) / W, r.width)));
  const rows = flat(Array.from({ length: H }, (_, y) => spans(y0 + (y * ch) / H, y0 + ((y + 1) * ch) / H, r.height)));
  // сначала по строкам — только тех строк снимка, что попали в кадр
  const top = rows.at[0];
  const n = rows.at[rows.from[H] - 1] - top + 1;
  const line = new Float32Array(n * W * 3);
  const d = r.data;
  for (let yy = 0; yy < n; yy++) {
    const row = (top + yy) * r.width;
    for (let x = 0; x < W; x++) {
      let sr = 0, sg = 0, sb = 0, sw = 0;
      for (let k = cols.from[x]; k < cols.from[x + 1]; k++) {
        const o = (row + cols.at[k]) * 3;
        const w = cols.w[k];
        sr += LINEAR[d[o]] * w; sg += LINEAR[d[o + 1]] * w; sb += LINEAR[d[o + 2]] * w; sw += w;
      }
      const o = (yy * W + x) * 3;
      line[o] = sr / sw; line[o + 1] = sg / sw; line[o + 2] = sb / sw;
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sr = 0, sg = 0, sb = 0, sw = 0;
      for (let k = rows.from[y]; k < rows.from[y + 1]; k++) {
        const o = ((rows.at[k] - top) * W + x) * 3;
        const w = rows.w[k];
        sr += line[o] * w; sg += line[o + 1] * w; sb += line[o + 2] * w; sw += w;
      }
      put(y * W + x, sr / sw, sg / sw, sb / sw);
    }
  }
}

/**
 * Доли точек по столбцам или строкам — плоскими массивами: `from[x]…from[x + 1]` — доли `x`. Перебор
 * массивов объектов на телефоне (Hermes, без JIT) — главное время усреднения.
 */
function flat(list: { i: number; w: number }[][]): { from: Int32Array; at: Int32Array; w: Float64Array } {
  const from = new Int32Array(list.length + 1);
  for (let x = 0; x < list.length; x++) from[x + 1] = from[x] + list[x].length;
  const at = new Int32Array(from[list.length]);
  const w = new Float64Array(from[list.length]);
  list.forEach((l, x) => l.forEach((s, j) => {
    at[from[x] + j] = s.i;
    w[from[x] + j] = s.w;
  }));
  return { from, at, w };
}

/** Кадр → W × H точек по площади в линейном свете (как toGrid), в OKLab — три плоскости. */
function resample(r: Raster, crop: Crop, W: number, H: number): Float32Array[] {
  const P = [new Float32Array(W * H), new Float32Array(W * H), new Float32Array(W * H)];
  const lab = new Float64Array(3);
  areaResample(r, crop, W, H, (i, lr, lg, lb) => {
    linearToLabInto(lr, lg, lb, lab, 0);
    P[0][i] = lab[0]; P[1][i] = lab[1]; P[2][i] = lab[2];
  });
  return P;
}

/**
 * Сдвиг среднего по цвету в неподвижном окне: цвет точки шаг за шагом заменяется средним цветом
 * точек окна, близких к нему (ближе `range`), — и сходится к цвету своего пятна. Окно — через
 * `step` точек: его сторона — четыре клетки, а цвет пятна виден и по части точек.
 */
export function meanShift(P: Float32Array[], W: number, H: number, radius: number, range: number, step: number, steps = SHIFT_STEPS): void {
  const [L, A, B] = P;
  const out = [new Float32Array(W * H), new Float32Array(W * H), new Float32Array(W * H)];
  const r2 = range * range;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let l = L[i], a = A[i], b = B[i];
      for (let s = 0; s < steps; s++) {
        let sl = 0, sa = 0, sb = 0, n = 0;
        for (let yy = Math.max(0, y - radius); yy <= Math.min(H - 1, y + radius); yy += step) {
          for (let xx = Math.max(0, x - radius); xx <= Math.min(W - 1, x + radius); xx += step) {
            const j = yy * W + xx;
            const dl = L[j] - l, da = A[j] - a, db = B[j] - b;
            if (dl * dl + da * da + db * db > r2) continue;
            sl += L[j]; sa += A[j]; sb += B[j]; n++;
          }
        }
        if (!n) break;
        const nl = sl / n, na = sa / n, nb = sb / n;
        const moved = (nl - l) ** 2 + (na - a) ** 2 + (nb - b) ** 2;
        l = nl; a = na; b = nb;
        if (moved < 1e-8) break;
      }
      out[0][i] = l; out[1][i] = a; out[2][i] = b;
    }
  }
  for (let k = 0; k < 3; k++) P[k].set(out[k]);
}

/**
 * Снимок для сетки при сглаживании 2: кадр, уменьшенный до нескольких точек на клетку и
 * сглаженный сдвигом среднего. Кадр нового снимка — весь снимок, клеток по сторонам — столько
 * же, сколько у кадра исходника, и каждая клетка — ровно K × K его точек. При 0 и 1 — снимок и
 * кадр как есть.
 */
export function smoothRaster(r: Raster, crop: Crop, size: number, level: Smooth): { raster: Raster; crop: Crop } {
  if (level < 2) return { raster: r, crop };
  const { w, h, cw, ch } = cellsOf(r, crop, size);
  const K = Math.max(1, Math.min(PX_PER_CELL, Math.floor(Math.sqrt(WORK_PIXELS / (w * h))), Math.floor(Math.min(cw / w, ch / h))));
  const W = w * K, H = h * K;
  const P = resample(r, crop, W, H);
  meanShift(P, W, H, 2 * K, SHIFT_RANGE, Math.max(1, Math.round(K / 2)));
  const data = new Uint8Array(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    const [lr, lg, lb] = labToLinear([P[0][i], P[1][i], P[2][i]]);
    data[i * 3] = fromLinear(Math.min(1, Math.max(0, lr)));
    data[i * 3 + 1] = fromLinear(Math.min(1, Math.max(0, lg)));
    data[i * 3 + 2] = fromLinear(Math.min(1, Math.max(0, lb)));
  }
  return { raster: { width: W, height: H, data }, crop: [0, 0, 1, 1] };
}

/**
 * Снимок для сетки, усреднённый по площади до `px` × `px` точек на клетку (поле `px` карточки; у
 * «Своего узора» — с 0.18.2, просьба владельца 31.10.2026: «уменьшать количество пикселей перед
 * обработкой в узоры»). У снимка с телефона на клетку приходятся десятки точек — зерно матрицы,
 * фактура травы и листвы, — и преобладающий цвет по отдельным точкам выходил случайным: узор пестрел.
 * Усреднённая точка — уже цвет места, а граница пятен остаётся: точек на клетку всё ещё px × px.
 * Кадр нового снимка — весь снимок, каждая клетка — ровно px × px его точек; у снимка, где на
 * клетку и так не больше px точек, — снимок и кадр как есть.
 */
export function averageRaster(r: Raster, crop: Crop, size: number, px: number): { raster: Raster; crop: Crop } {
  const { w, h, cw, ch } = cellsOf(r, crop, size);
  const K = Math.min(px, Math.floor(Math.sqrt(WORK_PIXELS / (w * h))));
  if (K < 1 || Math.min(cw / w, ch / h) <= K) return { raster: r, crop };
  const W = w * K, H = h * K;
  const data = new Uint8Array(W * H * 3);
  areaResample(r, crop, W, H, (i, lr, lg, lb) => {
    data[i * 3] = fromLinear(lr);
    data[i * 3 + 1] = fromLinear(lg);
    data[i * 3 + 2] = fromLinear(lb);
  });
  return { raster: { width: W, height: H, data }, crop: [0, 0, 1, 1] };
}

/**
 * Узор с охраной деталей: охрана от GUARD_START, ослабляется в GUARD_GROW раз, пока `ok` не
 * примет узор (проверки карточки или своего узора); не принял ни один — чистка без охраны.
 * `guard` в ответе — с какой охраной собран (нет — без неё).
 */
export function buildGuarded(g: Grid, o: Omit<BuildOptions, 'clean'>, ok: (p: Pattern) => boolean): { pattern: Pattern; log: BuildLog; guard?: number } {
  let guard = GUARD_START;
  for (let t = 0; t < GUARD_TRIES; t++, guard *= GUARD_GROW) {
    const built = buildPattern(g, { ...o, clean: { ...SMOOTH_CLEAN, guard } });
    if (ok(built.pattern)) return { ...built, guard };
  }
  return buildPattern(g, { ...o, clean: SMOOTH_CLEAN });
}
