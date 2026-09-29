// Файл переноса работ (docs/04-data-model.md, «Резервная копия и перенос»): один JSON
// `uzory-<дата>.uzw` — формат, дата, работы (запись указателя и стежки в base64) и свои узоры
// (docs/specs/2026-09-custom.md): без них их работы не открыть. Файл приходит извне, поэтому
// проверяется строго: id работы и узора становятся именами файлов.
import { base64Decode, base64Encode } from './base64';
import { CANVAS, MAX_SIDE, MAX_THREADS } from './pattern';
import { decodeWork } from './workfile';

export const BACKUP_FORMAT = 'uzory-works';
export const BACKUP_V = 1;
/** Больше работ в файле не бывает: чужой огромный файл отбрасывается сразу. */
const MAX_WORKS = 5000;

/** Запись указателя работ — как `WorkEntry` в src/state/works.ts. */
export interface BackupEntry {
  id: string;
  pattern: string;
  started: number;
  finished?: number;
  done: number;
  total: number;
  opened: number;
  at?: { x: number; y: number };
}

/** Свой узор — как файл `mine-<id>.json` (src/state/mine.ts). */
export interface BackupMine {
  key: string;
  title: string;
  created: number;
  w: number;
  h: number;
  threads: { rgb: number; name: string }[];
  /** клетки, base64 */
  cells: string;
}

/** id работы и своего узора — латиница, цифры и дефис: из них получаются имена файлов. */
export const WORK_ID = /^w-[a-z0-9-]{1,40}$/;
export const MINE_KEY = /^mine-[a-z0-9-]{1,40}@1$/;
const PATTERN_KEY = /^[a-z0-9][a-z0-9-]{0,100}@[1-9]\d{0,5}$/;

export class BackupError extends Error {}

/** Файл переноса из работ и своих узоров. */
export function makeBackup(created: string, works: readonly { entry: BackupEntry; log: Uint8Array }[], mine: readonly BackupMine[]): string {
  return JSON.stringify({
    format: BACKUP_FORMAT, v: BACKUP_V, created,
    works: works.map((w) => ({ entry: w.entry, log: base64Encode(w.log) })),
    mine,
  });
}

export interface BackupWork {
  entry: BackupEntry;
  log: Uint8Array;
}

export interface ReadBackup {
  created: string;
  works: BackupWork[];
  mine: BackupMine[];
  /** работы и узоры, которые не разобрались: пропущены */
  bad: number;
}

/**
 * Разбирает файл переноса. Не файл работ «Узоров» или другой версии — BackupError;
 * отдельная испорченная работа или узор пропускаются и считаются в `bad`.
 */
export function readBackup(text: string): ReadBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupError('не JSON');
  }
  if (!isObj(raw) || raw.format !== BACKUP_FORMAT) throw new BackupError('не файл работ «Узоров»');
  if (raw.v !== BACKUP_V) throw new BackupError(`версия файла ${String(raw.v)}`);
  if (!Array.isArray(raw.works) || !Array.isArray(raw.mine)) throw new BackupError('нет списка работ');
  if (raw.works.length > MAX_WORKS || raw.mine.length > MAX_WORKS) throw new BackupError(`${raw.works.length} работ — слишком много`);
  let bad = 0;
  const mine: BackupMine[] = [];
  const keys = new Set<string>();
  for (const m of raw.mine) {
    const ok = mineOk(m);
    if (ok && !keys.has(ok.key)) {
      keys.add(ok.key);
      mine.push(ok);
    } else bad++;
  }
  const works: BackupWork[] = [];
  const ids = new Set<string>();
  for (const w of raw.works) {
    const ok = workOk(w);
    if (ok && !ids.has(ok.entry.id)) {
      ids.add(ok.entry.id);
      works.push(ok);
    } else bad++;
  }
  return { created: typeof raw.created === 'string' ? raw.created : '', works, mine, bad };
}

