// Снимок для своего узора на телефоне (docs/specs/2026-09-custom.md; решение владельца 31.10.2026,
// issue 118, вариант В): системный выбор фото → растр RGB не больше 2000 точек по длинной стороне.
// Выбор фото — системный (Android Photo Picker; где его нет — системное окно файлов): игра видит
// только выбранный снимок и не просит разрешения на все фото — его и нет в APK (app.json,
// blockedPermissions). Поворот по EXIF Skia делает сама, когда читает снимок. Копию, которую выбор
// фото кладёт в кэш игры, игра стирает сразу после чтения: снимок не хранится, остаётся только узор.
// В вебе — src/state/photo.web.ts.
import { AlphaType, ColorType, FilterMode, ImageFormat, MipmapMode, type SkImage, Skia } from '@shopify/react-native-skia';
import { File } from 'expo-file-system';
import { launchImageLibraryAsync } from 'expo-image-picker';
import type { Raster } from '../engine/build/grid';
import { shrinkSteps } from '../engine/build/shrink';
import { logError } from './crashlog';

export const PHOTO_PICK = true;
/** Длинная сторона снимка, точек: как у исходников библиотеки (docs/09-content.md, §3) и в вебе. */
const MAX_SIDE = 2000;
/** Длинная сторона копии для показа, точек: рамка кадра на телефоне — не шире экрана. */
const SHOW_SIDE = 1280;

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

/**
 * Открывает системный выбор фото; отказался — null; не картинка — PhotoError. `onOpen` — снимок
 * выбран и читается: снимок в 50 Мп читается секунды, и экран говорит, что занят.
 */
export async function pickPhoto(onOpen?: () => void): Promise<Photo | null> {
  const r = await launchImageLibraryAsync({ mediaTypes: 'images', quality: 1 });
  if (r.canceled || !r.assets?.length) return null;
  const a = r.assets[0];
  onOpen?.();
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

/**
 * Снимок, уменьшенный до w × h: половинками, последний шаг — меньше чем вдвое (src/engine/build/shrink.ts —
 * почему: мип-карт у drawImageRectOptions в RN Skia нет, и одно уменьшение в четыре раза давало рябь).
 */
function shrink(img: SkImage, w: number, h: number, fileName: string): SkImage {
  const steps = shrinkSteps(img.width(), img.height(), w, h);
  let src = img;
  try {
    steps.forEach(([tw, th], i) => {
      const last = i === steps.length - 1;
      const surface = Skia.Surface.Make(tw, th);
      if (!surface) throw new PhotoError(fileName);
      const canvas = surface.getCanvas();
      // прозрачное — на белом, как бумага (и в вебе); до последнего шага прозрачность сохраняется
      if (last) canvas.drawColor(Skia.Color('white'));
      canvas.drawImageRectOptions(src, Skia.XYWHRect(0, 0, src.width(), src.height()), Skia.XYWHRect(0, 0, tw, th), FilterMode.Linear, MipmapMode.None);
      surface.flush();
      const next = surface.makeImageSnapshot();
      surface.dispose();
      if (src !== img) src.dispose();
      src = next;
    });
    return src;
  } catch (e) {
    if (src !== img) src.dispose();
    throw e;
  }
}

async function decodePhoto(uri: string, fileName: string): Promise<Photo> {
  // файл читает expo-file-system: Skia.Data.fromURI при ошибке чтения не отвечает вовсе — экран
  // ждал бы снимка вечно, со старым на месте
  let bytes: Uint8Array;
  try {
    bytes = await new File(uri).bytes();
  } catch (e) {
    logError('mine', e, 'photo read');
    throw new PhotoError(fileName);
  }
  const encoded = Skia.Data.fromBytes(bytes);
  const img = Skia.Image.MakeImageFromEncoded(encoded);
  encoded.dispose();
  if (!img) throw new PhotoError(fileName);
  // снимок в полном размере — сотни мегабайт: отпускается сразу, а не когда до него дойдёт сборщик мусора
  let snap: SkImage | null = null;
  let show: SkImage | null = null;
  try {
    const k = Math.min(1, MAX_SIDE / Math.max(img.width(), img.height()));
    const w = Math.max(1, Math.round(img.width() * k));
    const h = Math.max(1, Math.round(img.height() * k));
    snap = shrink(img, w, h, fileName);
    const rgba = snap.readPixels(0, 0, { width: w, height: h, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
    if (!(rgba instanceof Uint8Array) || rgba.length < w * h * 4) throw new PhotoError(fileName);
    const data = new Uint8Array(w * h * 3);
    for (let i = 0, j = 0; j < data.length; i += 4, j += 3) {
      data[j] = rgba[i];
      data[j + 1] = rgba[i + 1];
      data[j + 2] = rgba[i + 2];
    }
    const s = Math.min(1, SHOW_SIDE / Math.max(w, h));
    show = s < 1 ? shrink(snap, Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s)), fileName) : snap;
    const jpeg = show.encodeToBase64(ImageFormat.JPEG, 90);
    return { raster: { width: w, height: h, data }, uri: `data:image/jpeg;base64,${jpeg}`, name: fileName.replace(/\.[^.]+$/, ''), jpeg: null };
  } finally {
    if (show && show !== snap) show.dispose();
    snap?.dispose();
    img.dispose();
  }
}

/** Карточка для библиотеки — только в веб-версии владельца. */
export function downloadFiles(_files: { name: string; data: Blob }[]): void {}

export const textBlob = (s: string) => new Blob([s]);
