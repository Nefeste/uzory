// «Тайна от друга» (0.23.0; владелец 01.11.2026, issue 145: «1 А; 2 сначала А, также написать код для Б; 3 да»):
// свой узор уходит другу файлом — клетки и нити, название, подпись и записка; снимка в файле нет. Друг
// вышивает его «Тайной», бесплатно: картинка видна по мере вышивания, на «Готово» — название и записка.
// Файл идёт мимо нас — «Поделиться» и мессенджер; в игре он открывается кнопкой «Открыть тайну от друга»
// и на Android — касанием файла (src/state/incoming.ts). Чистый TypeScript: без React и платформы (ADR 0002).
import { base64Decode, base64Encode } from './base64';
import { CANVAS, MAX_SIDE, MAX_THREADS, type Pattern } from './pattern';
import { hash32 } from './seed';
import { utf8Decode, utf8Encode } from './utf8';

export const GIFT_FORMAT = 'uzory-gift';
export const GIFT_V = 1;
/** Расширение файла подарка: по нему игрок узнаёт файл, а Android предлагает «Узоры». */
export const GIFT_EXT = 'uzory';
/** Тип файла для «Поделиться»: мессенджеры передают незнакомый файл так же. */
export const GIFT_MIME = 'application/octet-stream';
export const GIFT_TITLE_MAX = 60;
export const GIFT_FROM_MAX = 40;
export const GIFT_NOTE_MAX = 300;
/** Подарок больше — не наш: узор 500 × 500 в base64 — около 340 КБ. */
export const GIFT_MAX_BYTES = 1024 * 1024;
/** Имя нити — не длиннее, как у своих узоров в файле переноса. */
const THREAD_NAME_MAX = 60;

/** Подпись и записка подарка — то, что друг увидит; хранится и у своего узора, который подарили ему. */
export interface GiftNote {
  /** от кого — имя, как его написали */
  from?: string;
  /** записка — друг прочтёт её на «Готово» */
  note?: string;
}

export interface Gift extends GiftNote {
  title: string;
  /** день подарка, ГГГГ-ММ-ДД */
  created: string;
  pattern: { w: number; h: number; threads: { rgb: number; name: string }[]; cells: Uint8Array };
}

/** Почему файл не открылся — для строки игроку. */
export type GiftProblem = 'notGift' | 'works' | 'newer' | 'broken' | 'tooBig';

export class GiftError extends Error {
  constructor(readonly problem: GiftProblem) {
    super(`gift: ${problem}`);
  }
}

/** Управляющие знаки (переводы строк, табуляция и прочие) — пробелом. */
const printable = (s: string) => Array.from(s, (ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? ' ' : ch)).join('');

/** Строка в одну линию: без управляющих знаков и лишних пробелов, не длиннее `max`. */
export function cleanLine(s: string, max: number): string {
  return printable(s).replace(/\s+/g, ' ').trim().slice(0, max).trim();
}

/** Записка: строки сохраняются, пустых подряд — не больше одной, не длиннее `max`. */
export function cleanNote(s: string, max: number): string {
  const lines = s.replace(/\r\n?/g, '\n').split('\n').map((l) => cleanLine(l, max));
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max).trim();
}

/** Подпись и записка — только непустые. */
export function giftNote(from: string | undefined, note: string | undefined): GiftNote {
  const f = cleanLine(from ?? '', GIFT_FROM_MAX);
  const n = cleanNote(note ?? '', GIFT_NOTE_MAX);
  return { ...(f ? { from: f } : {}), ...(n ? { note: n } : {}) };
}

/** Файл подарка: JSON в UTF-8. */
export function makeGift(p: Pick<Pattern, 'w' | 'h' | 'threads' | 'cells'>, title: string, note: GiftNote, created: string): Uint8Array {
  const clean = giftNote(note.from, note.note);
  return utf8Encode(JSON.stringify({
    format: GIFT_FORMAT, v: GIFT_V,
    title: cleanLine(title, GIFT_TITLE_MAX) || '—',
    ...clean,
    created,
    w: p.w, h: p.h,
    threads: p.threads.map((t) => ({ rgb: t.rgb, name: t.name })),
    cells: base64Encode(p.cells),
  }));
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isSide = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= MAX_SIDE;

/**
 * Подарок из файла: только знакомые поля и разумные значения, иначе `GiftError` с причиной. Файл переноса
 * работ узнаётся отдельно — его открывают в «Настройках».
 */
export function readGift(bytes: Uint8Array): Gift {
  if (bytes.length > GIFT_MAX_BYTES) throw new GiftError('tooBig');
  let raw: unknown;
  try {
    raw = JSON.parse(utf8Decode(bytes));
  } catch {
    throw new GiftError('notGift');
  }
  if (!isObj(raw)) throw new GiftError('notGift');
  if (raw.format === 'uzory-works') throw new GiftError('works');
  if (raw.format !== GIFT_FORMAT) throw new GiftError('notGift');
  if (!Number.isInteger(raw.v) || (raw.v as number) < 1) throw new GiftError('broken');
  if ((raw.v as number) > GIFT_V) throw new GiftError('newer');
  const { title, from, note, created, w, h, threads, cells } = raw;
  if (typeof title !== 'string' || !cleanLine(title, GIFT_TITLE_MAX)) throw new GiftError('broken');
  if ((from !== undefined && typeof from !== 'string') || (note !== undefined && typeof note !== 'string')) throw new GiftError('broken');
  if (typeof created !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(created)) throw new GiftError('broken');
  if (!isSide(w) || !isSide(h)) throw new GiftError('broken');
  if (!Array.isArray(threads) || threads.length < 1 || threads.length > MAX_THREADS) throw new GiftError('broken');
  const th: { rgb: number; name: string }[] = [];
  for (const t of threads) {
    if (!isObj(t) || !Number.isInteger(t.rgb) || (t.rgb as number) < 0 || (t.rgb as number) > 0xffffff || typeof t.name !== 'string') throw new GiftError('broken');
    th.push({ rgb: t.rgb as number, name: cleanLine(t.name, THREAD_NAME_MAX) });
  }
  if (typeof cells !== 'string') throw new GiftError('broken');
  let c: Uint8Array;
  try {
    c = base64Decode(cells);
  } catch {
    throw new GiftError('broken');
  }
  if (c.length !== w * h) throw new GiftError('broken');
  let stitches = 0;
  for (const x of c) {
    if (x === CANVAS) continue;
    if (x >= th.length) throw new GiftError('broken');
    stitches++;
  }
  if (!stitches) throw new GiftError('broken');
  return { title: cleanLine(title, GIFT_TITLE_MAX), ...giftNote(from, note), created, pattern: { w, h, threads: th, cells: c } };
}

/**
 * Id подарка у друга — по его содержимому: тот же файл, открытый ещё раз, — та же тайна, а не вторая.
 * Подходит под ключ своего узора (`mine-…@1`, src/engine/backup.ts).
 */
export function giftId(g: Gift): string {
  const s = [g.title, g.from ?? '', g.note ?? '', g.created, g.pattern.w, g.pattern.h,
    g.pattern.threads.map((t) => `${t.rgb}:${t.name}`).join(','), base64Encode(g.pattern.cells)].join('|');
  // два хеша по 7 знаков (2³² в base36 — не длиннее): граница между ними всегда на месте
  const h = (x: string) => hash32(x).toString(36).padStart(7, '0');
  return `mine-g-${h(s)}${h(`uzory|${s}`)}`;
}