export interface ImportPlan {
  /** новые работы и те, где в файле вышито больше, чем на телефоне */
  works: BackupWork[];
  /** своих узоров на телефоне ещё нет */
  mine: BackupMine[];
  /** уже есть — с тем же или большим числом стежков */
  same: number;
  /** работа своего узора, которого нет ни в файле, ни на телефоне: открыть её нечем */
  orphan: number;
}

/**
 * Что добавить из файла к тому, что есть (`have`: работы — id и сколько вышито, свои узоры —
 * ключи). Совпавшие по id работы не дублируются: остаётся та, где вышито больше.
 */
export function planImport(file: ReadBackup, have: { works: ReadonlyMap<string, number>; mine: ReadonlySet<string> }): ImportPlan {
  const mine = file.mine.filter((m) => !have.mine.has(m.key));
  const known = new Set([...have.mine, ...file.mine.map((m) => m.key)]);
  const works: BackupWork[] = [];
  let same = 0;
  let orphan = 0;
  for (const w of file.works) {
    if (w.entry.pattern.startsWith('mine-') && !known.has(w.entry.pattern)) {
      orphan++;
      continue;
    }
    const had = have.works.get(w.entry.id);
    if (had !== undefined && had >= w.entry.done) {
      same++;
      continue;
    }
    works.push(w);
  }
  return { works, mine, same, orphan };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const isTime = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= MAX_SIDE * MAX_SIDE;
const isSide = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= MAX_SIDE;

/** Запись указателя — только известные поля, иначе null. */
function entryOk(e: unknown): BackupEntry | null {
  if (!isObj(e)) return null;
  const { id, pattern, started, finished, done, total, opened, at } = e;
  if (typeof id !== 'string' || !WORK_ID.test(id)) return null;
  if (typeof pattern !== 'string' || !PATTERN_KEY.test(pattern)) return null;
  if (!isTime(started) || !isTime(opened) || (finished !== undefined && !isTime(finished))) return null;
  if (!isCount(done) || !isCount(total) || total < 1) return null;
  const out: BackupEntry = { id, pattern, started, done, total, opened };
  if (finished !== undefined) out.finished = finished;
  if (isObj(at) && Number.isFinite(at.x) && Number.isFinite(at.y)) out.at = { x: at.x as number, y: at.y as number };
  return out;
}

/** Работа: запись и файл стежков того же узора; вышито — по стежкам файла, а не по записи. */
function workOk(w: unknown): BackupWork | null {
  if (!isObj(w) || typeof w.log !== 'string') return null;
  const entry = entryOk(w.entry);
  if (!entry) return null;
  try {
    const log = base64Decode(w.log);
    const f = decodeWork(log);
    if (f.pattern !== entry.pattern) return null;
    const cells = new Set<number>();
    for (const s of f.strokes) for (const c of s.cells) cells.add(c);
    if (cells.size > entry.total) return null;
    return { entry: { ...entry, done: cells.size }, log };
  } catch {
    return null;
  }
}

function mineOk(m: unknown): BackupMine | null {
  if (!isObj(m)) return null;
  const { key, title, created, w, h, threads, cells } = m;
  if (typeof key !== 'string' || !MINE_KEY.test(key)) return null;
  if (typeof title !== 'string' || !title.trim() || title.length > 200) return null;
  if (!isTime(created) || !isSide(w) || !isSide(h)) return null;
  if (!Array.isArray(threads) || threads.length < 1 || threads.length > MAX_THREADS) return null;
  const th: { rgb: number; name: string }[] = [];
  for (const t of threads) {
    if (!isObj(t) || !Number.isInteger(t.rgb) || (t.rgb as number) < 0 || (t.rgb as number) > 0xffffff) return null;
    if (typeof t.name !== 'string' || t.name.length > 60) return null;
    th.push({ rgb: t.rgb as number, name: t.name });
  }
  if (typeof cells !== 'string') return null;
  try {
    const c = base64Decode(cells);
    if (c.length !== w * h) return null;
    for (const x of c) if (x !== CANVAS && x >= th.length) return null;
  } catch {
    return null;
  }
  return { key, title: title.trim(), created, w, h, threads: th, cells };
}
