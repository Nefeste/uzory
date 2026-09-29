// Свой узор (docs/specs/2026-09-custom.md): снимок → узор той же сборкой, что у библиотеки,
// и приговор — подходит, подходит с оговорками или не подходит, и что поправить.
import { rgbToLab } from '../color';
import type { Pattern } from '../pattern';
import { type Checked, checkPatternWith, DARK_L, DARK_SHARE } from './checks';
import { type Raster, toGrid } from './grid';
import { type BuildLog, buildPattern } from './palette';

/** Размер по длинной стороне, клеток: малая, средняя, большая, огромная. */
export const MINE_SIZES = { S: 40, M: 70, L: 120, XL: 200 } as const;
/** Пределы длинной стороны, клеток. */
export const MINE_SIDE: [number, number] = [20, 300];
/** Меньше стольких точек снимка на клетку — узор размыт. */
export const MINE_BLURRY = 2;

/** Сколько нитей заказать: верх середины диапазона размера (docs/08-game-design.md). */
export function defaultThreads(side: number): number {
  return side <= 50 ? 8 : side <= 90 ? 16 : side <= 150 ? 24 : 32;
}

/**
 * Что не так: `singles`, `small`, `lonely` — не подходит (§6 docs/09-content.md);
 * остальное — подходит, но: `nearConfetti` — у порога, `dark` — тёмная картинка,
 * `blurry` — снимок мелкий для размера, `flat` — почти одноцветная.
 */
export type Issue = 'singles' | 'small' | 'lonely' | 'nearConfetti' | 'dark' | 'blurry' | 'flat';

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

/** Узор из кадра `crop` (доли снимка): длинная сторона — `side` клеток. */
export function buildMine(r: Raster, o: { crop: Crop; side: number; threads: number }): MineBuild {
  const grid = toGrid(r, o.crop, o.side);
  const { pattern, log } = buildPattern(grid, { id: MINE_SEED, v: 1, threads: o.threads });
  const checked = checkPatternWith(pattern);
  const pxPerCell = Math.min(((o.crop[2] - o.crop[0]) * r.width) / grid.w, ((o.crop[3] - o.crop[1]) * r.height) / grid.h);
  return { pattern, log, checked, verdict: verdictOf(pattern, checked, pxPerCell), pxPerCell };
}

export function verdictOf(p: Pattern, checked: Checked, pxPerCell: number): Verdict {
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
export function libraryCard(o: { title: string; crop: Crop; side: number; threads: number; now: Date }): { id: string; yaml: string } {
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
    '',
  ].join('\n');
  return { id, yaml };
}
