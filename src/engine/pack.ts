// Набор картинок (docs/04-data-model.md, «Набор»): «UZP1», u32 длина JSON, JSON с карточками
// и палитрами, затем узоры подряд — u8 w, u8 h, w × h байт клеток. Все числа — little-endian.
// `at` у картинки — смещение её узора от начала двоичной части (сразу после JSON): так
// JSON не зависит от собственной длины.
import { isDate } from './dates';
import { type CalendarDay, patternKey, type Picture, pictureError } from './library';
import { hex, parseHex, type Pattern, patternError, type Thread } from './pattern';
import { utf8Decode, utf8Encode } from './utf8';
import { Reader, Writer } from './varint';

const MAGIC = [0x55, 0x5a, 0x50, 0x31]; // UZP1

export class PackError extends Error {}

export interface PackPicture extends Picture {
  /** нити узора: [«#b3162f», «кумачовая»] в порядке полосы */
  palette: [string, string][];
  /** смещение узора от начала двоичной части */
  at: number;
}

export interface PackJson {
  id: string;
  /** дата сборки, «2026-10-12» */
  created: string;
  pictures: PackPicture[];
  calendar?: CalendarDay[];
}

export interface Pack {
  json: PackJson;
  bytes: Uint8Array;
  /** где в файле начинается двоичная часть */
  base: number;
}

export interface PackInput {
  id: string;
  created: string;
  pictures: { picture: Picture; pattern: Pattern }[];
  calendar?: CalendarDay[];
}

export function writePack(input: PackInput): Uint8Array {
  let at = 0;
  const pictures: PackPicture[] = input.pictures.map(({ picture, pattern }) => {
    if (pattern.key !== patternKey(picture)) throw new PackError(`узор ${pattern.key} у картинки ${patternKey(picture)}`);
    const err = patternError(pattern) ?? pictureError(picture);
    if (err) throw new PackError(err);
    const out: PackPicture = { ...picture, palette: pattern.threads.map((t) => [hex(t.rgb), t.name]), at };
    at += 2 + pattern.w * pattern.h;
    return out;
  });
  const json: PackJson = { id: input.id, created: input.created, pictures };
  if (input.calendar) json.calendar = input.calendar;
  const text = utf8Encode(JSON.stringify(json));
  const w = new Writer(8 + text.length + at);
  w.bytes(MAGIC);
  w.u32le(text.length);
  w.bytes(text);
  for (const { pattern } of input.pictures) {
    w.byte(pattern.w);
    w.byte(pattern.h);
    w.bytes(pattern.cells);
  }
  return w.finish();
}

/** Читает заголовок и JSON; узоры — по одному, `packPattern`. */
export function openPack(bytes: Uint8Array): Pack {
  if (bytes.length < 8 || MAGIC.some((b, i) => bytes[i] !== b)) throw new PackError('не набор картинок');
  const r = new Reader(bytes, 4);
  const len = r.u32le();
  if (8 + len > bytes.length) throw new PackError(`JSON ${len} байт, а файл ${bytes.length}`);
  let json: PackJson;
  try {
    json = JSON.parse(utf8Decode(r.bytes(len))) as PackJson;
  } catch (e) {
    throw new PackError(`JSON: ${(e as Error).message}`);
  }
  if (typeof json !== 'object' || json === null || typeof json.id !== 'string' || !Array.isArray(json.pictures)) {
    throw new PackError('JSON набора без id и pictures');
  }
  return { json, bytes, base: 8 + len };
}

/** Узор картинки из набора; битый — `PackError`. */
export function packPattern(pack: Pack, pic: PackPicture): Pattern {
  const key = patternKey(pic);
  if (!Number.isInteger(pic.at) || pic.at < 0) throw new PackError(`${key}: смещение ${pic.at}`);
  const start = pack.base + pic.at;
  if (start + 2 > pack.bytes.length) throw new PackError(`${key}: узор за концом файла`);
  const w = pack.bytes[start];
  const h = pack.bytes[start + 1];
  if (start + 2 + w * h > pack.bytes.length) throw new PackError(`${key}: клетки за концом файла`);
  if (!Array.isArray(pic.palette)) throw new PackError(`${key}: нет палитры`);
  const threads: Thread[] = pic.palette.map((t) => {
    const rgb = Array.isArray(t) && typeof t[0] === 'string' ? parseHex(t[0]) : null;
    if (rgb === null || typeof t[1] !== 'string') throw new PackError(`${key}: нить ${JSON.stringify(t)}`);
    return { rgb, name: t[1] };
  });
  const pattern: Pattern = { key, w, h, threads, cells: pack.bytes.slice(start + 2, start + 2 + w * h) };
  const err = patternError(pattern);
  if (err) throw new PackError(`${key}: ${err}`);
  return pattern;
}

/** Полная проверка набора — перед тем как пустить его в библиотеку (docs/03-server-api.md). */
export function packError(pack: Pack): string | null {
  const keys = new Set<string>();
  for (const pic of pack.json.pictures) {
    const err = pictureError(pic);
    if (err) return err;
    const key = patternKey(pic);
    if (keys.has(key)) return `${key} в наборе дважды`;
    keys.add(key);
    try {
      packPattern(pack, pic);
    } catch (e) {
      return (e as Error).message;
    }
  }
  // картинки календаря могут быть из прошлых наборов: неизвестные календарь пропускает
  const dates = new Set<string>();
  for (const d of pack.json.calendar ?? []) {
    if (typeof d.date !== 'string' || !isDate(d.date) || typeof d.picture !== 'string') return `календарь: ${JSON.stringify(d)}`;
    if (dates.has(d.date)) return `календарь: ${d.date} дважды`;
    dates.add(d.date);
  }
  return null;
}
