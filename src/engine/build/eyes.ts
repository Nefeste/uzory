// Глаза снимка (разбор «Кота в окне», владелец 15.10.2026: «у кота нет глаз… даже несколько
// крестиков чёрных вместо глаз визуально спасли бы ситуацию»). Глаз зверя или птицы мельче клетки:
// и среднее, и преобладающий цвет отдают клетку шерсти, а чистка «конфетти» и палитра добивают
// остальное. Автор карточки обводит каждый глаз рамкой (`pattern.eyes`, доли снимка), а сборка
// находит в рамке самую заметную клетку — пятно, а не край, — и вышивает её нитью узора, ближней к
// цвету глаза и далёкой от шерсти вокруг. Новых нитей нет: узор вокруг глаз не меняется.
// Тем же мерилом — кресты на главах (`pattern.lines`, 16.10.2026): линия креста тоньше клетки, и
// клетка берёт цвет неба; в рамке креста вышивается самая большая связная группа заметных клеток.
import { deltaOK, linearToLab, rgbToLab, type Lab } from '../color';
import type { Pattern } from '../pattern';
import { type Raster, toGrid } from './grid';

export type Rect = [number, number, number, number];

/** Точек на клетку по каждой стороне в мелкой сетке: глаз — несколько таких точек. */
const K = 8;
/** Доля самых заметных точек клетки, по которым считаются её заметность и цвет глаза. */
const TOP = 0.15;
/** Заметнее этого — глаз виден; бледнее — рамка без глаза (закрыт, отвернулся). */
export const EYE_SHOW = 0.1;
/** Соседняя клетка — тоже глаз, если заметна не меньше этой доли от самой заметной. */
const NEIGHBOUR = 0.8;
/** Нить глаза отличается от нити клетки хотя бы на столько (OKLab). */
const CONTRAST = 0.12;
/** Клетка креста — заметнее этого: у крестов «Успенского собора» клетки — до 0,7, порог выше рвёт перекладины. */
export const LINE_SHOW = 0.12;

export interface Eye {
  /** клетка узора */
  x: number;
  y: number;
  /** заметность: насколько пятно отличается от окружения, OKLab */
  strength: number;
  /** цвет глаза — среднее самых заметных точек клетки */
  color: Lab;
}

/**
 * Мерило клеток узора `w` × `h` из кадра `crop` снимка `r`: по рамке (доли снимка) — её клетки с
 * заметностью и цветом, от самой заметной. В рамке — клетки с центром внутри; рамка мельче клетки —
 * клетка под её серединой. Заметность точки — наименьшее по четырём сторонам отличие от окружения на
 * клетку в сторону, тёмное — с прибавкой: у края одна сторона того же цвета, а у пятна — все разные.
 */
