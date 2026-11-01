// Сетка снимка (docs/specs/2026-09-content-pipeline.md, шаг 4): кадр → усреднение → сглаживание →
// клетки → упрощение (вне главного) → насыщенность → тон → фон вне главного. Одна и та же у карточки библиотеки (tools/content/build.ts) и у «Своего узора»
// (./mine.ts): карточка, скачанная из «Своего узора», собирается тем же узором.
import { saturate, toGridDominant } from './dominant';
import { type Grid, type Raster, toGrid } from './grid';
import { type Background, keepInside, ovalMask, withBackground } from './main';
import { type Simplify, simplifyGrid } from './simplify';
import { averageRaster, type Smooth, smoothRaster } from './smooth';
import { toneGrid } from './tone';

/** Поля `pattern` карточки, от которых зависит сетка снимка (tools/content/cards.ts). */
export interface PhotoSpec {
  /** кадр в долях снимка: левый, верхний, правый, нижний край; без поля — весь снимок */
  crop?: [number, number, number, number];
  /** клеток по длинной стороне */
  size: number;
  /** цвет клетки: `mean` — среднее по её площади (так и без поля), `dominant` — преобладающий */
  grid?: 'mean' | 'dominant';
  /** насыщенность: хрома ×chroma; 1 и без поля — как на снимке */
  chroma?: number;
  simplify?: Simplify;
  /**
   * сглаживание с сохранением деталей (./smooth.ts): 1 — упрощение по клеткам, 2 — ещё и сдвиг
   * среднего на снимке до клеток; вместо `simplify`, чистка — с охраной (buildGuarded)
   */
  smooth?: Smooth;
  /** тон выцветшего снимка (./tone.ts), сила 0,1…1; без поля — как на снимке */
  tone?: number;
  /**
   * точек на клетку: до сетки кадр усредняется по площади до px × px точек на клетку
   * (./smooth.ts, averageRaster) — зерно и мелкая фактура не пестрят узор; без поля — как есть
   */
  px?: number;
  /**
   * главное — овал, вписанный в рамку (доли снимка, как `crop`; ./main.ts): в нём нет упрощения, а
   * сборка палитры даёт ему свои нити и бережную чистку, как лицам (`focus`)
   */
  main?: [number, number, number, number];
  /** фон вне главного: `one` — одной нитью, `none` — не вышивать; без поля — как есть */
  background?: Background;
}

/** Сетка кадра: усреднение и сглаживание снимка, цвет клеток, упрощение, насыщенность, тон — в этом порядке. */
export function photoGrid(r0: Raster, p: PhotoSpec): Grid {
  const avg = p.px ? averageRaster(r0, p.crop ?? [0, 0, 1, 1], p.size, p.px) : { raster: r0, crop: p.crop ?? [0, 0, 1, 1] };
  const { raster: r, crop } = smoothRaster(avg.raster, avg.crop, p.size, p.smooth ?? 0);
  const cells = p.grid === 'dominant' ? toGridDominant(r, crop, p.size) : toGrid(r, crop, p.size);
  const simple = simplifyGrid(cells, p.smooth ? 1 : p.simplify ?? 0);
  // главное — без упрощения: зрачок и блик в клетку не смешиваются с кожей ещё до чистки
  const main = p.main ? ovalMask(p.crop ?? [0, 0, 1, 1], cells.w, cells.h, p.main) : undefined;
  const grid = main ? keepInside(simple, cells, main) : simple;
  const saturated = p.chroma !== undefined && p.chroma !== 1 ? saturate(grid, p.chroma) : grid;
  const toned = p.tone ? toneGrid(saturated, p.tone) : saturated;
  return main && p.background ? withBackground(toned, main, p.background) : toned;
}

/** Главное узора — клетки овала `main` в сетке `grid` кадра `crop` (сборке палитры — как лица, `focus`). */
export const mainMask = (p: Pick<PhotoSpec, 'crop' | 'main'>, grid: { w: number; h: number }): Uint8Array | undefined =>
  p.main ? ovalMask(p.crop ?? [0, 0, 1, 1], grid.w, grid.h, p.main) : undefined;
