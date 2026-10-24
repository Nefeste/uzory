// Сетка снимка (docs/specs/2026-09-content-pipeline.md, шаг 4): кадр → сглаживание → клетки →
// упрощение → насыщенность → тон. Одна и та же у карточки библиотеки (tools/content/build.ts) и у «Своего узора»
// (./mine.ts): карточка, скачанная из «Своего узора», собирается тем же узором.
import { saturate, toGridDominant } from './dominant';
import { type Grid, type Raster, toGrid } from './grid';
import { type Simplify, simplifyGrid } from './simplify';
import { type Smooth, smoothRaster } from './smooth';
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
}

/** Сетка кадра: сглаживание снимка, цвет клеток, упрощение, насыщенность, тон — в этом порядке. */
export function photoGrid(r0: Raster, p: PhotoSpec): Grid {
  const { raster: r, crop } = smoothRaster(r0, p.crop ?? [0, 0, 1, 1], p.size, p.smooth ?? 0);
  const grid = simplifyGrid(p.grid === 'dominant' ? toGridDominant(r, crop, p.size) : toGrid(r, crop, p.size), p.smooth ? 1 : p.simplify ?? 0);
  const saturated = p.chroma !== undefined && p.chroma !== 1 ? saturate(grid, p.chroma) : grid;
  return p.tone ? toneGrid(saturated, p.tone) : saturated;
}
