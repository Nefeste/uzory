// Свой узор (docs/specs/2026-09-custom.md): снимок → узор той же сборкой, что у библиотеки,
// и приговор — подходит, подходит с оговорками или не подходит, и что поправить.
import { rgbToLab } from '../color';
import type { Pattern } from '../pattern';
import { type Checked, checkPatternWith, DARK_L, DARK_SHARE } from './checks';
import { mainThreads } from './focus';
import type { Raster } from './grid';
import { type BuildLog, buildPattern } from './palette';
import { type Background, mainRects, ovalMask } from './main';
import { mainMask, photoGrid } from './photo';
import { type Simplify, SIMPLIFY_CLEAN } from './simplify';

/** Размер по длинной стороне, клеток: малая, средняя, большая, огромная. */
export const MINE_SIZES = { S: 40, M: 70, L: 120, XL: 200 } as const;
/**
 * Пределы длинной стороны, клеток. До 500 — с 0.19.0 (владелец 01.11.2026: «установить, например, сразу
 * 500»): у картин библиотеки до 480; на телефоне такой узор собирается секунды, поэтому свой размер и нити
 * вводятся числом и собираются по «Применить», а не на каждое нажатие.
 */
export const MINE_SIDE: [number, number] = [20, 500];
/** Пределы нитей своего узора: у «огромной» по проверкам — до 45 (src/engine/build/checks.ts, SIZES). */
export const MINE_THREADS: [number, number] = [3, 45];
/** Меньше стольких точек снимка на клетку — узор размыт. */
export const MINE_BLURRY = 2;
/**
 * Сетка своего узора — как у снимков библиотеки (поля `pattern` их карточек, docs/09-content.md, §4;
 * с 15.10.2026, просьба владельца): цвет клетки — преобладающий, а не среднее, и насыщенность ×1,15 —
 * у снимка нитей мало, и бледные цвета тратят их впустую. С 0.18.2 кадр до сетки усредняется до 4 × 4
 * точек на клетку (просьба владельца 31.10.2026: снимок с телефона в высоком разрешении давал
 * «ужасное качество»): зерно и фактура не пестрят узор, а сборка не медленнее прежней — преобладающий
 * цвет ищется по 16 точкам клетки, а не по сотне.
 */
export const MINE_GRID = { grid: 'dominant', chroma: 1.15, px: 4 } as const;

/** Сколько нитей заказать: верх середины диапазона размера (docs/08-game-design.md). */
export function defaultThreads(side: number): number {
  return side <= 50 ? 8 : side <= 90 ? 16 : side <= 150 ? 24 : 32;
}

/**
 * Что не так: `singles`, `small`, `lonely` — не подходит (§6 docs/09-content.md);
 * остальное — подходит, но: `nearConfetti` — у порога, `dark` — тёмная картинка,
 * `blurry` — снимок мелкий для размера, `flat` — почти одноцветная.
 */
export type Issue = 'singles' | 'small' | 'lonely' | 'nearConfetti' | 'dark' | 'blurry' | 'flat' | 'smallMain';

export interface Verdict {
  level: 'ok' | 'warn' | 'bad';
  issues: Issue[];
}

export interface MineBuild {
  pattern: Pattern;
  log: BuildLog;
  checked: Checked;
  verdict: Verdict;
  /** точек снимка на клетку по короткой из сторон */
  pxPerCell: number;
}

export type Crop = [number, number, number, number];

/**
 * Зерно сборки своего узора — одно на все: тот же снимок, кадр, размер и нити дают тот же
 * узор и тот же приговор. Свой ключ `mine-<id>@1` узор получает при сохранении (src/state/mine.ts).
 */
export const MINE_SEED = 'mine';

/** Что выбрано в «Своём узоре»: кадр, размер, нити, упрощение, главное и фон (src/screens/MineScreen.tsx). */
export interface MineOptions {
  crop: Crop;
  side: number;
  threads: number;
  simplify?: Simplify;
  /** главное — овал, вписанный в рамку (доли снимка, как кадр; ./main.ts), или несколько — по лицам (с 0.24.0) */
  main?: Crop | readonly Crop[];
  /** фон вне главного: одной нитью или не вышивать; без поля — как есть */
  background?: Background;
}

