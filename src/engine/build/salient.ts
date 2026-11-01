// «Найти главное» для снимков без лиц (0.24.0; владелец 01.11.2026, issue 146: «делаем и «найти лица» и «найти
// главное» для не-лиц, сначала опыт, а выпускаем, если работает в большинстве случаев»). Главное — то, что не
// похоже на края кадра: края снимка почти всегда — фон (трава, небо, стена), а цветок, кошка или дом — внутри.
// 1) кадр — до 160 точек по длинной стороне, усреднением, в OKLab; 2) цвета края (полоса 6 %) — шесть кучек
// k-средних, кучки мельче 5 % края не в счёт: это предмет, задевший край; 3) заметность точки — расстояние до
// ближайшего цвета края, сглаженное, с весом середины кадра; 4) порог Оцу, пятна; самое весомое и равные ему
// (не легче 40 %, не мельче 1 % кадра) — каждому свой овал по моментам пятна, до трёх; 5) пятно на весь кадр,
// нечёткое или мелкое — главного нет. Опыт на 59 снимках «Природы» и «Городов» — docs/specs/2026-09-custom.md.
// Чистый TypeScript (ADR 0002): без случайности — центры кучек ставятся по краю по порядку.
import { LINEAR, linearToLabInto } from '../color';
import type { Rect } from './eyes';
import { drain } from './faces';
import type { Raster } from './grid';

/** Кадр для поиска — столько точек по длинной стороне. */
export const SALIENT_SIDE = 160;
/** Овалов главного «по заметности» — не больше. */
export const SALIENT_MAX = 3;
/** Кучек цветов края. */
const K = 6;
/** Полоса края — доля меньшей стороны. */
const BAND = 0.06;
/** Кучка края мельче — не фон, а предмет, задевший край. */
const MIN_BORDER = 0.05;
/** Вес середины кадра: гауссиана с таким разбросом в долях стороны. */
const CENTER = 0.35;
/** Овал главного больше этой доли кадра — главное весь кадр: овал не нужен. */
const MAX_OVAL = 0.6;
/** Заметность в пятне ниже, чем во столько раз выше, чем вокруг, — нечётко. */
const MIN_CONTRAST = 2.2;
/** Соседнее пятно — тоже главное, если не легче этой доли самого весомого… */
const NEIGHBOR = 0.4;
/** …и не мельче этой доли кадра. */
const MIN_SPOT = 0.01;
/** Все пятна главного вместе мельче — блик, а не главное. */
const MIN_TOTAL = 0.025;
/**
 * Цвет весомее яркости: в OKLab яркость — от 0 до 1, а цвет — около ±0,3, и без веса тень на траве «заметнее»
 * красного цветка (опыт 01.11.2026: с весом 2 — как в CIELab, где цвет и яркость соизмеримы).
 */
const CHROMA = 2;
/** Строк кадра между передышками (src/state/faces.ts). */
const ROWS = 16;

/**
 * Овалы главного по заметности в кадре `crop` снимка (доли снимка), самое весомое — первым; главного нет —
 * пустой список. Шаги — с передышками для экрана, как `faceOvalSteps`.
 */
export function* salientSteps(r: Raster, crop: Rect): Generator<void, Rect[], void> {
  const x0 = Math.max(0, Math.round(crop[0] * r.width)), y0 = Math.max(0, Math.round(crop[1] * r.height));
  const cw = Math.max(1, Math.min(r.width - x0, Math.round((crop[2] - crop[0]) * r.width)));
  const ch = Math.max(1, Math.min(r.height - y0, Math.round((crop[3] - crop[1]) * r.height)));
  const k = Math.min(1, SALIENT_SIDE / Math.max(cw, ch));
  const w = Math.max(1, Math.round(cw * k)), h = Math.max(1, Math.round(ch * k));
  // кадр усреднением (в линейном свете) — в OKLab
  const lab = new Float64Array(w * h * 3);
  for (let j = 0; j < h; j++) {
    const sy0 = y0 + Math.floor((j * ch) / h), sy1 = Math.max(sy0 + 1, y0 + Math.floor(((j + 1) * ch) / h));
    for (let i = 0; i < w; i++) {
      const sx0 = x0 + Math.floor((i * cw) / w), sx1 = Math.max(sx0 + 1, x0 + Math.floor(((i + 1) * cw) / w));
      let rr = 0, gg = 0, bb = 0, n = 0;
      for (let y = sy0; y < sy1; y++) {
        for (let x = sx0; x < sx1; x++) {
          const o = (y * r.width + x) * 3;
          rr += LINEAR[r.data[o]];
          gg += LINEAR[r.data[o + 1]];
          bb += LINEAR[r.data[o + 2]];
          n++;
        }
      }
      const at = (j * w + i) * 3;
      linearToLabInto(rr / n, gg / n, bb / n, lab, at);
      lab[at + 1] *= CHROMA;
      lab[at + 2] *= CHROMA;
    }
    if (j % ROWS === ROWS - 1) yield;
  }
  // доли кадра — в доли снимка
  return salientOvals(lab, w, h).map(([l, t, rt, b]): Rect => [(x0 + l * cw) / r.width, (y0 + t * ch) / r.height, (x0 + rt * cw) / r.width, (y0 + b * ch) / r.height]);
}

/** Овалы главного по заметности сразу (`salientSteps` без передышек). */
export const salientMains = (r: Raster, crop: Rect): Rect[] => drain(salientSteps(r, crop));

