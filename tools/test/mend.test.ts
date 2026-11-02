// Правки исходника по словам владельца (0.24.2; отбор 01.11.2026, второй круг): заплатка (`patch`) —
// полоса закрашивается цветом её краёв, окраска (`paint`) — многоугольник получает свой цвет с тенями
// исходника, чистая бумага (`clear`) — в рамке ничего не вышивается. Прежние версии без этих полей
// собираются как раньше (ADR 0010).
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deltaOK, linear, linearToLab, rgbToLab } from '../../src/engine/color';
import { CANVAS } from '../../src/engine/pattern';
import { buildCard } from '../content/build';
import { CONTENT, readCard } from '../content/cards';
import { clearRects } from '../content/chart';
import { paintRaster, patchRaster, type Raster } from '../content/image';

const GREEN = 0x4f7a3a, PAPER = 0xe8e0cc, WHITE = 0xffffff;
const rgbAt = (r: Raster, x: number, y: number) => {
  const o = (y * r.width + x) * 3;
  return (r.data[o] << 16) | (r.data[o + 1] << 8) | r.data[o + 2];
};
const labAt = (r: Raster, x: number, y: number) => {
  const o = (y * r.width + x) * 3;
  return linearToLab(linear(r.data[o]), linear(r.data[o + 1]), linear(r.data[o + 2]));
};
function raster(w: number, h: number, color: (x: number, y: number) => number): Raster {
  const data = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = color(x, y), o = (y * w + x) * 3;
      [data[o], data[o + 1], data[o + 2]] = [(c >> 16) & 255, (c >> 8) & 255, c & 255];
    }
  }
  return { width: w, height: h, data };
}

describe('заплатка (patch)', () => {
  // стебель — столбцы 8–11 на бумаге, поперёк — белая полоса в строках 9–10, как у «Оранжевых лилий»
  const r = raster(20, 20, (x, y) => (y === 9 || y === 10 ? WHITE : x >= 8 && x < 12 ? GREEN : PAPER));

  test('полоса поперёк стебля — цветом краёв: стебель сходится, бумага по бокам — бумага', () => {
    const out = patchRaster(r, [[6 / 20, 9 / 20, 14 / 20, 11 / 20]]);
    for (const y of [9, 10]) {
      for (let x = 8; x < 12; x++) expect(rgbAt(out, x, y)).toBe(GREEN);
      for (const x of [6, 7, 12, 13]) expect(rgbAt(out, x, y)).toBe(PAPER);
      // за рамкой — как было
      expect(rgbAt(out, 2, y)).toBe(WHITE);
    }
    // исходник не тронут
    expect(rgbAt(r, 9, 9)).toBe(WHITE);
  });

  test('рамка у края снимка — цветом другого края; без поля и с пустым списком — тот же растр', () => {
    const spot = raster(20, 20, (x, y) => (x < 3 && y < 5 ? 0xd9b8b0 : PAPER));
    const out = patchRaster(spot, [[0, 0, 3 / 20, 5 / 20]]);
    for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) expect(rgbAt(out, x, y)).toBe(PAPER);
    expect(patchRaster(spot, []).data).toEqual(spot.data);
  });
});

describe('окраска (paint)', () => {
  // «клюв» — оливковый квадрат 6 × 4 с тенью снизу, на траве
  const OLIVE = 0xa8b04a, OLIVE_DARK = 0x7c8236, GRASS = 0x5c9a3c;
  const r = raster(20, 12, (x, y) => (x >= 7 && x < 13 && y >= 4 && y < 8 ? (y === 7 ? OLIVE_DARK : OLIVE) : GRASS));
  const BROWN = 0x8b5a2b;
  const out = paintRaster(r, [{ color: BROWN, points: [[6.5 / 20, 3.5 / 12], [13.5 / 20, 3.5 / 12], [13.5 / 20, 8.5 / 12], [6.5 / 20, 8.5 / 12]] }]);

  test('внутри — оттенок заданного цвета, трава вокруг — как была', () => {
    const [, ta, tb] = rgbToLab(BROWN);
    for (let y = 4; y < 8; y++) {
      for (let x = 7; x < 13; x++) {
        const [, a, b] = labAt(out, x, y);
        expect(Math.abs(a - ta) + Math.abs(b - tb)).toBeLessThan(0.02);
      }
    }
    // клюв теперь далеко от травы, а был близко
    expect(deltaOK(labAt(out, 9, 5), rgbToLab(GRASS))).toBeGreaterThan(deltaOK(labAt(r, 9, 5), rgbToLab(GRASS)));
    for (const [x, y] of [[2, 2], [16, 10], [5, 5], [14, 6]] as const) expect(rgbAt(out, x, y)).toBe(GRASS);
  });

  test('тень остаётся тенью: разница светлоты — как у исходника', () => {
    const was = labAt(r, 9, 5)[0] - labAt(r, 9, 7)[0];
    const now = labAt(out, 9, 5)[0] - labAt(out, 9, 7)[0];
    expect(was).toBeGreaterThan(0.05);
    expect(Math.abs(now - was)).toBeLessThan(0.01);
  });
});

