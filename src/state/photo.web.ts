// Снимок для своего узора в браузере (docs/specs/2026-09-custom.md): файл с компьютера →
// растр RGB не больше 2000 точек по длинной стороне. Снимок никуда не уходит: он живёт
// в памяти вкладки, а картинка для показа и выгрузки — уменьшенная копия, перекодированная
// заново: EXIF с координатами съёмки в неё не попадает.
import type { Raster } from '../engine/build/grid';

export const PHOTO_PICK = true;
/** Длинная сторона снимка, точек: как у исходников библиотеки (docs/09-content.md, §3). */
const MAX_SIDE = 2000;

export interface Photo {
  raster: Raster;
  /** адрес уменьшенной копии для показа */
  uri: string;
  /** имя файла без расширения */
  name: string;
  /** уменьшенная копия в JPEG — для карточки библиотеки */
  jpeg: Blob;
}

export class PhotoError extends Error {}

/** Открывает выбор файла; отказался — null; не картинка — PhotoError. */
export function pickPhoto(): Promise<Photo | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    input.setAttribute('data-testid', 'mine-file');
    const done = () => input.remove();
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      done();
      if (!file) {
        resolve(null);
        return;
      }
      decodePhoto(file).then(resolve, reject);
    });
    input.addEventListener('cancel', () => {
      done();
      resolve(null);
    });
    document.body.appendChild(input);
    input.click();
  });
}

async function decodePhoto(file: File): Promise<Photo> {
  let bmp: ImageBitmap;
  try {
    // поворот по EXIF — как у sharp().rotate() в сборке библиотеки
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new PhotoError(file.name);
  }
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k));
  const h = Math.max(1, Math.round(bmp.height * k));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new PhotoError(file.name);
  // прозрачное — на белом, как бумага
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const data = new Uint8Array(w * h * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    data[j] = rgba[i];
    data[j + 1] = rgba[i + 1];
    data[j + 2] = rgba[i + 2];
  }
  const jpeg = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new PhotoError(file.name))), 'image/jpeg', 0.9));
  return { raster: { width: w, height: h, data }, uri: URL.createObjectURL(jpeg), name: file.name.replace(/\.[^.]+$/, ''), jpeg };
}

/** Отдаёт файлы на скачивание — по одному, как если бы по каждому нажали «Сохранить». */
export function downloadFiles(files: { name: string; data: Blob }[]): void {
  for (const f of files) {
    const url = URL.createObjectURL(f.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = f.name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

export const textBlob = (s: string) => new Blob([s], { type: 'text/yaml;charset=utf-8' });
