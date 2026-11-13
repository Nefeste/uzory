// «Светлица» (1.1.0, docs/specs/2026-11-svetlitsa.md): готовые работы → раскладка стен (src/engine/gallery.ts) и
// стена картинкой (src/render/gallery.ts). Общее у экрана «Светлица» и карточки на главной.
import type { SkFont } from '@shopify/react-native-skia';
import { BIG_CELLS, frameFor, hangWalls, type HangItem, type WallPlan } from '../engine/gallery';
import { clothRgb, FRAMES, lookOwned, type WallLook } from '../engine/looks';
import type { Looks } from '../state/looks';
import type { HungWork } from '../state/svetlitsa';
import { type Piece, wallImage, wallUri } from './gallery';
import { previewImage } from './preview';

/** Картинка работы на стене — не больше стольких точек по длинной стороне: дальше глаз не различит клеток. */
const PICTURE_PX = 420;

const hex = (rgb: number) => `#${rgb.toString(16).padStart(6, '0')}`;

/** Работы → раскладка стен и что на них нарисовать. */
export function wallsOf(works: readonly HungWork[], looks: Looks, W: number, H: number): { walls: WallPlan[]; pieces: Map<string, Piece> } {
  const frames = FRAMES.filter((f) => lookOwned(f.id, looks.owned, looks.open)).map((f) => f.id);
  const looksOf = new Map(works.map((w) => [w.id, frameFor(w.id, frames)]));
  const items: HangItem[] = works.map((w) => ({
    id: w.id, w: w.pattern.w, h: w.pattern.h, hoop: looksOf.get(w.id)!.kind === 'hoop', big: w.pattern.w * w.pattern.h > BIG_CELLS,
  }));
  const walls = hangWalls(items, W, H);
  const pieces = new Map<string, Piece>();
  for (const wall of walls) {
    for (const hung of wall.items) {
      const w = works.find((x) => x.id === hung.id)!;
      pieces.set(hung.id, {
        hung, look: looksOf.get(hung.id)!, mat: looks.mat, cloth: hex(clothRgb(w.canvas)), w: w.pattern.w, h: w.pattern.h, title: w.title,
        // картинка рисуется, когда стена понадобилась (`picturesOf`)
        picture: null,
      });
    }
  }
  return { walls, pieces };
}

/** Картинки работ одной стены — перед её рисованием. */
export function picturesOf(wall: WallPlan, pieces: Map<string, Piece>, works: readonly HungWork[], k: number): Piece[] {
  return wall.items.map((hung) => {
    const p = pieces.get(hung.id)!;
    if (!p.picture) {
      const w = works.find((x) => x.id === hung.id)!;
      p.picture = previewImage(w.pattern, Math.min(PICTURE_PX, Math.ceil(Math.max(hung.frame.w, hung.frame.h) * k)), clothRgb(w.canvas));
    }
    return p;
  });
}

/** Одна стена картинкой (data: URI); `skip` — работа, которая повиснет отдельно. */
export function wallPicture(o: { plan: WallPlan; pieces: Map<string, Piece>; works: readonly HungWork[]; W: number; H: number; k: number; wall: WallLook; font: SkFont | null; skip?: string }): string | null {
  return wallUri(wallImage({ W: o.W, H: o.H, k: o.k, wall: o.wall, pieces: picturesOf(o.plan, o.pieces, o.works, o.k), font: o.font, skip: o.skip }));
}