describe('чистая бумага (clear)', () => {
  test('клетки в рамке — бумага, за рамкой — как были', () => {
    const paper = new Uint8Array(6 * 4);
    clearRects(paper, 6, 4, [[1, 1, 3, 3], [5, 0, 9, 1]]);
    expect([...paper]).toEqual([0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

/** Карточка во временной папке коллекции — так её читает tools/content. */
function cardAt(collection: string, id: string, yaml: string) {
  const dir = join(mkdtempSync(join(tmpdir(), 'uzory-mend-')), collection);
  mkdirSync(dir);
  writeFileSync(join(dir, `${id}.yaml`), yaml);
  // ошибки полей узора; прочие поля карточки (автор, музей) здесь не проверяются
  return { errors: readCard(join(dir, `${id}.yaml`)).errors.filter((e) => e.startsWith('pattern.')) };
}

describe('поля в карточке', () => {
  const card = (pattern: string) => [
    'id: proba', 'title: Проба', 'collection: flowers', 'order: 1',
    'source: { file: proba.jpg, url: "", basis: проба }',
    'pattern:', '  size: 60', '  threads: 8', pattern,
  ].join('\n');

  test('чистая бумага — только с бумагой от края; заплатка и окраска — не у схемы; пустой список — как без поля', () => {
    expect(cardAt('flowers', 'proba', card('  clear: [[0.1, 0.1, 0.2, 0.2]]')).errors.join()).toContain('pattern.clear');
    expect(cardAt('flowers', 'proba', card('  canvas: "#e8e0cc"\n  canvas_edge: true\n  clear: [[0.1, 0.1, 0.2, 0.2]]')).errors).toEqual([]);
    expect(cardAt('flowers', 'proba', card('  patch: [[0.3, 0.1, 0.2, 0.2]]')).errors.join()).toContain('pattern.patch');
    expect(cardAt('flowers', 'proba', card('  paint: [{ color: "коричневый", points: [[0.1, 0.1], [0.2, 0.1], [0.2, 0.2]] }]')).errors.join()).toContain('pattern.paint');
    expect(cardAt('flowers', 'proba', card('  paint: [{ color: "#8b5a2b", points: [[0.1, 0.1], [0.2, 0.2]] }]')).errors.join()).toContain('pattern.paint');
    expect(cardAt('flowers', 'proba', card('  paint: [{ color: "#8b5a2b", points: [[0.1, 0.1], [0.2, 0.1], [0.2, 0.2]] }]\n  patch: []\n  clear: []')).errors).toEqual([]);
  });
});

describe('«Оранжевые лилии» (v4): стебель без белой полосы, прежняя версия — как была', () => {
  test('у v4 стебель в строке полосы вышит, у v3 там пустая канва', async () => {
    const { card } = readCard(join(CONTENT, 'flowers', 'florilegiy-lilii.yaml'));
    const [now, was] = [await buildCard(card!, 4), await buildCard(card!, 3)];
    // полоса — доля 0,4205 снимка по высоте, стебель — 0,63…0,70 по ширине; кадры у v3 и v4 одни и те же
    const [cx0, cy0, cx1, cy1] = card!.pattern!.crop!;
    const cellOf = (p: typeof now.pattern, fx: number, fy: number) => p.cells[Math.floor(((fy - cy0) / (cy1 - cy0)) * p.h) * p.w + Math.floor(((fx - cx0) / (cx1 - cx0)) * p.w)];
    const xs = [0.63, 0.65, 0.67, 0.69];
    expect(xs.filter((fx) => cellOf(now.pattern, fx, 0.4205) === CANVAS)).toEqual([]);
    expect(xs.filter((fx) => cellOf(was.pattern, fx, 0.4205) === CANVAS).length).toBeGreaterThan(0);
  });
});