function measurer(r: Raster, crop: Rect, w: number, h: number): (rect: Rect) => Eye[] {
  const size = Math.max(w, h);
  const fine = toGrid(r, crop, size * K);
  const W = fine.w, H = fine.h;
  const L = new Float64Array(W * H), A = new Float64Array(W * H), B = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const c = linearToLab(fine.rgb[i * 3], fine.rgb[i * 3 + 1], fine.rgb[i * 3 + 2]);
    L[i] = c[0];
    A[i] = c[1];
    B[i] = c[2];
  }
  // суммы по прямоугольникам: среднее окна K × K за одно сложение
  const pre = [L, A, B].map((ch) => {
    const p = new Float64Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) p[(y + 1) * (W + 1) + x + 1] = ch[y * W + x] + p[y * (W + 1) + x + 1] + p[(y + 1) * (W + 1) + x] - p[y * (W + 1) + x];
    return p;
  });
  const half = Math.floor(K / 2);
  const around = (cx: number, cy: number): Lab | null => {
    const xa = cx - half, xb = cx + half + 1, ya = cy - half, yb = cy + half + 1;
    if (xa < 0 || ya < 0 || xb > W || yb > H) return null;
    const n = (xb - xa) * (yb - ya);
    return pre.map((p) => (p[yb * (W + 1) + xb] - p[ya * (W + 1) + xb] - p[yb * (W + 1) + xa] + p[ya * (W + 1) + xa]) / n) as Lab;
  };
  // клетка узора → её точки в мелкой сетке
  const span = (c: number, n: number, N: number): [number, number] => [Math.floor((c * N) / n), Math.max(Math.floor((c * N) / n) + 1, Math.floor(((c + 1) * N) / n))];
  const measured = new Map<number, Eye>();
  const measure = (x: number, y: number): Eye => {
    const key = y * w + x;
    const known = measured.get(key);
    if (known) return known;
    const [x0, x1] = span(x, w, W);
    const [y0, y1] = span(y, h, H);
    const ds: { d: number; c: Lab }[] = [];
    for (let fy = y0; fy < y1; fy++) {
      for (let fx = x0; fx < x1; fx++) {
        const p: Lab = [L[fy * W + fx], A[fy * W + fx], B[fy * W + fx]];
        let d = Infinity;
        for (const [dx, dy] of [[K, 0], [-K, 0], [0, K], [0, -K]]) {
          const q = around(fx + dx, fy + dy);
          if (q) d = Math.min(d, deltaOK(p, q) + Math.max(0, q[0] - p[0]));
        }
        ds.push({ d: Number.isFinite(d) ? d : 0, c: p });
      }
    }
    ds.sort((a, b) => b.d - a.d);
    const n = Math.max(1, Math.round(ds.length * TOP));
    let s = 0;
    const m = [0, 0, 0];
    for (let k = 0; k < n; k++) {
      s += ds[k].d;
      for (let j = 0; j < 3; j++) m[j] += ds[k].c[j];
    }
    const eye: Eye = { x, y, strength: s / n, color: [m[0] / n, m[1] / n, m[2] / n] };
    measured.set(key, eye);
    return eye;
  };
  const cx = (fx: number) => ((fx - crop[0]) / (crop[2] - crop[0])) * w;
  const cy = (fy: number) => ((fy - crop[1]) / (crop[3] - crop[1])) * h;
  return ([a0, b0, a1, b1]) => {
    const inside: Eye[] = [];
    for (let y = Math.max(0, Math.floor(cy(b0) - 0.5)); y <= Math.min(h - 1, Math.ceil(cy(b1) - 0.5)); y++) {
      for (let x = Math.max(0, Math.floor(cx(a0) - 0.5)); x <= Math.min(w - 1, Math.ceil(cx(a1) - 0.5)); x++) {
        if (x + 0.5 >= cx(a0) && x + 0.5 <= cx(a1) && y + 0.5 >= cy(b0) && y + 0.5 <= cy(b1)) inside.push(measure(x, y));
      }
    }
    if (!inside.length) {
      const x = Math.min(w - 1, Math.max(0, Math.floor(cx((a0 + a1) / 2))));
      const y = Math.min(h - 1, Math.max(0, Math.floor(cy((b0 + b1) / 2))));
      inside.push(measure(x, y));
    }
    return inside.sort((a, b) => b.strength - a.strength || a.y - b.y || a.x - b.x);
  };
}

/**
 * Клетки глаз: узор `w` × `h` из кадра `crop` снимка `r`, рамки глаз `rects` — доли снимка. В каждой
 * рамке — самая заметная клетка; соседняя по стороне — тоже, если почти такая же.
 */
