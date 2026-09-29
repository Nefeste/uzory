// Мои узоры (docs/specs/2026-09-custom.md, «Данные»): узор из своего снимка — файл
// `mine-<id>.json` рядом с работами, список — `mine.json`. Снимок не хранится: только
// клетки и нити. Узор после «Вышивать» не меняется: другой кадр — другой узор.
import { base64Decode, base64Encode } from '../engine/base64';
import type { Pattern } from '../engine/pattern';
import { utf8Decode, utf8Encode } from '../engine/utf8';
import { logError } from './crashlog';
import { readFile, removeFile, writeFile } from './files';
import { deleteWork, loadIndex } from './works';

export interface MineEntry {
  /** `mine-…` — он же id узора в ключе `mine-…@1` */
  id: string;
  title: string;
  created: number;
  w: number;
  h: number;
  threads: number;
}

interface MineFile {
  key: string;
  title: string;
  created: number;
  w: number;
  h: number;
  threads: { rgb: number; name: string }[];
  /** клетки, base64 */
  cells: string;
}

const INDEX = 'mine.json';
const fileOf = (id: string) => `${id}.json`;
export const mineKey = (id: string) => `${id}@1`;
export const isMineKey = (key: string) => key.startsWith('mine-');

export const newMineId = (now: number) =>
  `mine-${now.toString(36)}-${Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, '0')}`;

export async function listMine(): Promise<MineEntry[]> {
  try {
    const b = await readFile(INDEX);
    if (!b) return [];
    const list = JSON.parse(utf8Decode(b)) as MineEntry[];
    return Array.isArray(list) ? list : [];
  } catch (e) {
    logError('mine', e, INDEX);
    return [];
  }
}

// правки списка идут друг за другом, как у работ
let queue: Promise<unknown> = Promise.resolve();
function updateIndex(f: (list: MineEntry[]) => MineEntry[]): Promise<void> {
  const next = queue.then(async () => writeFile(INDEX, utf8Encode(JSON.stringify(f(await listMine()))), false));
  queue = next.catch(() => undefined);
  return next;
}

/**
 * Сохраняет узор под названием и новым ключом `mine-<id>@1`; возвращает узор с этим ключом.
 * Ошибка записи (нет места) — исключение.
 */
export async function saveMine(built: Pattern, title: string, now: number): Promise<{ entry: MineEntry; pattern: Pattern }> {
  const id = newMineId(now);
  const pattern: Pattern = { ...built, key: mineKey(id) };
  const file: MineFile = { key: pattern.key, title, created: now, w: pattern.w, h: pattern.h, threads: pattern.threads, cells: base64Encode(pattern.cells) };
  await writeFile(fileOf(id), utf8Encode(JSON.stringify(file)));
  const entry: MineEntry = { id, title, created: now, w: pattern.w, h: pattern.h, threads: pattern.threads.length };
  await updateIndex((list) => [entry, ...list.filter((m) => m.id !== id)]);
  return { entry, pattern };
}

export async function loadMine(id: string): Promise<Pattern | null> {
  try {
    const b = await readFile(fileOf(id));
    if (!b) return null;
    const f = JSON.parse(utf8Decode(b)) as MineFile;
    const cells = base64Decode(f.cells);
    if (cells.length !== f.w * f.h) throw new Error(`${id}: ${cells.length} cells, expected ${f.w * f.h}`);
    return { key: f.key, w: f.w, h: f.h, threads: f.threads, cells };
  } catch (e) {
    logError('mine', e, fileOf(id));
    return null;
  }
}

/** Удаляет узор и все его работы. */
export async function deleteMine(id: string): Promise<void> {
  for (const w of (await loadIndex()).filter((x) => x.pattern === mineKey(id))) await deleteWork(w.id);
  await removeFile(fileOf(id));
  await updateIndex((list) => list.filter((m) => m.id !== id));
}
