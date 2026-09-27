// Набор картинок (docs/04-data-model.md, «Набор»): «UZP2», u32 длина JSON, JSON с карточками
// и палитрами, затем узоры подряд — u16 w, u16 h, u32 длина клеток в байтах и клетки
// построчно полосами: varint длина полосы, байт нити. Числа фиксированной длины —
// little-endian. `at` у картинки — смещение её узора от начала двоичной части (сразу
// после JSON): так JSON не зависит от собственной длины.
import { isDate } from './dates';
import { type CalendarDay, patternKey, type Picture, pictureError } from './library';
import { hex, parseHex, type Pattern, patternError, type Thread } from './pattern';
import { utf8Decode, utf8Encode } from './utf8';
import { Reader, Writer } from './varint';

const MAGIC = [0x55, 0x5a, 0x50, 0x32]; // UZP2

/**
 * Клетки полосами «длина, нить»: у картин в четыре клетки на сантиметр соседние клетки
 * чаще одной нити, и набор выходит в разы меньше, чем байт на клетку.
 */
function encodeCells(cells: Uint8Array): Uint8Array {
  const w = new Writer(Math.max(16, cells.length >> 1));
  for (let i = 0; i < cells.length;) {
    const t = cells[i];
    let j = i + 1;
    while (j < cells.length && cells[j] === t) j++;
    w.uint(j - i);
    w.byte(t);
    i = j;
  }
  return w.finish();
}

/** Клетки узора из полос; ошибка — строкой. */
function decodeCells(bytes: Uint8Array, n: number): Uint8Array | string {
  const out = new Uint8Array(n);
  const r = new Reader(bytes);
  let i = 0;
  try {
    while (i < n) {
      const run = r.uint();
      const t = r.byte();
      if (run < 1 || i + run > n) return `полоса ${run} клеток за концом узора`;
      out.fill(t, i, i + run);
      i += run;
    }
  } catch {
    return 'клетки обрываются';
  }
  return r.done ? out : 'лишние байты после клеток';
}

const u16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);

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
  const encoded: Uint8Array[] = [];
  const pictures: PackPicture[] = input.pictures.map(({ picture, pattern }) => {
    if (pattern.key !== patternKey(picture)) throw new PackError(`узор ${pattern.key} у картинки ${patternKey(picture)}`);
    const err = patternError(pattern) ?? pictureError(picture);
    if (err) throw new PackError(err);
    const out: PackPicture = { ...picture, palette: pattern.threads.map((t) => [hex(t.rgb), t.name]), at };
    const cells = encodeCells(pattern.cells);
    encoded.push(cells);
    at += 8 + cells.length;
    return out;
  });
  const json: PackJson = { id: input.id, created: input.created, pictures };
  if (input.calendar) json.calendar = input.calendar;
  const text = utf8Encode(JSON.stringify(json));
  const w = new Writer(8 + text.length + at);
  w.bytes(MAGIC);
  w.u32le(text.length);
  w.bytes(text);
  input.pictures.forEach(({ pattern }, k) => {
    w.bytes([pattern.w & 0xff, pattern.w >> 8, pattern.h & 0xff, pattern.h >> 8]);
    w.u32le(encoded[k].length);
    w.bytes(encoded[k]);
  });
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
  const b = pack.bytes;
  if (start + 8 > b.length) throw new PackError(`${key}: узор за концом файла`);
  const w = u16(b, start);
  const h = u16(b, start + 2);
  const len = new Reader(b, start + 4).u32le();
  if (start + 8 + len > b.length) throw new PackError(`${key}: клетки за концом файла`);
  const cells = decodeCells(b.subarray(start + 8, start + 8 + len), w * h);
  if (typeof cells === 'string') throw new PackError(`${key}: ${cells}`);
  if (!Array.isArray(pic.palette)) throw new PackError(`${key}: нет палитры`);
  const threads: Thread[] = pic.palette.map((t) => {
    const rgb = Array.isArray(t) && typeof t[0] === 'string' ? parseHex(t[0]) : null;
    if (rgb === null || typeof t[1] !== 'string') throw new PackError(`${key}: нить ${JSON.stringify(t)}`);
    return { rgb, name: t[1] };
  });
  const pattern: Pattern = { key, w, h, threads, cells };
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
