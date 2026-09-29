// Работа, подложенная в хранилище веб-сборки готовым файлом стежков: снимки для магазина
// (tools/store/shots.ts) и сценарий (tools/e2e/smoke.ts) открывают её с нужного места.
import type { Page } from 'playwright';
import { base64Encode } from '../../src/engine/base64';
import { CANVAS, type Pattern } from '../../src/engine/pattern';
import { utf8Encode } from '../../src/engine/utf8';
import type { Stroke } from '../../src/engine/work';
import { encodeWork } from '../../src/engine/workfile';

export interface Seed { id: string; key: string; strokes: Stroke[]; at: { x: number; y: number }; done: number; total: number }

export function seed(id: string, p: Pattern, strokes: Stroke[], at: { x: number; y: number }): Seed {
  const done = strokes.reduce((n, s) => n + s.cells.length, 0);
  const total = p.cells.filter((c) => c !== CANVAS).length;
  return { id, key: p.key, strokes, at, done, total };
}

/** Вся картинка штрихами по строкам, нить за нитью; без последней клетки — и она сама. */
export function allButLast(p: Pattern): { strokes: Stroke[]; last: number } {
  const strokes: Stroke[] = [];
  for (let t = 0; t < p.threads.length; t++) {
    for (let y = 0; y < p.h; y++) {
      const cells: number[] = [];
      for (let x = 0; x < p.w; x++) if (p.cells[y * p.w + x] === t) cells.push(y * p.w + x);
      if (cells.length) strokes.push({ thread: t, cells });
    }
  }
  const tail = strokes[strokes.length - 1];
  const last = tail.cells.pop()!;
  if (!tail.cells.length) strokes.pop();
  return { strokes, last };
}

/**
 * Страница уже открыта: работы веб-сборки — в IndexedDB (src/state/files.web.ts), настройки
 * и прочее — в localStorage (`local`); после записи страница открывается заново уже с работой.
 * Начата 42 минуты назад — «Готово» покажет правдоподобное время.
 */
export async function seedWork(page: Page, s: Seed, local: Record<string, string>) {
  const started = Date.now() - 42 * 60_000;
  const bytes = encodeWork(s.key, started, s.strokes);
  const index = [{ id: s.id, pattern: s.key, started, done: s.done, total: s.total, opened: started + 40 * 60_000, at: s.at }];
  await page.evaluate(async ([id, work, idx, kv]) => {
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
        const files = t.objectStore('files');
        files.clear();
        files.put(bytesOf(work), `${id}.log`);
        files.put(bytesOf(idx), 'index.json');
        t.oncomplete = () => {
          db.close();
          resolve();
        };
        t.onerror = () => reject(t.error);
      };
    });
  }, [s.id, base64Encode(bytes), base64Encode(utf8Encode(JSON.stringify(index))), JSON.stringify(local)] as const);
  await page.reload();
}
