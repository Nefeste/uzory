// Сетка снимка (docs/specs/2026-09-content-pipeline.md, шаг 4): кадр → клетки → упрощение →
// насыщенность. Одна и та же у карточки библиотеки (tools/content/build.ts) и у «Своего узора»
// (./mine.ts): карточка, скачанная из «Своего узора», собирается тем же узором.
import { saturate, toGridDominant } from './dominant';
import { type Grid, type Raster, toGrid } from './grid';
import { type Simplify, simplifyGrid } from './simplify';

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
}

/** Сетка кадра: цвет клеток, упрощение, насыщенность — в этом порядке. */
export function photoGrid(r: Raster, p: PhotoSpec): Grid {
  const crop = p.crop ?? [0, 0, 1, 1];
  const grid = simplifyGrid(p.grid === 'dominant' ? toGridDominant(r, crop, p.size) : toGrid(r, crop, p.size), p.simplify ?? 0);
  return p.chroma !== undefined && p.chroma !== 1 ? saturate(grid, p.chroma) : grid;
}
