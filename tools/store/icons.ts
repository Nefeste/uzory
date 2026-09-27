// Иконка «Узоров» — нарисована кодом тем же шейдером, что канва: ромб крестиком на льне
// (docs/08-game-design.md, «Вид»: всё, кроме снимков для магазина, рисуется кодом).
//
//   bun tools/store/icons.ts   → assets/icon.png, android-icon-foreground.png,
//                                android-icon-monochrome.png, favicon.png, store/graphics/icon-512.png
import { join } from 'node:path';
import sharp from 'sharp';
import { CANVAS, type Pattern } from '../../src/engine/pattern';
import { renderFrame } from '../canvas/ck';
import { fromGrid } from '../content/ornaments';

const ROOT = join(import.meta.dir, '..', '..');

/** Ромб в ромбе: кумач, лён и ель — цвета сайта студии. Поля — канва. */
const GRID = `
...............
.......k.......
......kkk......
.....kk.kk.....
....kk.l.kk....
...kk.lll.kk...
..kk.llell.kk..
.kk.lleeell.kk.
..kk.llell.kk..
...kk.lll.kk...
....kk.l.kk....
.....kk.kk.....
......kkk......
.......k.......
...............`;

export function iconPattern(): Pattern {
  const d = fromGrid(GRID.trim(), ['k', 'l', 'e']);
  return {
    key: 'icon@1', w: d.w, h: d.h, cells: d.cells,
    threads: [{ rgb: 0xb3162f, name: 'кумачовая' }, { rgb: 0xa8904f, name: 'льняная' }, { rgb: 0x1f3c34, name: 'еловая' }],
  };
}

/** Кадр иконки: узор целиком, клетки вышиты; поля — `pad` клеток канвы вокруг. */
export async function iconPng(size: number, pad = 0): Promise<Buffer> {
  const p = iconPattern();
  const n = p.w + pad * 2;
  const s = size / n;
  const f = await renderFrame(p, new Uint8Array(p.cells.length).fill(1), { width: size, height: size, s, tx: pad * s, ty: pad * s, near: true });
  return sharp(Buffer.from(f.png())).png().toBuffer();
}

/** Силуэт для монохромной иконки Android 13+: вышитые клетки — белым, остальное прозрачно. */
async function monochrome(size: number, pad: number): Promise<Buffer> {
  const p = iconPattern();
  const n = p.w + pad * 2;
  const s = size / n;
  const f = await renderFrame(p, new Uint8Array(p.cells.length).fill(1), { width: size, height: size, s, tx: pad * s, ty: pad * s, near: true, mosaic: true });
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = Math.floor(x / s) - pad;
      const cy = Math.floor(y / s) - pad;
      const inside = cx >= 0 && cy >= 0 && cx < p.w && cy < p.h && p.cells[cy * p.w + cx] !== CANVAS;
      const o = (y * size + x) * 4;
      // зазор «Мозаики» оставляет клетки раздельными и в силуэте
      const a = inside && f.pixels[o] + f.pixels[o + 1] + f.pixels[o + 2] < 3 * 215 ? 255 : 0;
      out[o] = out[o + 1] = out[o + 2] = 255;
      out[o + 3] = a;
    }
  }
  return sharp(out, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
}

if (import.meta.main) {
  const a = join(ROOT, 'assets');
  await sharp(await iconPng(1024)).toFile(join(a, 'icon.png'));
  // адаптивная иконка: безопасная зона — круг 66 % в центре, поэтому поля шире
  await sharp(await iconPng(1024, 5)).toFile(join(a, 'android-icon-foreground.png'));
  await sharp(await monochrome(1024, 5)).toFile(join(a, 'android-icon-monochrome.png'));
  await sharp(await iconPng(1024)).resize(48, 48).toFile(join(a, 'favicon.png'));
  await sharp(await iconPng(1024)).resize(512, 512).removeAlpha().toFile(join(ROOT, 'store', 'graphics', 'icon-512.png'));
  console.log('иконки готовы');
}
