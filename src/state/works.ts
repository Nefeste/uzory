// Работа на диске (docs/04-data-model.md, «Файл стежков»; docs/specs/2026-09-canvas.md,
// «Сохранение»): штрихи копятся в памяти, файл пишется целиком не чаще раза в секунду
// и сразу при уходе с экрана; собирается он по мере вышивания (`WorkLog`). Испорченный файл —
// откат к `.bak`.
import type { Pattern } from '../engine/pattern';
import { addMinute, replay, Stitching, type StitchMinutes, type Stroke } from '../engine/work';
import { decodeWork, WorkFileError, workFileMisfit, WorkLog } from '../engine/workfile';
import { utf8Decode, utf8Encode } from '../engine/utf8';
import { noteFinished, noteStitch } from './counters';
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
  /** минут со стежками (src/engine/work.ts, `addMinute`); у работ, начатых до того, как их стали считать, — нет */
  minutes?: number;
  /** где вышивали в прошлый раз, в клетках */
  at?: { x: number; y: number };
  /** «Тайна» (issue 117, А): до последнего стежка без названия, превью и силуэта (src/engine/mystery.ts) */
  mystery?: true;
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
  /** штрихи и файл стежков, который собирается по мере вышивания */
  private readonly log: WorkLog;
  finished: number | undefined;
  at: { x: number; y: number } | undefined;
  /** «Тайна»: картинку не видно, пока она не вышита */
  mystery = false;
  /** минуты со стежками; нет — работа начата до того, как их стали считать, и время на «Готово» не показывается */
  private time: StitchMinutes | undefined;
  /** не записано на диск */
  private dirty = false;
  private lastWrite = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<void> = Promise.resolve();
  onSaveError: ((e: unknown) => void) | null = null;

  /** `file` — файл, из которого открыта работа, если он разобрался без обрыва: новые штрихи дописываются к нему. */
  constructor(readonly id: string, readonly pattern: Pattern, readonly started: number, strokes: Stroke[], finished?: number, minutes?: number, file?: Uint8Array) {
    const r = replay(pattern, strokes);
    this.state = r.state;
    this.log = new WorkLog(pattern.key, started, r.strokes, file);
    this.finished = finished;
    this.time = minutes !== undefined && Number.isSafeInteger(minutes) && minutes >= 0 ? { minutes, last: -1 } : undefined;
  }

  get strokes(): readonly Stroke[] {
    return this.log.strokes;
  }

  get minutes(): number | undefined {
    return this.time?.minutes;
  }

  /** Штрих из канвы (долгий — частями раз в секунду): движок проверяет стежки и дописывает принятые в работу. */
  stitch(thread: number, cells: readonly number[], now: number, final = true): number[] {
    const ok = this.state.apply({ thread, cells: [...cells] });
    this.log.add(thread, ok, final);
    if (!ok.length) return ok;
    noteStitch(now);
    if (this.time) this.time = addMinute(this.time, now);
    if (this.state.finished && this.finished === undefined) {
      this.finished = now;
      noteFinished(now);
    }
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
    const bytes = this.log.bytes();
    const entry: WorkEntry = {
      id: this.id, pattern: this.pattern.key, started: this.started, finished: this.finished,
      done: this.state.done, total: this.state.total, opened: Date.now(), at: this.at, minutes: this.time?.minutes,
      ...(this.mystery ? { mystery: true as const } : {}),
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
      // файл без обрыва — начало нового: дальше к нему дописываются только новые штрихи
      const s = new WorkSession(id, pattern, f.started, f.strokes, entry?.finished, entry?.minutes, f.truncated ? undefined : b);
      s.at = entry?.at;
      s.mystery = !!entry?.mystery;
      return s;
    } catch (e) {
      logError('work', e, name);
    }
  }
  return null;
}

/** Вышитые клетки работы — превью «в её нынешнем виде»; не разобралась — null. */
export async function workStitched(pattern: Pattern, id: string): Promise<Uint8Array | null> {
  const s = await openWork(pattern, id);
  return s ? s.state.stitched : null;
}

export async function startWork(pattern: Pattern, now: number, mystery = false): Promise<WorkSession> {
  const s = new WorkSession(newWorkId(now), pattern, now, [], undefined, 0);
  s.mystery = mystery;
  // пустая работа тоже записывается: «Продолжить» появляется сразу
  await s.flush(true);
  return s;
}

/**
 * Работы из файла переноса (src/state/backup.ts): стежки — файлами (прежний файл той же
 * работы становится `.bak`), записи — в указатель вместо прежних. Сбой записи — исключение.
 */
export async function putWorks(list: readonly { entry: WorkEntry; log: Uint8Array }[]): Promise<void> {
  if (!list.length) return;
  for (const w of list) await writeFile(`${w.entry.id}.log`, w.log);
  const ids = new Set(list.map((w) => w.entry.id));
  const next = indexQueue.then(async () => saveIndex([...list.map((w) => w.entry), ...(await loadIndex()).filter((w) => !ids.has(w.id))]));
  indexQueue = next.catch((e) => logError('work', e, 'index'));
  await next;
}

export async function deleteWork(id: string): Promise<void> {
  await removeFile(`${id}.log`);
  await updateIndex((list) => list.filter((w) => w.id !== id));
}
