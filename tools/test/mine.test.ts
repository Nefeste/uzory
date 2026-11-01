// Свой узор (docs/specs/2026-09-custom.md): сборка из снимка — та же, что у библиотеки, а
// приговор говорит «подходит» или «не подходит» по проверкам docs/09-content.md, §6.
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Raster } from '../../src/engine/build/grid';
import { type Checked, checkPatternWith } from '../../src/engine/build/checks';
import {
  buildMine, type Crop, defaultThreads, type Issue, libraryCard, MAIN_MIN, maskSpan, MINE_GRID, MINE_SEED, mineCells, MINE_SIZES, slugOf, verdictOf,
} from '../../src/engine/build/mine';
import { focusMask } from '../../src/engine/build/focus';
import { unionMask } from '../../src/engine/build/main';
import { buildPattern } from '../../src/engine/build/palette';
import { mainMask, photoGrid } from '../../src/engine/build/photo';
import { SIMPLIFY_CLEAN } from '../../src/engine/build/simplify';
import { rgbToLab } from '../../src/engine/color';
import type { Pattern } from '../../src/engine/pattern';
import { hash32 } from '../../src/engine/seed';
import { T } from '../../src/i18n';
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

/**
 * Приговор по готовым числам проверок (таблица docs/specs/2026-09-custom.md): узор из нитей `rgbs`
 * поровну, одиночные и мелкие пятна — в процентах, `px` — точек снимка на клетку.
 */
