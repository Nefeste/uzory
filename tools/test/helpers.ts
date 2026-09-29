// Узоры и работы для тестов — из зерна, одинаковые на любой машине.
import { CANVAS, type Pattern } from '../../src/engine/pattern';
import { hash32, pick, rng } from '../../src/engine/seed';
import type { Stroke } from '../../src/engine/work';
import type { Raster } from '../content/image';

/** Узор пятнами: соседние клетки часто одной нити, как у настоящих узоров. */
export function randomPattern(seed: number, w: number, h: number, threads: number, canvasShare = 0): Pattern {
  const r = rng(seed);
  const cells = new Uint8Array(w * h);
  for (let i = 0; i < cells.length; i++) {
    const x = i % w;
    if (r() < canvasShare) cells[i] = CANVAS;
    else if (x > 0 && r() < 0.6) cells[i] = cells[i - 1];
    else if (i >= w && r() < 0.5) cells[i] = cells[i - w];
    else cells[i] = pick(r, threads);
  }
  // каждая нить встречается хотя бы раз
  for (let t = 0; t < threads; t++) cells[(t * 7919) % cells.length] = t;
  return {
    key: `test-${seed}@1`,
    w,
    h,
    threads: Array.from({ length: threads }, (_, t) => ({ rgb: (t * 0x3b5f1d) & 0xffffff, name: `нить-${t}` })),
    cells,
  };
}

/** Штрихи вперемешку: касания, проходы кистью (соседние клетки), мусор — чужие и повторные. */
export function randomStrokes(seed: number, p: Pattern, count: number): Stroke[] {
  const r = rng(seed);
  const out: Stroke[] = [];
  for (let k = 0; k < count; k++) {
    const thread = pick(r, p.threads.length);
    const n = 1 + pick(r, 40);
    let c = pick(r, p.w * p.h);
    const cells: number[] = [c];
    for (let i = 1; i < n; i++) {
      const d = [1, -1, p.w, -p.w][pick(r, 4)];
      const next = c + d;
      if (next >= 0 && next < p.w * p.h) c = next;
      cells.push(c);
    }
    out.push({ thread, cells });
  }
  return out;
}

/** Работа кистью до конца: по каждой нити — строками, как водит палец. */
export function brushAll(p: Pattern): Stroke[] {
  const out: Stroke[] = [];
  for (let t = 0; t < p.threads.length; t++) {
    for (let y = 0; y < p.h; y++) {
      const cells: number[] = [];
      for (let x = 0; x < p.w; x++) {
        const xx = y % 2 ? p.w - 1 - x : x; // змейкой
        if (p.cells[y * p.w + xx] === t) cells.push(y * p.w + xx);
      }
      for (let i = 0; i < cells.length; i += 30) out.push({ thread: t, cells: cells.slice(i, i + 30) });
    }
  }
  return out;
}

// Старинная схема для tools/test/chart.test.ts: нарисована по клеткам с подвохами настоящих
// сканов — бумага растянута неравномерно, каждая десятая линия толще, справа лист подклеен
// и сетка сдвинута, вокруг поле без сетки и рамка.
export const CHART_W = 40;
export const CHART_H = 30;
export const CHART_PAPER = 0xa8b8c8;
const LINE = 0x3c4650;
const FRAME = 0x282828;
const X0 = 60;
const Y0 = 50;
/** место вертикальной линии k: шаг 9,7 и растяжение до ±3 точек */
export const vx = (k: number) => X0 + k * 9.7 + 3 * Math.sin(k / 7);
/** горизонтальная линия k у точки x: шаг 9,6, растяжение, справа от шва — на 3 точки ниже */
const SEAM = vx(28);
export const hy = (k: number, x: number) => Y0 + k * 9.6 + 2.5 * Math.sin(k / 5) + (x > SEAM ? 3 : 0);

/** Что нарисовано в клетке: краска или бумага (-1). Белила — светлее голубой бумаги. */
const RED = 0xb03a2e, GREEN = 0x3f7f3a, WHITE = 0xf2f0ea, BLUE = 0x2e4f9a;
export function chartPaint(i: number, j: number, white = true): number {
  if (i >= 4 && i <= 9 && j >= 3 && j <= 8) return RED;
  if (white && i >= 12 && i <= 17 && j >= 12 && j <= 20) return WHITE;
  if (i === j + 5 && j >= 2 && j <= 25) return GREEN; // косая линия в клетку
  if (i >= 30 && i <= 35 && j >= 10 && j <= 14) return BLUE; // за швом
  if (i === 22 && j === 22) return RED; // одна клетка — замысел
  return -1;
}

/**
 * Схема по клеткам: краска закрывает клетку вместе с линиями, на бумаге линии видны.
 * `white` — есть ли белила (берлинский лист на голубой бумаге); печатный лист — без них.
 */
export function chartRaster(paper = CHART_PAPER, white = true): Raster {
  const width = 480, height = 400;
  const data = new Uint8Array(width * height * 3);
  const put = (x: number, y: number, rgb: number) => {
    // зерно скана: ±4 по каждому каналу
    const n = hash32(`${x},${y}`);
    for (let k = 0; k < 3; k++) data[(y * width + x) * 3 + k] = Math.max(0, Math.min(255, ((rgb >> (16 - 8 * k)) & 255) + ((n >> (k * 8)) % 9) - 4));
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = x + 0.5, py = y + 0.5;
      let color = paper;
      // рамка вокруг сетки, за полем в полторы клетки
      const fx0 = vx(0) - 18, fx1 = vx(CHART_W) + 18, fy0 = hy(0, 0) - 18, fy1 = hy(CHART_H, 0) + 18;
      const onFrame = (Math.abs(px - fx0) < 1.5 || Math.abs(px - fx1) < 1.5) && py > fy0 && py < fy1 || (Math.abs(py - fy0) < 1.5 || Math.abs(py - fy1) < 1.5) && px > fx0 && px < fx1;
      if (onFrame) color = FRAME;
      if (px >= vx(0) - 1.5 && px <= vx(CHART_W) + 1.5 && py >= hy(0, px) - 1.5 && py <= hy(CHART_H, px) + 1.5) {
        let i = -1, j = -1;
        for (let k = 0; k < CHART_W; k++) if (px >= vx(k) && px < vx(k + 1)) i = k;
        for (let k = 0; k < CHART_H; k++) if (py >= hy(k, px) && py < hy(k + 1, px)) j = k;
        const p = i >= 0 && j >= 0 ? chartPaint(i, j, white) : -1;
        let line = false;
        for (let k = 0; k <= CHART_W; k++) if (Math.abs(px - vx(k)) <= (k % 10 === 0 ? 1.5 : 0.8)) line = true;
        for (let k = 0; k <= CHART_H; k++) if (Math.abs(py - hy(k, px)) <= (k % 10 === 0 ? 1.5 : 0.8)) line = true;
        color = p >= 0 ? p : line ? LINE : paper;
      }
      put(x, y, color);
    }
  }
  return { width, height, data };
}
