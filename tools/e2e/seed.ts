// Работа, подложенная в хранилище веб-сборки готовым файлом стежков: снимки для магазина
// (tools/store/shots.ts) и сценарий (tools/e2e/smoke.ts) открывают её с нужного места.
import type { Page } from 'playwright';
import { base64Encode } from '../../src/engine/base64';
import { CANVAS, type Pattern } from '../../src/engine/pattern';
import { utf8Encode } from '../../src/engine/utf8';
import type { Stroke } from '../../src/engine/work';
import { encodeWork } from '../../src/engine/workfile';

export interface Seed {
  id: string;
  key: string;
  strokes: Stroke[];
  at: { x: number; y: number };
  done: number;
  total: number;
  /** мс начала; без него — 42 минуты назад */
  started?: number;
  /** мс последнего стежка — у законченной работы */
  finished?: number;
  /** минут со стежками (src/state/works.ts); без них «Готово» не покажет время */
  minutes?: number;
}

export function seed(id: string, p: Pattern, strokes: Stroke[], at: { x: number; y: number }): Seed {
  const done = strokes.reduce((n, s) => n + s.cells.length, 0);
  const total = p.cells.filter((c) => c !== CANVAS).length;
  return { id, key: p.key, strokes, at, done, total };
}

/** Вся картинка штрихами по строкам, нить за нитью. */
export function allStrokes(p: Pattern): Stroke[] {
  const strokes: Stroke[] = [];
  for (let t = 0; t < p.threads.length; t++) {
    for (let y = 0; y < p.h; y++) {
      const cells: number[] = [];
      for (let x = 0; x < p.w; x++) if (p.cells[y * p.w + x] === t) cells.push(y * p.w + x);
      if (cells.length) strokes.push({ thread: t, cells });
    }
  }
  return strokes;
}

/** Вся картинка без последней клетки — и она сама. */
export function allButLast(p: Pattern): { strokes: Stroke[]; last: number } {
  const strokes = allStrokes(p);
  const tail = strokes[strokes.length - 1];
  const last = tail.cells.pop()!;
  if (!tail.cells.length) strokes.pop();
  return { strokes, last };
}

/** Законченная работа: вся картинка, начата в `started`, последний стежок — в `finished`. */
export function seedDone(id: string, p: Pattern, started: number, finished: number): Seed {
  return { ...seed(id, p, allStrokes(p), { x: p.w / 2, y: p.h / 2 }), started, finished };
}

/**
 * Страница уже открыта: работы веб-сборки — в IndexedDB (src/state/files.web.ts), настройки
 * и прочее — в localStorage (`local`); после записи страница открывается заново уже с работой.
 * Без своего времени работа начата 42 минуты назад — «Готово» покажет правдоподобное время.
 */
export async function seedWork(page: Page, s: Seed, local: Record<string, string>) {
  await seedWorks(page, [s], local);
}

/** То же для нескольких работ сразу: «Продолжить» откроет последнюю незаконченную. */
export async function seedWorks(page: Page, list: Seed[], local: Record<string, string>) {
  // страница догружает CanvasKit: перезагрузка посреди загрузки wasm оставляет в консоли
  // «wasm streaming compile failed», и сценарий падает на проверке консоли (у ассистента —
  // 2 перезагрузки из 52; с ожиданием — ни одной)
  await page.waitForLoadState('networkidle');
  const files: [string, string][] = [];
  const index = list.map((s) => {
    const started = s.started ?? Date.now() - 42 * 60_000;
    files.push([`${s.id}.log`, base64Encode(encodeWork(s.key, started, s.strokes))]);
    const opened = s.finished ?? started + 40 * 60_000;
    return {
      id: s.id, pattern: s.key, started, ...(s.finished ? { finished: s.finished } : {}), done: s.done, total: s.total, opened, at: s.at,
      ...(s.minutes !== undefined ? { minutes: s.minutes } : {}),
    };
  });
  files.push(['index.json', base64Encode(utf8Encode(JSON.stringify(index)))]);
  await page.evaluate(async ([all, kv]) => {
    localStorage.clear();
    for (const [k, v] of Object.entries(JSON.parse(kv) as Record<string, string>)) localStorage.setItem(k, v);
    const bytesOf = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open('uzory', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('files');
      r.onerror = () => reject(r.error);
      r.onsuccess = () => {
        const db = r.result;
        const t = db.transaction('files', 'readwrite');
        const store = t.objectStore('files');
        store.clear();
        for (const [name, b64] of all) store.put(bytesOf(b64), name);
        t.oncomplete = () => {
          db.close();
          resolve();
        };
        t.onerror = () => reject(t.error);
      };
    });
  }, [files, JSON.stringify(local)] as const);
  await page.reload();
}