export function findEyes(r: Raster, crop: Rect, w: number, h: number, rects: Rect[]): Eye[] {
  if (!rects.length) return [];
  const cellsOf = measurer(r, crop, w, h);
  const out: Eye[] = [];
  const taken = new Set<number>();
  for (const rect of rects) {
    const inside = cellsOf(rect);
    const peak = inside[0];
    if (peak.strength < EYE_SHOW) continue;
    const next = inside.find((e) => e !== peak && Math.abs(e.x - peak.x) + Math.abs(e.y - peak.y) === 1 && e.strength >= NEIGHBOUR * peak.strength);
    for (const e of next ? [peak, next] : [peak]) {
      if (taken.has(e.y * w + e.x)) continue;
      taken.add(e.y * w + e.x);
      out.push(e);
    }
  }
  return out;
}

/**
 * Клетки крестов (и шпилей) на главах: в каждой рамке `rects` — клетки заметнее LINE_SHOW, связанные
 * по сторонам и углам, и из таких групп — самая большая: крест — самое крупное в своей рамке, а трос
 * к главе бледнее, птица и пятно облака меньше. Крест — одним цветом: среднее его клеток по
 * заметности, иначе блик на позолоте ушёл бы в другую нить. Не заметно ничего — рамка без креста.
 */
export function findLines(r: Raster, crop: Rect, w: number, h: number, rects: Rect[]): Eye[] {
  if (!rects.length) return [];
  const cellsOf = measurer(r, crop, w, h);
  const out: Eye[] = [];
  const taken = new Set<number>();
  for (const rect of rects) {
    const strong = cellsOf(rect).filter((e) => e.strength >= LINE_SHOW);
    const at = new Map(strong.map((e) => [e.y * w + e.x, e]));
    const seen = new Set<number>();
    let best: Eye[] = [];
    let bestStrength = 0;
    // группы — от самой заметной клетки, по сторонам и углам
    for (const start of strong) {
      if (seen.has(start.y * w + start.x)) continue;
      seen.add(start.y * w + start.x);
      const group = [start];
      let sum = 0;
      for (let q = 0; q < group.length; q++) {
        const e = group[q];
        sum += e.strength;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const x = e.x + dx, y = e.y + dy;
            if (x < 0 || x >= w || y < 0 || y >= h || seen.has(y * w + x)) continue;
            const next = at.get(y * w + x);
            if (!next) continue;
            seen.add(y * w + x);
            group.push(next);
          }
        }
      }
      if (group.length > best.length || (group.length === best.length && sum > bestStrength)) {
        best = group;
        bestStrength = sum;
      }
    }
    if (!best.length) continue;
    const m = [0, 0, 0];
    for (const e of best) for (let j = 0; j < 3; j++) m[j] += e.color[j] * e.strength;
    const color: Lab = [m[0] / bestStrength, m[1] / bestStrength, m[2] / bestStrength];
    for (const e of best) {
      if (taken.has(e.y * w + e.x)) continue;
      taken.add(e.y * w + e.x);
      out.push({ ...e, color });
    }
  }
  return out;
}

/**
 * Узор с глазами: клетка глаза — нить узора, ближняя к цвету глаза и дальняя от нити клетки (не
 * ближе CONTRAST к ней) и с той же стороны по светлоте, что глаз: тёмный глаз — темнее шерсти,
 * светлый — светлее. Нить не находится — клетка как была. Новых нитей нет.
 */
export function paintEyes(p: Pattern, eyes: Eye[]): Pattern {
  if (!eyes.length) return p;
  const labs = p.threads.map((t) => rgbToLab(t.rgb));
  const cells = Uint8Array.from(p.cells);
  for (const e of eyes) {
    const i = e.y * p.w + e.x;
    const current = cells[i];
    if (current >= labs.length) continue;
    let best = -1;
    let score = Infinity;
    labs.forEach((c, t) => {
      const away = deltaOK(c, labs[current]);
      if (away < CONTRAST || Math.sign(c[0] - labs[current][0]) !== Math.sign(e.color[0] - labs[current][0])) return;
      const s = deltaOK(c, e.color) - away;
      if (s < score) {
        score = s;
        best = t;
      }
    });
    if (best >= 0) cells[i] = best;
  }
  return { ...p, cells };
}