/**
 * Узор из кадра `crop` (доли снимка): длинная сторона — `side` клеток; `simplify` — упрощение. Главное
 * (с 0.19.0) — как лица на снимках библиотеки: своя маленькая палитра и бережная чистка (./focus.ts),
 * а упрощения в нём нет (./main.ts).
 */
export function buildMine(r: Raster, o: MineOptions): MineBuild {
  const level = o.simplify ?? 0;
  const spec = { crop: o.crop, size: o.side, ...MINE_GRID, simplify: level, ...(o.main ? { main: o.main, ...(o.background ? { background: o.background } : {}) } : {}) };
  const grid = photoGrid(r, spec);
  const focus = mainMask(spec, grid);
  // главному — половина нитей (./focus.ts, MAIN_SHARE; с 0.20.0)
  const { pattern, log } = buildPattern(grid, { id: MINE_SEED, v: 1, threads: o.threads, clean: SIMPLIFY_CLEAN[level], ...(focus ? { focus, focusCount: mainThreads(o.threads) } : {}) });
  // главное: одиночки и мелкие пятна в нём — замысел (глаза, блики, ноздри), в приговор не идут
  // (советы вышивальщиц и справка WinStitch, разбор статей 31.10.2026: «не стирать значимые одиночки»)
  const checked = checkPatternWith(pattern, focus ? { focus, skip: focus } : {});
  const pxPerCell = Math.min(((o.crop[2] - o.crop[0]) * r.width) / grid.w, ((o.crop[3] - o.crop[1]) * r.height) / grid.h);
  // «главному мало клеток» — по самому узкому овалу: у каждого лица своё
  const span = o.main ? Math.min(...mainRects(o.main).map((m) => { const k = ovalMask(o.crop, grid.w, grid.h, m); return k ? maskSpan(k, grid.w) : Infinity; })) : undefined;
  return { pattern, log, checked, verdict: verdictOf(pattern, checked, pxPerCell, focus && span !== undefined && Number.isFinite(span) ? span : undefined), pxPerCell };
}

/**
 * Главному мало клеток, если овал уже стольких (с 0.20.0; разбор статей 31.10.2026: «для лица 40 и 70
 * клеток мало» — в отзыве на Pattern Maker при 150 крестиках на всю картину глаза «слиплись», лицу крупным
 * планом вышивальщицы дают 140 × 190). Лицо «Грузинки» в овале шириной около 40 клеток на 120 — глаза, брови,
 * нос и губы в две-четыре клетки; уже — глаз становится одной клеткой.
 */
export const MAIN_MIN = 40;

/** Меньшая сторона овала в клетках: по ширине и по высоте — сколько столбцов и строк он занимает. */
export function maskSpan(mask: Uint8Array, w: number): number {
  let x0 = w, x1 = -1, y0 = Infinity, y1 = -1;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const x = i % w, y = Math.floor(i / w);
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return x1 < 0 ? 0 : Math.min(x1 - x0 + 1, y1 - y0 + 1);
}

/** `mainSpan` — меньшая сторона овала главного в клетках; нет главного — нет. */
export function verdictOf(p: Pattern, checked: Checked, pxPerCell: number, mainSpan?: number): Verdict {
  const s = checked.stats;
  const bad: Issue[] = [];
  const warn: Issue[] = [];
  if (s.singles > 1) bad.push('singles');
  if (s.small > 3) bad.push('small');
  if (s.lonely.length) bad.push('lonely');
  if (!bad.length && (s.singles > 0.8 || s.small > 2.4)) warn.push('nearConfetti');
  const dark = s.counts.reduce((sum, c, t) => sum + (rgbToLab(p.threads[t].rgb)[0] < DARK_L ? c : 0), 0) / Math.max(1, s.cells);
  if (dark > DARK_SHARE) warn.push('dark');
  if (pxPerCell < MINE_BLURRY) warn.push('blurry');
  if (p.threads.length <= 2) warn.push('flat');
  if (mainSpan !== undefined && mainSpan < MAIN_MIN) warn.push('smallMain');
  return { level: bad.length ? 'bad' : warn.length ? 'warn' : 'ok', issues: [...bad, ...warn] };
}

