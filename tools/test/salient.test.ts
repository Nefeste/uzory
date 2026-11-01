// «Найти главное» (0.24.0; issue 146; src/engine/build/salient.ts): овал — на том, что не похоже на края кадра.
// Снимки «Природы»: цветок посередине — один овал на нём; два и три цветка — по овалу на каждый; огоньки на
// ёлке — главного нет. Поиск кусками даёт те же овалы.
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { salientMains, salientOvals, salientSteps } from '../../src/engine/build/salient';
import { decode } from '../content/image';

const NATURE = join(import.meta.dir, '..', '..', 'content', 'nature');
const centre = (o: number[]) => [(o[0] + o[2]) / 2, (o[1] + o[3]) / 2];

describe('главное по заметности', () => {
  test('«Георгин»: один овал — на цветке посередине кадра', async () => {
    const r = await decode(join(NATURE, 'georgin.jpg'));
    const ovals = salientMains(r, [0, 0, 1, 1]);
    expect(ovals).toHaveLength(1);
    const [x, y] = centre(ovals[0]);
    expect(x).toBeGreaterThan(0.35);
    expect(x).toBeLessThan(0.65);
    expect(y).toBeGreaterThan(0.3);
    expect(y).toBeLessThan(0.65);
  });

  test('«Оранжевые тюльпаны»: три цветка — три овала', async () => {
    const r = await decode(join(NATURE, 'oranzhevye-tyulpany.jpg'));
    expect(salientMains(r, [0, 0, 1, 1])).toHaveLength(3);
  });

  test('«Ёлка в снегу»: огоньки — мелкие пятна, главного нет', async () => {
    const r = await decode(join(NATURE, 'elka-v-snegu.jpg'));
    expect(salientMains(r, [0, 0, 1, 1])).toEqual([]);
  });

  test('«Газании»: два цветка — два овала, на каждом свой', async () => {
    const r = await decode(join(NATURE, 'gazanii.jpg'));
    const ovals = salientMains(r, [0, 0, 1, 1]);
    expect(ovals).toHaveLength(2);
    const xs = ovals.map((o) => centre(o)[0]).sort((a, b) => a - b);
    expect(xs[1] - xs[0]).toBeGreaterThan(0.2);
  });

  test('поиск кусками — те же овалы; кадр — в долях снимка', async () => {
    const r = await decode(join(NATURE, 'georgin.jpg'));
    const crop: [number, number, number, number] = [0.1, 0.05, 0.9, 0.95];
    const steps = salientSteps(r, crop);
    let pauses = 0;
    let s = steps.next();
    for (; !s.done; s = steps.next()) pauses++;
    expect(s.value).toEqual(salientMains(r, crop));
    expect(pauses).toBeGreaterThan(3);
    for (const o of s.value) {
      expect(o[0]).toBeGreaterThanOrEqual(crop[0] - 1e-9);
      expect(o[2]).toBeLessThanOrEqual(crop[2] + 1e-9);
    }
  });

  test('ровный кадр — главного нет; яркое пятно посередине — овал вокруг него', () => {
    const w = 120, h = 90;
    const flat = new Float64Array(w * h * 3).fill(0.5);
    expect(salientOvals(flat, w, h)).toEqual([]);
    const spot = Float64Array.from(flat);
    for (let y = 35; y < 55; y++) for (let x = 50; x < 70; x++) spot.set([0.7, 0.2, 0.1], (y * w + x) * 3);
    const ovals = salientOvals(spot, w, h);
    expect(ovals).toHaveLength(1);
    const [cx, cy] = centre(ovals[0]);
    expect(Math.abs(cx - 60 / w)).toBeLessThan(0.03);
    expect(Math.abs(cy - 45 / h)).toBeLessThan(0.03);
  });
});
