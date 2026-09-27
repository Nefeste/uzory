// Работа на диске (docs/04-data-model.md, «Файл стежков»; docs/specs/2026-09-canvas.md,
// «Сохранение»): штрихи копятся в памяти, файл пишется целиком не чаще раза в секунду
// и сразу при уходе с экрана. Испорченный файл — откат к `.bak`.
import type { Pattern } from '../engine/pattern';
import { replay, Stitching, type Stroke } from '../engine/work';
import { decodeWork, encodeWork, WorkFileError, workFileMisfit } from '../engine/workfile';
import { utf8Decode, utf8Encode } from '../engine/utf8';
import { logError } from './crashlog';
import { readFile, removeFile, writeFile } from './files';

export interface WorkEntry {
  id: string;
  pattern: string;
  started: number;
  finished?: number;
  done: number;
  total: number;
  /** когда открывали в последний раз — для «Продолжить» */
  opened: number;
  /** где вышивали в прошлый раз, в клетках */
  at?: { x: number; y: number };
}

const INDEX = 'index.json';
const SAVE_MS = 1000;

export async function loadIndex(): Promise<WorkEntry[]> {
  try {
    const b = await readFile(INDEX);
    if (!b) return [];
    const list = JSON.parse(utf8Decode(b)) as WorkEntry[];
    return Array.isArray(list) ? list : [];
  } catch (e) {
    logError('work', e, 'works/index.json');
    return [];
  }
}

async function saveIndex(list: WorkEntry[]): Promise<void> {
  await writeFile(INDEX, utf8Encode(JSON.stringify(list)), false);
}

// правки указателя идут друг за другом: две работы не затирают друг друга
let indexQueue: Promise<void> = Promise.resolve();
function updateIndex(f: (list: WorkEntry[]) => WorkEntry[]): Promise<void> {
  indexQueue = indexQueue.then(async () => saveIndex(f(await loadIndex()))).catch((e) => logError('work', e, 'index'));
  return indexQueue;
}

export const newWorkId = (now: number) =>
  `w-${now.toString(36)}-${Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, '0')}`;

export class WorkSession {
  readonly state: Stitching;
  readonly strokes: Stroke[];
  finished: number | undefined;
  at: { x: number; y: number } | undefined;
  /** не записано на диск */
  private dirty = false;
  /** последний штрих ещё идёт: канва шлёт долгий штрих частями раз в секунду */
  private open = false;
  private lastWrite = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<void> = Promise.resolve();
  onSaveError: ((e: unknown) => void) | null = null;

  constructor(readonly id: string, readonly pattern: Pattern, readonly started: number, strokes: Stroke[], finished?: number) {
    const r = replay(pattern, strokes);
    this.state = r.state;
    this.strokes = r.strokes;
    this.finished = finished;
  }

  /** Штрих из канвы: движок проверяет стежки и дописывает принятые в работу. */
  stitch(thread: number, cells: readonly number[], now: number, final = true): number[] {
    const ok = this.state.apply({ thread, cells: [...cells] });
    const last = this.strokes[this.strokes.length - 1];
    const cont = this.open && last !== undefined && last.thread === thread;
    this.open = !final;
    if (!ok.length) return ok;
    if (cont) last.cells.push(...ok);
    else this.strokes.push({ thread, cells: ok });
    if (this.state.finished && this.finished === undefined) this.finished = now;
    this.dirty = true;
    this.schedule(now);
    return ok;
  }

  private schedule(now: number) {
    if (this.timer) return;
    const wait = Math.max(0, this.lastWrite + SAVE_MS - now);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, wait);
  }

  /** Записать сейчас: уход с экрана, сворачивание, конец картинки. */
  flush(force = false): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirty && !force) return this.writing;
    this.dirty = false;
    const bytes = encodeWork(this.pattern.key, this.started, this.strokes);
    const entry: WorkEntry = {
      id: this.id, pattern: this.pattern.key, started: this.started, finished: this.finished,
      done: this.state.done, total: this.state.total, opened: Date.now(), at: this.at,
    };
    this.writing = this.writing.then(async () => {
      try {
        await writeFile(`${this.id}.log`, bytes);
        this.lastWrite = Date.now();
        await updateIndex((list) => [entry, ...list.filter((w) => w.id !== this.id)]);
      } catch (e) {
        // нет места или сбой диска: стежки держатся в памяти, запись — через 10 секунд
        this.dirty = true;
        logError('work', e, `save ${this.id}`);
        this.onSaveError?.(e);
        this.timer = setTimeout(() => {
          this.timer = null;
          void this.flush();
        }, 10000);
      }
    });
    return this.writing;
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

/** Открывает работу: файл, при порче — копия `.bak`; не разобралась и она — `null`. */
export async function openWork(pattern: Pattern, id: string): Promise<WorkSession | null> {
  for (const name of [`${id}.log`, `${id}.log.bak`]) {
    try {
      const b = await readFile(name);
      if (!b) continue;
      const f = decodeWork(b);
      const misfit = workFileMisfit(pattern, f);
      if (misfit) throw new WorkFileError(misfit);
      const entry = (await loadIndex()).find((w) => w.id === id);
      const s = new WorkSession(id, pattern, f.started, f.strokes, entry?.finished);
      s.at = entry?.at;
      return s;
    } catch (e) {
      logError('work', e, name);
    }
  }
  return null;
}

export async function startWork(pattern: Pattern, now: number): Promise<WorkSession> {
  const s = new WorkSession(newWorkId(now), pattern, now, []);
  // пустая работа тоже записывается: «Продолжить» появляется сразу
  await s.flush(true);
  return s;
}

export async function deleteWork(id: string): Promise<void> {
  await removeFile(`${id}.log`);
  await updateIndex((list) => list.filter((w) => w.id !== id));
}