/** Овалы главного в долях кадра `w` × `h` (OKLab, по 3 числа на точку). */
export function salientOvals(lab: Float64Array, w: number, h: number): Rect[] {
  const total = w * h;
  const d2 = (p: number, c: number[]) => (lab[3 * p] - c[0]) ** 2 + (lab[3 * p + 1] - c[1]) ** 2 + (lab[3 * p + 2] - c[2]) ** 2;
  // цвета края: k-средние, центры — по краю по порядку
  const band = Math.max(2, Math.round(BAND * Math.min(w, h)));
  const border: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < band || y < band || x >= w - band || y >= h - band) border.push(y * w + x);
  let cent = Array.from({ length: K }, (_, i) => {
    const p = border[Math.floor(((i + 0.5) * border.length) / K)];
    return [lab[3 * p], lab[3 * p + 1], lab[3 * p + 2]];
  });
  let count = new Array<number>(K).fill(0);
  for (let it = 0; it < 10; it++) {
    const sum = Array.from({ length: K }, () => [0, 0, 0]);
    count = new Array<number>(K).fill(0);
    for (const p of border) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < K; c++) {
        const d = d2(p, cent[c]);
        if (d < bd) [bd, best] = [d, c];
      }
      sum[best][0] += lab[3 * p];
      sum[best][1] += lab[3 * p + 1];
      sum[best][2] += lab[3 * p + 2];
      count[best]++;
    }
    cent = cent.map((c, i) => (count[i] ? sum[i].map((s) => s / count[i]) : c));
  }
  const bg = cent.filter((_, i) => count[i] >= MIN_BORDER * border.length);
  // заметность: до ближайшего цвета края, сглаженная 5 × 5, с весом середины
  const raw = new Float64Array(total);
  for (let p = 0; p < total; p++) {
    let bd = Infinity;
    for (const c of bg) bd = Math.min(bd, d2(p, c));
    raw[p] = Math.sqrt(bd);
  }
  const sal = new Float64Array(total);
  let max = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h) {
            s += raw[yy * w + xx];
            n++;
          }
        }
      }
      const cx = x / w - 0.5, cy = y / h - 0.5;
      const v = (s / n) * Math.exp(-(cx * cx + cy * cy) / (2 * CENTER * CENTER));
      sal[y * w + x] = v;
      max = Math.max(max, v);
    }
  }
  if (!(max > 0)) return [];
  // порог Оцу по 64 ступеням
  const hist = new Array<number>(64).fill(0);
  for (const v of sal) hist[Math.min(63, Math.floor((v / max) * 64))]++;
  let all = 0;
  for (let i = 0; i < 64; i++) all += i * hist[i];
  let bestT = 0, bestVar = -1, wB = 0, sB = 0;
  for (let t = 0; t < 64; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sB += t * hist[t];
    const v = wB * wF * (sB / wB - (all - sB) / wF) ** 2;
    if (v > bestVar) [bestVar, bestT] = [v, t];
  }
  const th = ((bestT + 1) / 64) * max;
  // пятна выше порога: вес — сумма заметности
  const spot = new Int32Array(total).fill(-1);
  const spots: { w: number; n: number }[] = [];
  for (let p = 0; p < total; p++) {
    if (sal[p] <= th || spot[p] >= 0) continue;
    const id = spots.length;
    let ws = 0, n = 0;
    const stack = [p];
    spot[p] = id;
    const visit = (q: number) => {
      if (sal[q] > th && spot[q] < 0) {
        spot[q] = id;
        stack.push(q);
      }
    };
    while (stack.length) {
      const q = stack.pop()!;
      ws += sal[q];
      n++;
      const x = q % w, y = (q / w) | 0;
      if (x > 0) visit(q - 1);
      if (x < w - 1) visit(q + 1);
      if (y > 0) visit(q - w);
      if (y < h - 1) visit(q + w);
    }
    spots.push({ w: ws, n });
  }
  if (!spots.length) return [];
  // овал пятна — по моментам заметности, 2σ; ясность — заметность в пятне против вокруг
  const ovalOf = (id: number) => {
    let sw = 0, mx = 0, my = 0, outS = 0;
    for (let p = 0; p < total; p++) {
      if (spot[p] !== id) {
        outS += sal[p];
        continue;
      }
      sw += sal[p];
      mx += sal[p] * (p % w);
      my += sal[p] * ((p / w) | 0);
    }
    mx /= sw;
    my /= sw;
    let vx = 0, vy = 0;
    for (let p = 0; p < total; p++) {
      if (spot[p] !== id) continue;
      vx += sal[p] * ((p % w) - mx) ** 2;
      vy += sal[p] * (((p / w) | 0) - my) ** 2;
    }
    const n = spots[id].n;
    const sx = Math.max(1, Math.sqrt(vx / sw)), sy = Math.max(1, Math.sqrt(vy / sw));
    const oval: Rect = [Math.max(0, (mx - 2 * sx) / w), Math.max(0, (my - 2 * sy) / h), Math.min(1, (mx + 2 * sx) / w), Math.min(1, (my + 2 * sy) / h)];
    return { oval, contrast: sw / n / (outS / Math.max(1, total - n) || 1e-9) };
  };
  const order = spots.map((s, id) => ({ id, ...s })).sort((a, b) => b.w - a.w);
  const first = ovalOf(order[0].id);
  if ((first.oval[2] - first.oval[0]) * (first.oval[3] - first.oval[1]) > MAX_OVAL) return [];
  if (first.contrast < MIN_CONTRAST) return [];
  const picked = order.filter((s) => s.w >= NEIGHBOR * order[0].w && s.n >= MIN_SPOT * total).slice(0, SALIENT_MAX);
  if (picked.reduce((a, s) => a + s.n, 0) < MIN_TOTAL * total) return [];
  return picked.map((s) => (s.id === order[0].id ? first.oval : ovalOf(s.id).oval));
}
