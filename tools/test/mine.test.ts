// Свой узор (docs/specs/2026-09-custom.md): сборка из снимка — та же, что у библиотеки, а
// приговор говорит «подходит» или «не подходит» по проверкам docs/09-content.md, §6.
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toGrid, type Raster } from '../../src/engine/build/grid';
import { checkPatternWith } from '../../src/engine/build/checks';
import { buildMine, defaultThreads, libraryCard, MINE_SEED, mineCells, MINE_SIZES, slugOf, verdictOf } from '../../src/engine/build/mine';
import { buildPattern } from '../../src/engine/build/palette';
import { SIMPLIFY_CLEAN, simplifyGrid } from '../../src/engine/build/simplify';
import { hash32 } from '../../src/engine/seed';
import { readCard } from '../content/cards';

/** Снимок из функции цвета точки: (x, y) в долях → 0xRRGGBB. */
function photo(w: number, h: number, color: (x: number, y: number) => number): Raster {
  const data = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = color(x / w, y / h);
      data.set([c >> 16, (c >> 8) & 255, c & 255], (y * w + x) * 3);
    }
  }
  return { width: w, height: h, data };
}

const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
/** Небо, солнце, холм и дом — крупные спокойные пятна, как на удачном снимке. */
const scene = (x: number, y: number) => {
  if ((x - 0.75) ** 2 + (y - 0.2) ** 2 < 0.01) return 0xf2c230;
  if (x > 0.2 && x < 0.45 && y > 0.45 && y < 0.75) return y < 0.55 ? 0x8c2a1e : 0xc9b48a;
  if (y > 0.6 + 0.1 * Math.sin(x * 6)) return (lerp(60, 30, y) << 16) | (lerp(140, 90, y) << 8) | 50;
  return (lerp(120, 200, y) << 16) | (lerp(170, 220, y) << 8) | 240;
};

/** Пёстрая листва: пятна пяти зелёных чуть больше клетки — без упрощения рассыпается. */
const leaves = (x: number, y: number) => [0x2e5e3a, 0x4f8a3c, 0x7fb35a, 0x1d3b24, 0xa8c46a][hash32(`${Math.floor(x * 40)},${Math.floor(y * 30)}`) % 5];

/** Карточка во временной папке коллекции — так её читает tools/content. */
function cardFile(id: string, yaml: string): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'uzory-card-')), 'nature');
  mkdirSync(dir);
  writeFileSync(join(dir, `${id}.yaml`), yaml);
  return join(dir, `${id}.yaml`);
}

