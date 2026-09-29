// Старинные схемы (docs/09-content.md, «Старинные схемы»): распознавание сетки на
// нарисованной схеме с подвохами настоящих сканов — бумага растянута неравномерно, каждая
// десятая линия толще, справа лист подклеен и сетка сдвинута, вокруг поле без сетки и рамка.
import { describe, expect, test } from 'bun:test';
import { deltaOK, linear, linearToLab, rgbToLab } from '../../src/engine/color';
import { detectChart, paperCells, sampleChart, whitePaperCells, whiten } from '../content/chart';
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

/** Линейный свет → sRGB 0…1. */
function linearToSrgb(x: number): number {
  return x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055;
}
