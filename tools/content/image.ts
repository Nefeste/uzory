// Исходник для сборки (docs/specs/2026-09-content-pipeline.md, шаг 2): sharp читает файл —
// поворот по EXIF, перевод в sRGB. Кадр и сетка — src/engine/build/grid.ts, общие со своим
// узором в приложении.
import sharp from 'sharp';
import type { Raster } from '../../src/engine/build/grid';

export { type Grid, type Raster, toGrid } from '../../src/engine/build/grid';

export async function decode(file: string): Promise<Raster> {
  const { data, info } = await sharp(file).rotate().toColourspace('srgb').removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 3) throw new Error(`${file}: ${info.channels} канала вместо 3`);
  return { width: info.width, height: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.length) };
}

