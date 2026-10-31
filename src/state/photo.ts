// Снимок для своего узора на телефоне (docs/specs/2026-09-custom.md; решение владельца 31.10.2026,
// issue 118, вариант В): системный выбор фото → растр RGB не больше 2000 точек по длинной стороне.
// Выбор фото — системный (Android Photo Picker; где его нет — системное окно файлов): игра видит
// только выбранный снимок и не просит разрешения на все фото — его и нет в APK (app.json,
// blockedPermissions). Поворот по EXIF Skia делает сама, когда читает снимок. Копию, которую выбор
// фото кладёт в кэш игры, игра стирает сразу после чтения: снимок не хранится, остаётся только узор.
// В вебе — src/state/photo.web.ts.
import { AlphaType, ColorType, FilterMode, ImageFormat, MipmapMode, Skia } from '@shopify/react-native-skia';
import { File } from 'expo-file-system';
import { launchImageLibraryAsync } from 'expo-image-picker';
import type { Raster } from '../engine/build/grid';
import { logError } from './crashlog';

export const PHOTO_PICK = true;
/** Длинная сторона снимка, точек: как у исходников библиотеки (docs/09-content.md, §3) и в вебе. */
const MAX_SIDE = 2000;

export interface Photo {
  raster: Raster;
  /** уменьшенная копия для показа — в памяти, data: URI */
  uri: string;
  /** имя файла без расширения */
  name: string;
  /** уменьшенная копия в JPEG для карточки библиотеки — только в веб-версии владельца */
  jpeg: Blob | null;
}

export class PhotoError extends Error {}

/** Открывает системный выбор фото; отказался — null; не картинка — PhotoError. */
export async function pickPhoto(): Promise<Photo | null> {
  const r = await launchImageLibraryAsync({ mediaTypes: 'images', quality: 1 });
  if (r.canceled || !r.assets?.length) return null;
  const a = r.assets[0];
  try {
    return await decodePhoto(a.uri, a.fileName ?? '');
  } finally {
    forget(a.uri);
  }
}

/** Стирает копию снимка из кэша игры. */
function forget(uri: string) {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch (e) {
    logError('mine', e, 'photo cache');
  }
}

async function decodePhoto(uri: string, fileName: string): Promise<Photo> {
  const img = Skia.Image.MakeImageFromEncoded(await Skia.Data.fromURI(uri));
  if (!img) throw new PhotoError(fileName);
  const k = Math.min(1, MAX_SIDE / Math.max(img.width(), img.height()));
  const w = Math.max(1, Math.round(img.width() * k));
  const h = Math.max(1, Math.round(img.height() * k));
  const surface = Skia.Surface.Make(w, h);
  if (!surface) throw new PhotoError(fileName);
  const canvas = surface.getCanvas();
  // прозрачное — на белом, как бумага (и в вебе)
  canvas.drawColor(Skia.Color('white'));
  // уменьшение с мип-картами: без них у снимка в 12 Мп мелкий узор (листва, ткань) рябит
  canvas.drawImageRectOptions(img, Skia.XYWHRect(0, 0, img.width(), img.height()), Skia.XYWHRect(0, 0, w, h), FilterMode.Linear, MipmapMode.Linear);
  surface.flush();
  const snap = surface.makeImageSnapshot();
  const rgba = snap.readPixels(0, 0, { width: w, height: h, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
  if (!(rgba instanceof Uint8Array) || rgba.length < w * h * 4) throw new PhotoError(fileName);
  const data = new Uint8Array(w * h * 3);
  for (let i = 0, j = 0; j < data.length; i += 4, j += 3) {
    data[j] = rgba[i];
    data[j + 1] = rgba[i + 1];
    data[j + 2] = rgba[i + 2];
  }
  const jpeg = snap.encodeToBase64(ImageFormat.JPEG, 90);
  return { raster: { width: w, height: h, data }, uri: `data:image/jpeg;base64,${jpeg}`, name: fileName.replace(/\.[^.]+$/, ''), jpeg: null };
}

/** Карточка для библиотеки — только в веб-версии владельца. */
export function downloadFiles(_files: { name: string; data: Blob }[]): void {}

export const textBlob = (s: string) => new Blob([s]);