function verdictWith(o: { singles?: number; small?: number; lonely?: number[]; rgbs?: number[]; px?: number }) {
  const rgbs = o.rgbs ?? [0xc0392b, 0x2e86c1, 0xf4d03f];
  const each = 100;
  const p: Pattern = { key: 'proba@1', w: rgbs.length * 10, h: 10, threads: rgbs.map((rgb, i) => ({ rgb, name: `нить ${i + 1}` })), cells: new Uint8Array(rgbs.length * each) };
  const checked: Checked = {
    errors: [],
    warnings: [],
    size: 'S',
    stats: { cells: rgbs.length * each, singles: o.singles ?? 0, small: o.small ?? 0, regions: rgbs.length, minDelta: 0.2, closest: [0, 1], lonely: o.lonely ?? [], counts: rgbs.map(() => each) },
  };
  return verdictOf(p, checked, o.px ?? 4);
}

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

  test('карточка из «Своего узора» — тот же узор в сборке библиотеки: все поля сетки переходят в карточку', () => {
    const r = photo(400, 300, scene);
    const variants = [
      ...([0, 1, 2] as const).map((simplify) => ({ simplify })),
      // главное — овал вокруг дома; фон — как есть, одной нитью, не вышивать (0.19.0)
      { simplify: 1 as const, main: [0.15, 0.4, 0.5, 0.8] as Crop },
      { simplify: 1 as const, main: [0.15, 0.4, 0.5, 0.8] as Crop, background: 'one' as const },
      { simplify: 0 as const, main: [0.15, 0.4, 0.5, 0.8] as Crop, background: 'none' as const },
      // два овала — «Найти лица» нашла два лица (0.24.0)
      { simplify: 1 as const, main: [[0.15, 0.4, 0.5, 0.8], [0.6, 0.2, 0.8, 0.5]] as Crop[], background: 'one' as const },
    ];
    for (const v of variants) {
      const o = { crop: [0.1, 0.1, 0.9, 0.8] as Crop, side: 60, threads: 12, ...v };
      const m = buildMine(r, o);
      // и тот же кадр — тот же узор при каждой сборке: приговор не гуляет
      expect(Buffer.from(buildMine(r, o).pattern.cells).equals(Buffer.from(m.pattern.cells))).toBe(true);
      // сетка снимка по карточке — как в tools/content/build.ts; зерно у карточки — её id, здесь — зерно своего узора
      const { id, yaml } = libraryCard({ title: 'Дача', ...o, now: new Date(2026, 9, 15) });
      const read = readCard(cardFile(id, yaml));
      expect(read.errors).toEqual([]);
      const spec = read.card!.pattern!;
      const grid = photoGrid(r, spec);
      // главное — как лица: своя палитра и бережная чистка (tools/content/build.ts)
      const focus = unionMask(spec.focus?.length ? focusMask(spec.crop ?? [0, 0, 1, 1], grid.w, grid.h, spec.focus) : undefined, mainMask(spec, grid));
      const lib = buildPattern(grid, { id: MINE_SEED, v: 1, threads: spec.threads, clean: SIMPLIFY_CLEAN[spec.simplify ?? 0], ...(focus ? { focus } : {}) }).pattern;
      expect(Buffer.from(m.pattern.cells).equals(Buffer.from(lib.cells))).toBe(true);
      expect(m.pattern.threads).toEqual(lib.threads);
    }
  });

  test('цвет клетки — преобладающий: на границе красного и зелёного нет бурой смеси', () => {
    // полосы по полторы клетки: у каждой третьей клетки граница посередине
    const r = photo(420, 300, (x) => (Math.floor(x * 420 / 9) % 2 ? 0x2e8b57 : 0xc0392b));
    const hue = (rgb: number) => Math.atan2(rgbToLab(rgb)[2], rgbToLab(rgb)[1]);
    const m = buildMine(r, { crop: [0, 0, 1, 1], side: 70, threads: 8 });
    expect(m.pattern.threads.length).toBe(2);
    // нити — красная и зелёная того же оттенка, только ярче (насыщенность ×1,15)
    const [red, green] = [0xc0392b, 0x2e8b57].map((c) => m.pattern.threads.find((t) => Math.abs(hue(t.rgb) - hue(c)) < 0.05));
    expect(red && green).toBeTruthy();
    expect(Math.hypot(rgbToLab(red!.rgb)[1], rgbToLab(red!.rgb)[2])).toBeGreaterThan(Math.hypot(rgbToLab(0xc0392b)[1], rgbToLab(0xc0392b)[2]));
    // среднее по площади смешало бы их в третью, бурую нить
    const mean = buildPattern(photoGrid(r, { size: 70 }), { id: MINE_SEED, v: 1, threads: 8 }).pattern;
    expect(mean.threads.length).toBe(3);
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

  test('главному мало клеток (0.20.0): овал уже MAIN_MIN — совет; шире — без него', () => {
    const w = 30, h = 20;
    const cells = Uint8Array.from({ length: w * h }, (_, i) => ((i % w) < 10 ? 0 : (i % w) < 20 ? 1 : 2));
    const p = { key: 'mine-thirds@1', w, h, threads: [{ rgb: 0x8c2a1e, name: 'a' }, { rgb: 0x2e5e3a, name: 'b' }, { rgb: 0xf2c230, name: 'c' }], cells };
    const checked = checkPatternWith(p);
    expect(verdictOf(p, checked, 5).issues).not.toContain('smallMain');
    expect(verdictOf(p, checked, 5, MAIN_MIN - 1)).toEqual({ level: 'warn', issues: ['smallMain'] });
    expect(verdictOf(p, checked, 5, MAIN_MIN).issues).not.toContain('smallMain');
    // меньшая сторона овала: 3 столбца × 2 строки → 2
    const mask = new Uint8Array(w * h);
    for (const [x, y] of [[4, 5], [5, 5], [6, 5], [5, 6]]) mask[y * w + x] = 1;
    expect(maskSpan(mask, w)).toBe(2);
    expect(maskSpan(new Uint8Array(w * h), w)).toBe(0);
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

  test('приговор по таблице: «не подходит» — одиночных больше 1 %, мелких пятен больше 3 %, нить из одних одиночек', () => {
    expect(verdictWith({ singles: 1.01 })).toEqual({ level: 'bad', issues: ['singles'] });
    expect(verdictWith({ small: 3.01 })).toEqual({ level: 'bad', issues: ['small'] });
    expect(verdictWith({ lonely: [2] })).toEqual({ level: 'bad', issues: ['lonely'] });
    // «не подходит» не добавляет «почти на пределе», а советы «подходит, но» остаются
    expect(verdictWith({ singles: 1.5, small: 2.6, px: 1.5 })).toEqual({ level: 'bad', issues: ['singles', 'blurry'] });
  });

  test('приговор по таблице: у порога — «подходит, но» (одиночных 0,8–1 %, мелких пятен 2,4–3 %), на самих границах — как в таблице', () => {
    expect(verdictWith({ singles: 1 })).toEqual({ level: 'warn', issues: ['nearConfetti'] });
    expect(verdictWith({ small: 3 })).toEqual({ level: 'warn', issues: ['nearConfetti'] });
    expect(verdictWith({ singles: 0.81 })).toEqual({ level: 'warn', issues: ['nearConfetti'] });
    expect(verdictWith({ small: 2.41 })).toEqual({ level: 'warn', issues: ['nearConfetti'] });
    expect(verdictWith({ singles: 0.8, small: 2.4 })).toEqual({ level: 'ok', issues: [] });
  });

  test('приговор по таблице: тёмная — больше половины клеток темнее L 0,3; мелкий снимок — меньше двух точек на клетку; две нити — почти одноцветная', () => {
    const dark = 0x161616;
    const light = 0xe8e2d0;
    expect(verdictWith({ rgbs: [dark, dark, light] })).toEqual({ level: 'warn', issues: ['dark'] });
    expect(verdictWith({ rgbs: [dark, dark, light, light] })).toEqual({ level: 'ok', issues: [] });
    expect(verdictWith({ px: 1.99 })).toEqual({ level: 'warn', issues: ['blurry'] });
    expect(verdictWith({ px: 2 })).toEqual({ level: 'ok', issues: [] });
    expect(verdictWith({ rgbs: [0xc0392b, 0x2e86c1] })).toEqual({ level: 'warn', issues: ['flat'] });
  });

  test('у каждой беды — совет из таблицы', () => {
    const advice: Record<Issue, string> = {
      singles: 'Сильнее упрощение, меньше нитей или больше клеток',
      small: 'Сильнее упрощение, меньше нитей или больше клеток',
      lonely: 'Меньше нитей',
      nearConfetti: 'Сильнее упрощение или меньше нитей — узор станет спокойнее',
      dark: 'кадр светлее',
      blurry: 'Меньше клеток',
      flat: 'другой кадр',
      smallMain: 'Больше клеток или кадр теснее',
    };
    for (const [issue, words] of Object.entries(advice)) expect(T.mine.issues[issue as Issue]).toContain(words);
  });

  test('карточка для библиотеки проходит проверку карточек', () => {
    expect(slugOf('Набережная Вятки')).toBe('naberezhnaya-vyatki');
    expect(slugOf('Зонтики в парке!')).toBe('zontiki-v-parke');
    const { id, yaml } = libraryCard({ title: 'Сирень у крыльца', crop: [0.1, 0.05, 0.9, 0.95], side: 120, threads: 24, now: new Date(2026, 8, 29) });
    expect(id).toBe('siren-u-kryltsa');
    const { card, errors } = readCard(cardFile(id, yaml));
    expect(errors).toEqual([]);
    expect(card?.pattern).toEqual({ crop: [0.1, 0.05, 0.9, 0.95], size: 120, threads: 24, ...MINE_GRID });
    expect(card?.source.basis).toContain('снимок автора игры');
    // упрощение переходит в карточку, «нет» — поля нет вовсе
    expect(libraryCard({ title: 'Сирень', crop: [0, 0, 1, 1], side: 70, threads: 16, simplify: 0, now: new Date(2026, 8, 29) }).yaml).not.toContain('simplify');
    const strong = libraryCard({ title: 'Сирень', crop: [0, 0, 1, 1], side: 70, threads: 16, simplify: 2, now: new Date(2026, 8, 29) });
    const read = readCard(cardFile(strong.id, strong.yaml));
    expect(read.errors).toEqual([]);
    expect(read.card?.pattern?.simplify).toBe(2);
    expect(readCard(cardFile('bad', strong.yaml.replace('simplify: 2', 'simplify: 3'))).errors.join()).toContain('pattern.simplify');
    // главное и фон переходят в карточку; фон без главного — ошибка карточки
    const oval = libraryCard({ title: 'Сирень', crop: [0, 0, 1, 1], side: 120, threads: 24, main: [0.3, 0.2, 0.7, 0.8], background: 'none', now: new Date(2026, 10, 1) });
    const ovalCard = readCard(cardFile(oval.id, oval.yaml));
    expect(ovalCard.errors).toEqual([]);
    expect(ovalCard.card?.pattern?.main).toEqual([0.3, 0.2, 0.7, 0.8]);
    expect(ovalCard.card?.pattern?.background).toBe('none');
    expect(readCard(cardFile('bad', oval.yaml.replace(/^ {2}main: .*$/m, ''))).errors.join()).toContain('pattern.background');
    // несколько овалов (0.24.0, «Найти лица») — списком рамок; один — рамкой, как до 0.24.0; больше шести — ошибка
    const two = libraryCard({ title: 'Сёстры', crop: [0, 0, 1, 1], side: 120, threads: 24, main: [[0.2, 0.2, 0.4, 0.5], [0.6, 0.25, 0.8, 0.55]], now: new Date(2026, 10, 1) });
    const twoCard = readCard(cardFile(two.id, two.yaml));
    expect(twoCard.errors).toEqual([]);
    expect(twoCard.card?.pattern?.main).toEqual([[0.2, 0.2, 0.4, 0.5], [0.6, 0.25, 0.8, 0.55]]);
    expect(libraryCard({ title: 'Сирень', crop: [0, 0, 1, 1], side: 120, threads: 24, main: [[0.3, 0.2, 0.7, 0.8]], now: new Date(2026, 10, 1) }).yaml)
      .toContain('  main: [0.3, 0.2, 0.7, 0.8]');
    const seven = two.yaml.replace(/^ {2}main: .*$/m, `  main: [${Array.from({ length: 7 }, () => '[0.2, 0.2, 0.4, 0.5]').join(', ')}]`);
    expect(readCard(cardFile('bad', seven)).errors.join()).toContain('pattern.main');
    expect(readCard(cardFile('bad', two.yaml.replace(/^ {2}main: .*$/m, '  main: []'))).errors.join()).toContain('pattern.main');
  });

  test('снимок с телефона: трава в точку не пестрит узор — кадр до сетки усредняется до 4 × 4 точек на клетку (0.18.2)', () => {
    // луг под небом: светлые и тёмные травинки поровну, вперемешку по точке — так выглядит снимок в
    // 12 Мп и больше, уменьшенный до 2000 точек: на клетку «средней» — два десятка точек, и какой
    // травы в клетке больше, решает случай
    const grass = (x: number, y: number) => {
      if (y < 0.4) return 0x9cc3e6;
      let a = Math.floor(y * 1050) * 1400 + Math.floor(x * 1400);
      a = Math.imul(a ^ (a >>> 16), 0x45d9f3b);
      a = Math.imul(a ^ (a >>> 16), 0x45d9f3b);
      return (a ^ (a >>> 16)) & 1 ? 0x8fbf4a : 0x2f5a1c;
    };
    const r = photo(1400, 1050, grass);
    const o = { crop: [0, 0, 1, 1] as Crop, side: 70, threads: 16 };
    /** доля соседних клеток луга с разной нитью */
    const motley = (p: Pattern) => {
      let diff = 0, all = 0;
      for (let y = Math.ceil(p.h * 0.45); y < p.h; y++) {
        for (let x = 0; x + 1 < p.w; x++) {
          all++;
          if (p.cells[y * p.w + x] !== p.cells[y * p.w + x + 1]) diff++;
        }
      }
      return diff / all;
    };
    const now = buildMine(r, o);
    // прежняя сборка — та же, только без усреднения: цвет клетки — по отдельным точкам
    const { px: _px, ...before } = MINE_GRID;
    const old = buildPattern(photoGrid(r, { crop: o.crop, size: o.side, ...before }), { id: MINE_SEED, v: 1, threads: o.threads, clean: SIMPLIFY_CLEAN[0] }).pattern;
    expect(motley(old)).toBeGreaterThan(0.2);
    expect(motley(now.pattern)).toBeLessThan(motley(old) / 4);
    // ни одиночных, ни мелких пятен; «почти одноцветная» — да: у неба и луга по нити
    expect(now.verdict.issues).toEqual(['flat']);
    // небо и луг — по-прежнему разные: граница пятен остаётся
    expect(now.pattern.cells[0]).not.toBe(now.pattern.cells[now.pattern.cells.length - 1]);
  });

  test('упрощение: пёстрая листва без него рассыпается, с ним — ровные пятна', () => {
    // четыре точки на клетку: усреднять нечего, пятна листвы — чуть больше клетки
    const r = photo(280, 210, leaves);
    const plain = buildMine(r, { crop: [0, 0, 1, 1], side: 70, threads: 16 });
    expect(plain.checked.stats.small).toBeGreaterThan(2);
    // «нет» — та же сборка, что и без настройки
    expect(Buffer.from(buildMine(r, { crop: [0, 0, 1, 1], side: 70, threads: 16, simplify: 0 }).pattern.cells).equals(Buffer.from(plain.pattern.cells))).toBe(true);
    expect(plain.verdict.level).toBe('bad');
    for (const simplify of [1, 2] as const) {
      const m = buildMine(r, { crop: [0, 0, 1, 1], side: 70, threads: 16, simplify });
      expect(m.checked.stats.singles).toBe(0);
      expect(m.checked.stats.small).toBe(0);
      expect(m.verdict.level).toBe('ok');
    }
  });
});