/** Клеток по сторонам для кадра: длинная — `side`, короткая — по пропорции (как toGrid). */
export function mineCells(r: { width: number; height: number }, crop: Crop, side: number): { w: number; h: number } {
  const cw = (crop[2] - crop[0]) * r.width;
  const ch = (crop[3] - crop[1]) * r.height;
  return cw >= ch ? { w: side, h: Math.max(1, Math.round((side * ch) / cw)) } : { w: Math.max(1, Math.round((side * cw) / ch)), h: side };
}

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/** Идентификатор карточки из названия: латиницей, через дефис («Набережная Вятки» → naberezhnaya-vyatki). */
export function slugOf(title: string): string {
  const t = [...title.toLowerCase()].map((c) => TRANSLIT[c] ?? c).join('');
  return t.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '') || 'snimok';
}

const dd = (n: number) => String(n).padStart(2, '0');
const round = (x: number) => Number(x.toFixed(4));

/**
 * Карточка библиотеки для своего снимка владельца (docs/09-content.md, §2, «Свои снимки»):
 * кадр, размер и нити — из инструмента; коллекция, место и дата съёмки — дописать руками.
 */
/** Овалы главного в карточке: один — рамкой, несколько — списком рамок. */
const mainYaml = (main: Crop | readonly Crop[]) => {
  const list = mainRects(main);
  const one = (m: Crop) => `[${m.map(round).join(', ')}]`;
  return list.length === 1 ? one(list[0]) : `[${list.map(one).join(', ')}]`;
};

export function libraryCard(o: { title: string; crop: Crop; side: number; threads: number; simplify?: Simplify; main?: Crop | readonly Crop[]; background?: Background; now: Date }): { id: string; yaml: string } {
  const id = slugOf(o.title);
  const day = `${dd(o.now.getDate())}.${dd(o.now.getMonth() + 1)}.${o.now.getFullYear()}`;
  const yaml = [
    `# Снимок владельца (docs/09-content.md, §2, «Свои снимки»): кадр, размер и нити выбраны`,
    `# в «Своём узоре» ${day}. Дописать: коллекцию, где и когда снято.`,
    `id: ${id}`,
    `title: "${o.title.replace(/["\\]/g, "")}"`,
    `collection: nature        # или cities`,
    `order: 0`,
    `made: "${o.now.getFullYear()}"`,
    `place: ""                 # где снято`,
    `source:`,
    `  file: ${id}.jpg`,
    `  url: ""`,
    `  basis: "снимок автора игры, <дата съёмки>, <место>"`,
    `pattern:`,
    `  crop: [${o.crop.map(round).join(', ')}]`,
    `  size: ${o.side}`,
    `  threads: ${o.threads}`,
    `  grid: ${MINE_GRID.grid}          # цвет клетки — преобладающий, как в «Своём узоре»`,
    `  chroma: ${MINE_GRID.chroma}            # насыщенность`,
    `  px: ${MINE_GRID.px}                 # точек на клетку: кадр до сетки усредняется, как в «Своём узоре»`,
    ...(o.simplify ? [`  simplify: ${o.simplify}       # упрощение: 1 — немного, 2 — сильно`] : []),
    ...(o.main ? [`  main: ${mainYaml(o.main)}   # главное — овал в этой рамке, доли снимка (несколько — списком)`] : []),
    ...(o.main && o.background ? [`  background: ${o.background}    # фон вне главного: one — одной нитью, none — не вышивать`] : []),
    '',
  ].join('\n');
  return { id, yaml };
}