describe('свой узор', () => {
  test('спокойный снимок подходит; размер по длинной стороне', () => {
    const r = photo(800, 600, scene);
    const m = buildMine(r, { crop: [0, 0, 1, 1], side: MINE_SIZES.M, threads: defaultThreads(MINE_SIZES.M) });
    expect([m.pattern.w, m.pattern.h]).toEqual([70, 53]);
    expect(mineCells(r, [0, 0, 1, 1], 70)).toEqual({ w: 70, h: 53 });
    expect(m.verdict.level).not.toBe('bad');
  });

  test('та же сетка — тот же узор, что у сборки библиотеки', () => {
    const r = photo(400, 300, scene);
    const m = buildMine(r, { crop: [0.1, 0.1, 0.9, 0.8], side: 60, threads: 12 });
    const lib = buildPattern(toGrid(r, [0.1, 0.1, 0.9, 0.8], 60), { id: MINE_SEED, v: 1, threads: 12 }).pattern;
    // и тот же кадр — тот же узор при каждой сборке: приговор не гуляет
    expect(Buffer.from(buildMine(r, { crop: [0.1, 0.1, 0.9, 0.8], side: 60, threads: 12 }).pattern.cells).equals(Buffer.from(m.pattern.cells))).toBe(true);
    expect(Buffer.from(m.pattern.cells).equals(Buffer.from(lib.cells))).toBe(true);
    expect(m.pattern.threads).toEqual(lib.threads);
  });

  test('шахматка рассыпается на одиночки — не подходит', () => {
    // чистка сборки сливает одиночки снимков, поэтому «не подходит» проверяется на готовом
    // узоре: шахматка трёх нитей — все клетки одиночные
    const w = 30, h = 20;
    const cells = Uint8Array.from({ length: w * h }, (_, i) => ((i % w) + Math.floor(i / w)) % 2 === 0 ? 0 : 1 + ((i % w) % 2));
    const p = { key: 'mine-chess@1', w, h, threads: [{ rgb: 0x8c2a1e, name: 'a' }, { rgb: 0x2e5e3a, name: 'b' }, { rgb: 0xf2c230, name: 'c' }], cells };
    const v = verdictOf(p, checkPatternWith(p), 5);
    expect(v.level).toBe('bad');
    expect(v.issues).toContain('singles');
    expect(v.issues).toContain('small');
  });

  test('тёмный, мелкий и одноцветный снимки — подходят, но с советом', () => {
    const dark = buildMine(photo(400, 300, (x, y) => (scene(x, y) >> 2) & 0x3f3f3f), { crop: [0, 0, 1, 1], side: 70, threads: 16 });
    expect(dark.verdict.issues).toContain('dark');
    const small = buildMine(photo(90, 60, scene), { crop: [0, 0, 1, 1], side: 120, threads: 16 });
    expect(small.verdict.issues).toContain('blurry');
    expect(small.pxPerCell).toBeLessThan(1);
    const flat = buildMine(photo(300, 200, (x) => (x < 0.5 ? 0x2e5e3a : 0xf4f0e6)), { crop: [0, 0, 1, 1], side: 60, threads: 8 });
    expect(flat.verdict.issues).toContain('flat');
    expect(flat.verdict.level).toBe('warn');
  });

  test('карточка для библиотеки проходит проверку карточек', () => {
    expect(slugOf('Набережная Вятки')).toBe('naberezhnaya-vyatki');
    expect(slugOf('Зонтики в парке!')).toBe('zontiki-v-parke');
    const { id, yaml } = libraryCard({ title: 'Сирень у крыльца', crop: [0.1, 0.05, 0.9, 0.95], side: 120, threads: 24, now: new Date(2026, 8, 29) });
    expect(id).toBe('siren-u-kryltsa');
    const { card, errors } = readCard(cardFile(id, yaml));
    expect(errors).toEqual([]);
    expect(card?.pattern).toEqual({ crop: [0.1, 0.05, 0.9, 0.95], size: 120, threads: 24 });
    expect(card?.source.basis).toContain('снимок автора игры');
    // упрощение переходит в карточку, «нет» — поля нет вовсе
    expect(libraryCard({ title: 'Сирень', crop: [0, 0, 1, 1], side: 70, threads: 16, simplify: 0, now: new Date(2026, 8, 29) }).yaml).not.toContain('simplify');
    const strong = libraryCard({ title: 'Сирень', crop: [0, 0, 1, 1], side: 70, threads: 16, simplify: 2, now: new Date(2026, 8, 29) });
    const read = readCard(cardFile(strong.id, strong.yaml));
    expect(read.errors).toEqual([]);
    expect(read.card?.pattern?.simplify).toBe(2);
    expect(readCard(cardFile('bad', strong.yaml.replace('simplify: 2', 'simplify: 3'))).errors.join()).toContain('pattern.simplify');
  });

  test('упрощение: пёстрая листва без него рассыпается, с ним — ровные пятна', () => {
    const r = photo(700, 525, leaves);
    const plain = buildMine(r, { crop: [0, 0, 1, 1], side: 70, threads: 16 });
    expect(plain.checked.stats.small).toBeGreaterThan(2);
    // «нет» — та же сборка, что и без настройки
    expect(Buffer.from(buildMine(r, { crop: [0, 0, 1, 1], side: 70, threads: 16, simplify: 0 }).pattern.cells).equals(Buffer.from(plain.pattern.cells))).toBe(true);
    for (const simplify of [1, 2] as const) {
      const m = buildMine(r, { crop: [0, 0, 1, 1], side: 70, threads: 16, simplify });
      expect(m.checked.stats.singles).toBe(0);
      expect(m.checked.stats.small).toBe(0);
      expect(m.verdict.level).toBe('ok');
      // и с упрощением — тот же узор, что соберёт tools/content по карточке с pattern.simplify
      const lib = buildPattern(simplifyGrid(toGrid(r, [0, 0, 1, 1], 70), simplify), { id: MINE_SEED, v: 1, threads: 16, clean: SIMPLIFY_CLEAN[simplify] }).pattern;
      expect(Buffer.from(m.pattern.cells).equals(Buffer.from(lib.cells))).toBe(true);
    }
  });
});
