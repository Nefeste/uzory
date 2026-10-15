// Старинные схемы (docs/09-content.md, «Старинные схемы»): распознавание сетки на
// нарисованной схеме с подвохами настоящих сканов — бумага растянута неравномерно, каждая
// десятая линия толще, справа лист подклеен и сетка сдвинута, вокруг поле без сетки и рамка.
import { describe, expect, test } from 'bun:test';
import { deltaOK, linear, linearToLab, rgbToLab } from '../../src/engine/color';
import { type ChartCells, detectChart, paperCells, sampleChart, whitePaperCells, whiten } from '../content/chart';
import type { Raster } from '../content/image';
import { CHART_H as H, CHART_PAPER as PAPER, CHART_W as W, chartPaint as paint, chartRaster as drawChart, hy, vx } from './helpers';

const lab = (g: { rgb: Float64Array }, i: number) => linearToLab(g.rgb[i * 3], g.rgb[i * 3 + 1], g.rgb[i * 3 + 2]);

describe('старинная схема', () => {
  const r = drawChart();
  // рамка поиска — по полю, чуть шире сетки: поле без сетки сборка отрезает сама
  const rect: [number, number, number, number] = [(vx(0) - 12) / r.width, (hy(0, 0) - 12) / r.height, (vx(W) + 12) / r.width, (hy(H, 0) + 12) / r.height];
  const g = detectChart(r, rect);
  const cells = sampleChart(r, g, 0.25);

  test('число клеток — как нарисовано, поле отрезано', () => {
    expect([cells.w, cells.h]).toEqual([W, H]);
  });

  test('цвет клетки — её краска или бумага: у шва склейки ошибок — единицы', () => {
    const off: string[] = [];
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const p = paint(i, j);
        const d = deltaOK(lab(cells, j * W + i), rgbToLab(p >= 0 ? p : PAPER));
        expect(d).toBeLessThan(0.12);
        if (d >= 0.03) off.push(`${i},${j}`);
      }
    }
    expect(off.length).toBeLessThanOrEqual(6);
  });

  test('бумага — фон; белила, одиночная клетка и косая линия — узор', () => {
    const paper = paperCells(cells, PAPER, 0.06, 0.05);
    const wrong: string[] = [];
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const p = paint(i, j);
        // краска бумагой не становится никогда
        if (p >= 0) expect({ i, j, paper: paper[j * W + i] }).toEqual({ i, j, paper: 0 });
        else if (paper[j * W + i] !== 1) wrong.push(`${i},${j}`);
      }
    }
    expect(wrong.length).toBeLessThanOrEqual(3);
  });

  test('пожелтевший белый лист: после выбеливания бумага белая, краски — как были', () => {
    // печать прозрачными красками на белой бумаге; лист пожелтел: каждый канал умножен на жёлтый
    const printed = drawChart(0xffffff, false);
    const tint = [1, 0.9, 0.62];
    const aged: Raster = { ...printed, data: printed.data.map((v, k) => Math.round(255 * linearToSrgb(linear(v) * tint[k % 3]))) };
    const y = whiten(sampleChart(aged, detectChart(aged, rect), 0.25));
    const paper = whitePaperCells(y, 0.06);
    const bad: string[] = [];
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const p = paint(i, j, false);
        if (p >= 0) expect({ i, j, paper: paper[j * W + i] }).toEqual({ i, j, paper: 0 });
        else if (paper[j * W + i] !== 1) bad.push(`${i},${j} бумага?`);
        // краска после выбеливания — та, что была на белой бумаге
        if (p >= 0 && deltaOK(lab(y, j * W + i), rgbToLab(p)) > 0.04) bad.push(`${i},${j} цвет`);
      }
    }
    expect(bad.length).toBeLessThanOrEqual(6);
  });
});

/**
 * Берлинский лист с прозрачной краской (разбор владельца 15.10.2026, «белые точки» у «Шпица на
 * подушке» и «Охотничьей собаки»): клетки уже разобраны — цвет середины и видна ли сетка. Вокруг —
 * голубая бумага; посреди — трава прозрачной зелёной краской, сквозь неё сетка видна. В траве —
 * клетка и квадрат 2 × 2 белил цвета бумаги, поляна бумаги 5 × 4 и выемка бумаги с краю травы.
 */
describe('старинная схема: бумага посреди рисунка', () => {
  const W = 30, H = 20;
  const GRASS = 0x86a37a;
  const inGrass = (i: number, j: number) => i >= 6 && i <= 23 && j >= 4 && j <= 15;
  function kind(i: number, j: number): 'grass' | 'speck' | 'glade' | 'notch' | 'paper' {
    if (!inGrass(i, j)) return 'paper';
    if (i === 10 && j === 8) return 'speck';
    if (i >= 15 && i <= 16 && j >= 10 && j <= 11) return 'speck';
    if (i >= 18 && i <= 22 && j >= 6 && j <= 9) return 'glade';
    if (i === 12 && j === 4) return 'notch';
    return 'grass';
  }
  const rgb = new Float64Array(W * H * 3);
  const lines = new Float64Array(W * H);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const hex = kind(i, j) === 'grass' ? GRASS : PAPER;
      for (let k = 0; k < 3; k++) rgb[(j * W + i) * 3 + k] = linear((hex >> (16 - 8 * k)) & 255);
      lines[j * W + i] = kind(i, j) === 'grass' ? 0.12 : 0.2;
    }
  }
  const cells: ChartCells = { w: W, h: H, rgb, lines };
  const count = (paper: Uint8Array, what: ReturnType<typeof kind>) => {
    let n = 0;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (kind(i, j) === what && paper[j * W + i]) n++;
    return n;
  };

  test('трава дальше 0,1 от бумаги, но ближе 0,2 — как прозрачная краска на листе', () => {
    const d = deltaOK(rgbToLab(GRASS), rgbToLab(PAPER));
    expect(d).toBeGreaterThan(0.1);
    expect(d).toBeLessThan(0.2);
  });

  test('образцы бумаги до 0,2 (как до 15.10.2026): «бумага рядом» сползает к цвету травы, и трава сходит за бумагу', () => {
    expect(count(paperCells(cells, PAPER, 0.06, 0.05), 'grass')).toBeGreaterThan(20);
  });

  test('образцы бумаги до 0,1 (canvas_seed): трава — краска; белила, поляна и выемка — бумага', () => {
    const paper = paperCells(cells, PAPER, 0.06, 0.05, 0.1);
    expect(count(paper, 'grass')).toBe(0);
    expect([count(paper, 'speck'), count(paper, 'glade'), count(paper, 'notch'), count(paper, 'paper')]).toEqual([5, 20, 1, W * H - 18 * 12]);
  });

  test('бумага посреди рисунка до canvas_holes клеток — краска; поляна больше и выемка у края — фон', () => {
    const paper = paperCells(cells, PAPER, 0.06, 0.05, 0.1, 6);
    expect([count(paper, 'grass'), count(paper, 'speck'), count(paper, 'glade'), count(paper, 'notch'), count(paper, 'paper')]).toEqual([0, 0, 20, 1, W * H - 18 * 12]);
    // поляна в 20 клеток — краска, только если canvas_holes не меньше
    expect(count(paperCells(cells, PAPER, 0.06, 0.05, 0.1, 20), 'glade')).toBe(0);
  });
});

/** Линейный свет → sRGB 0…1. */
function linearToSrgb(x: number): number {
  return x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055;
}
