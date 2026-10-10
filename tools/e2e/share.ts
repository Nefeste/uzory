// Картинка «Поделиться» глазами сценария (docs/specs/2026-09-library.md, «Готово» и критерий приёмки 3):
// скачанный PNG разбирается по той же раскладке, по которой его рисует приложение
// (src/engine/share.ts): размер, фон, рамка и паспарту, выбранный стиль в клетках работы, строки
// подписи под рамкой.
import sharp from 'sharp';
import { CANVAS, type Pattern } from '../../src/engine/pattern';
import { SHARE_COLORS, SHARE_STITCHES_FROM, shareLayout } from '../../src/engine/share';

type RGB = [number, number, number];
const hexRgb = (hex: string): RGB => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const threadRgb = (n: number): RGB => [(n >> 16) & 255, (n >> 8) & 255, n & 255];
const dist = (a: RGB, b: RGB) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** Канва под крестиками — `CLOTH` шейдера (src/canvas/shader.ts). */
const CLOTH: RGB = [243, 240, 230];

export interface ShareLook {
  /** размер — по раскладке */
  size: boolean;
  /** фон, рамка и паспарту — на своих местах и своего цвета */
  frame: boolean;
  /** клетка не меньше SHARE_STITCHES_FROM — шейдер рисует стежки, и стили различимы */
  stitches: boolean;
  /** вышитых клеток, чья нить заметно отличается от канвы: на них стиль виден */
  cells: number;
  /** из них — крестиком: у середины стороны клетки — канва, в середине — нить */
  cross: number;
  /** из них — плиткой: и у середины стороны, и в середине — ровно нить */
  tile: number;
  /** точек цвета каждой строки подписи в её полосе */
  lines: { title: number; caption: number; mark: number };
}

/**
 * Стиль вышитых клеток на картинке: работа с точки (`x0`, `y0`), клетка — `c` точек. «Крестиком» — у
 * середины верхней стороны клетки канва, в середине нить; «плиткой» — и там и там ровно нить. Клетки,
 * чья нить почти как канва, не в счёт: на них стиль не виден.
 */
export function stitchStyles(p: Pattern, px: (x: number, y: number) => RGB, x0: number, y0: number, c: number) {
  let cells = 0;
  let cross = 0;
  let tile = 0;
  for (let i = 0; i < p.cells.length; i++) {
    if (p.cells[i] === CANVAS) continue;
    const col = threadRgb(p.threads[p.cells[i]].rgb);
    if (dist(col, CLOTH) < 48) continue;
    cells++;
    const x = x0 + ((i % p.w) + 0.5) * c;
    const top = y0 + Math.floor(i / p.w) * c;
    const mid = px(x, top + 0.5 * c);
    const edge = px(x, top + 0.12 * c);
    if (dist(edge, CLOTH) <= 24 && dist(mid, col) <= 36) cross++;
    if (dist(edge, col) <= 4 && dist(mid, col) <= 4) tile++;
  }
  return { cells, cross, tile };
}

/** Разбор PNG законченной работы узора `p`. */
export async function lookAtShare(png: Uint8Array, p: Pattern): Promise<ShareLook> {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const L = shareLayout(p.w, p.h);
  const px = (x: number, y: number): RGB => {
    const i = (Math.floor(y) * info.width + Math.floor(x)) * info.channels;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const is = (x: number, y: number, hex: string) => dist(px(x, y), hexRgb(hex)) <= 2;
  const size = info.width === L.width && info.height === L.height;
  const frame = size
    && is(L.frame.x / 2, L.frame.y / 2, SHARE_COLORS.background)
    && is(L.width - L.frame.x / 2, L.height - 4, SHARE_COLORS.background)
    && is((L.frame.x + L.mat.x) / 2, L.frame.y + L.frame.h / 2, SHARE_COLORS.frame)
    && is(L.frame.x + L.frame.w / 2, (L.frame.y + L.mat.y) / 2, SHARE_COLORS.frame)
    && is((L.mat.x + L.work.x) / 2, L.mat.y + L.mat.h / 2, SHARE_COLORS.mat)
    && is(L.mat.x + L.mat.w / 2, (L.mat.y + L.work.y) / 2, SHARE_COLORS.mat);

  const { cells, cross, tile } = size ? stitchStyles(p, px, L.work.x, L.work.y, L.cell) : { cells: 0, cross: 0, tile: 0 };

  // строка подписи — точки её цвета в полосе от верха заглавных букв до низа выносных
  const ink = (base: number, hex: string) => {
    if (!size) return 0;
    const want = hexRgb(hex);
    let n = 0;
    for (let y = Math.max(0, base - 34); y < Math.min(L.height, base + 9); y++) {
      for (let x = 0; x < L.width; x++) if (dist(px(x, y), want) <= 40) n++;
    }
    return n;
  };
  const caption = ink(L.caption, SHARE_COLORS.caption);
  return {
    size,
    frame,
    stitches: L.cell >= SHARE_STITCHES_FROM,
    cells,
    cross,
    tile,
    lines: {
      title: ink(L.title, SHARE_COLORS.title),
      caption,
      mark: Math.max(ink(L.mark, SHARE_COLORS.mark), ink(L.markAlone, SHARE_COLORS.mark)),
    },
  };
}
