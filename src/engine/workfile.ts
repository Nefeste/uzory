// Файл стежков работы (docs/04-data-model.md, «Файл стежков»): «UZW1», длина и ключ узора,
// время начала, затем штрихи подряд — нить, число клеток, первая клетка и разности
// соседних в «зигзаге». Все числа — varint.
import type { Pattern } from './pattern';
import { utf8Decode, utf8Encode } from './utf8';
import { Reader, Truncated, Writer } from './varint';
import type { Stroke } from './work';

const MAGIC = [0x55, 0x5a, 0x57, 0x31]; // UZW1
/** Ключ узора длиннее не бывает: id картинки ≤ 80 знаков латиницей и версия. */
const MAX_KEY = 120;
/** Номер клетки больше не бывает: узор не больше 255 × 255. */
const MAX_CELL = 255 * 255;

export class WorkFileError extends Error {}

export interface WorkFile {
  pattern: string;
  started: number;
  strokes: Stroke[];
  /** файл обрывался посреди штриха — этот штрих отброшен */
  truncated: boolean;
}

export function encodeWork(pattern: string, started: number, strokes: readonly Stroke[]): Uint8Array {
  let size = 16 + pattern.length * 2;
  for (const s of strokes) size += 6 + s.cells.length * 2;
  const w = new Writer(size);
  w.bytes(MAGIC);
  const key = utf8Encode(pattern);
  w.uint(key.length);
  w.bytes(key);
  w.uint(started);
  for (const s of strokes) {
    const c = s.cells;
    if (!c.length) continue;
    w.uint(s.thread);
    w.uint(c.length);
    w.uint(c[0]);
    for (let i = 1; i < c.length; i++) w.int(c[i] - c[i - 1]);
  }
  return w.finish();
}

/**
 * Разбирает файл. Не тот формат, битый заголовок, клетка за пределами любого узора —
 * `WorkFileError` (src/state берёт тогда копию `.bak`). Обрыв посреди штриха — не ошибка:
 * теряется только этот штрих.
 */
export function decodeWork(bytes: Uint8Array): WorkFile {
  if (bytes.length < 4 || MAGIC.some((b, i) => bytes[i] !== b)) throw new WorkFileError('не файл стежков');
  const r = new Reader(bytes, 4);
  let pattern: string;
  let started: number;
  try {
    const n = r.uint();
    if (n < 3 || n > MAX_KEY) throw new WorkFileError(`длина ключа ${n}`);
    pattern = utf8Decode(r.bytes(n));
    started = r.uint();
  } catch (e) {
    if (e instanceof WorkFileError) throw e;
    throw new WorkFileError(`заголовок: ${(e as Error).message}`);
  }
  const strokes: Stroke[] = [];
  let truncated = false;
  while (!r.done) {
    try {
      const thread = r.uint();
      const n = r.uint();
      if (n < 1 || n > MAX_CELL) throw new WorkFileError(`штрих ${strokes.length}: ${n} клеток`);
      if (n > r.left) throw new Truncated(); // на клетку — хотя бы байт
      const cells = new Array<number>(n);
      let c = r.uint();
      cells[0] = c;
      for (let i = 1; i < n; i++) {
        c += r.int();
        cells[i] = c;
      }
      for (const x of cells) if (x < 0 || x >= MAX_CELL) throw new WorkFileError(`клетка ${x} вне узора`);
      strokes.push({ thread, cells });
    } catch (e) {
      if (e instanceof Truncated) {
        truncated = true;
        break;
      }
      if (e instanceof WorkFileError) throw e;
      throw new WorkFileError(`штрих ${strokes.length}: ${(e as Error).message}`);
    }
  }
  return { pattern, started, strokes, truncated };
}

/** Почему файл не подходит узору, или null: ключ тот же, нити и клетки в его пределах. */
export function workFileMisfit(p: Pattern, f: WorkFile): string | null {
  if (f.pattern !== p.key) return `файл для ${f.pattern}, а узор ${p.key}`;
  const n = p.w * p.h;
  for (const s of f.strokes) {
    if (s.thread >= p.threads.length) return `нить ${s.thread} вне палитры из ${p.threads.length}`;
    for (const c of s.cells) if (c >= n) return `клетка ${c} вне узора ${p.w} × ${p.h}`;
  }
  return null;
}

export const workFileFits = (p: Pattern, f: WorkFile) => workFileMisfit(p, f) === null;
