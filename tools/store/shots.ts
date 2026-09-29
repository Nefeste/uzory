// Снимки экрана для RuStore и сайта (store/README.md) — с веб-сборки, тем же кодом, что
// телефон. Работы подкладываются в хранилище браузера готовыми файлами стежков, поэтому
// кадр воспроизводим. Только картинки, которые можно выпускать: орнаменты студии и снимки
// Прокудина-Горского (docs/09-content.md, §2).
//
//   npm run export:web && bun tools/store/shots.ts
//     → store/screenshots/ru/NN-*.png (1080 × 1920); их же берёт сайт студии (store/site/page.*.md,
//       WebP для сайта он делает сам — ADR студии 0015)
import { mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { chromium, type Page } from 'playwright';
import sharp from 'sharp';
import { base64Encode } from '../../src/engine/base64';
import { CANVAS, type Pattern } from '../../src/engine/pattern';
import { utf8Encode } from '../../src/engine/utf8';
import type { Stroke } from '../../src/engine/work';
import { encodeWork } from '../../src/engine/workfile';
import { buildAll } from '../content/build';

const ROOT = join(import.meta.dir, '..', '..');
const DIST = join(ROOT, 'dist-web');
const SHOTS = join(ROOT, 'store', 'screenshots', 'ru');
mkdirSync(SHOTS, { recursive: true });

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.ttf': 'font/ttf' };
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const wanted = join(DIST, path === '/' ? 'index.html' : path);
    const name = (await Bun.file(wanted).exists()) ? wanted : join(DIST, 'index.html');
    return new Response(Bun.file(name), { headers: { 'content-type': TYPES[extname(name)] ?? 'application/octet-stream' } });
  },
});
const base = `http://127.0.0.1:${server.port}`;

const { built } = await buildAll();
const get = (id: string) => {
  const b = built.find((x) => x.card.id === id);
  if (!b) throw new Error(`картинки ${id} нет в сборке`);
  return b;
};

/** Работа «вышита до строки»: клетки выше `share` высоты и одна-две нити целиком — штрихами по строкам. */
function progress(p: Pattern, share: number, fullThreads: number[] = []): Stroke[] {
  const out: Stroke[] = [];
  const edge = Math.floor(p.h * share);
  for (let t = 0; t < p.threads.length; t++) {
    for (let y = 0; y < p.h; y++) {
      const cells: number[] = [];
      for (let x = 0; x < p.w; x++) {
        const i = y * p.w + x;
        if (p.cells[i] === t && (y < edge || fullThreads.includes(t))) cells.push(i);
      }
      if (cells.length) out.push({ thread: t, cells });
    }
  }
  return out;
}

interface Seed { id: string; key: string; strokes: Stroke[]; at: { x: number; y: number }; done: number; total: number }

function seed(id: string, p: Pattern, strokes: Stroke[], at: { x: number; y: number }): Seed {
  const done = strokes.reduce((n, s) => n + s.cells.length, 0);
  const total = p.cells.filter((c) => c !== CANVAS).length;
  return { id, key: p.key, strokes, at, done, total };
}

async function open(page: Page, s: Seed, settings: Record<string, unknown>) {
  // начали 42 минуты назад — «Готово» покажет правдоподобное время
  const started = Date.now() - 42 * 60_000;
  const bytes = encodeWork(s.key, started, s.strokes);
  const index = [{ id: s.id, pattern: s.key, started, done: s.done, total: s.total, opened: started + 40 * 60_000, at: s.at }];
  // работы веб-сборки — в IndexedDB (src/state/files.web.ts), настройки — в localStorage:
  // страница открывается, файлы кладутся в её базу, и она открывается заново уже с работой
  await page.goto(base);
  await page.evaluate(async ([id, work, idx, set]) => {
    localStorage.clear();
    localStorage.setItem('uzory.settings.v1', set);
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
  }, [s.id, base64Encode(bytes), base64Encode(utf8Encode(JSON.stringify(index))), JSON.stringify(settings)] as const);
  await page.reload();
  // строка о мыши и колёсике — только в браузере: на телефоне, для которого эти снимки, её нет
  await page.addStyleTag({ content: '[data-testid="hint"] { display: none !important; }' });
  await page.getByTestId('continue').waitFor({ timeout: 60_000 });
  await page.getByTestId('continue').click();
  await page.getByTestId('canvas').waitFor();
  await page.waitForTimeout(2500);
}

/** Клавиши канвы в браузере (docs/specs/2026-09-web.md): «−» — дальше, «0» — весь узор. */
async function keys(page: Page, ...list: string[]) {
  for (const k of list) {
    await page.keyboard.press(k);
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(800);
}

async function save(page: Page, name: string) {
  const png = await page.screenshot();
  // без потерь, но плотнее: сайт делает из них WebP сам, а RuStore берёт как есть
  await sharp(png).png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(join(SHOTS, `${name}.png`));
  console.log(name);
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const shot = async (f: (page: Page) => Promise<void>) => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, locale: 'ru-RU' });
  const page = await ctx.newPage();
  try {
    await f(page);
  } finally {
    await ctx.close();
  }
};
const base0 = { hints: false, haptics: false, sound: false, music: false };

try {
  // 1. Вышивание: «Крестьянские девушки» Прокудина-Горского — красная кофта и тарелка с ягодами
  // вышиты, ниже номера; чуть дальше масштаба открытия, чтобы в кадр вошли и крестики, и картина
  await shot(async (page) => {
    const p = get('pg-krestyanskie-devushki').pattern;
    await open(page, seed('w-shot-1', p, progress(p, 0.41), { x: p.w * 0.76, y: p.h * 0.4 }), { ...base0, style: 'cross' });
    await keys(page, '-');
    await save(page, '01-stitch');
  });
  // 2. Большая работа издалека: вышитое — цветом, остальное — бледной схемой
  await shot(async (page) => {
    const p = get('pg-pinkhus-karlinskiy').pattern;
    await open(page, seed('w-shot-2', p, progress(p, 0.55), { x: p.w / 2, y: p.h / 2 }), { ...base0, style: 'cross' });
    await keys(page, '0');
    await save(page, '02-far');
  });
  // 3. Крупные номера: орнамент, выбранная нить подсвечена
  await shot(async (page) => {
    const p = get('zvezda-alatyr').pattern;
    await open(page, seed('w-shot-3', p, progress(p, 0.5, [0]), { x: p.w / 2, y: p.h / 2 }), { ...base0, style: 'cross', bigNumbers: true });
    await save(page, '03-close');
  });
  // 4. «Мозаика»: дыни «Торговца дынями» ровными квадратами
  await shot(async (page) => {
    const p = get('pg-torgovets-dynyami').pattern;
    await open(page, seed('w-shot-4', p, progress(p, 0.5), { x: p.w * 0.62, y: p.h * 0.5 }), { ...base0, style: 'mosaic' });
    await keys(page, '-');
    await save(page, '04-mosaic');
  });
  // 5–6. Готово и «Как вышивалось»: последняя клетка — в центре экрана
  await shot(async (page) => {
    const p = get('pg-krestyanskie-devushki').pattern;
    const all = progress(p, 1);
    const last = all[all.length - 1];
    const cell = last.cells.pop()!;
    if (!last.cells.length) all.pop();
    const x = cell % p.w;
    const y = (cell - x) / p.w;
    await open(page, seed('w-shot-5', p, all, { x: x + 0.5, y: y + 0.5 }), { ...base0, style: 'cross' });
    const box = (await page.getByTestId('canvas').boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.getByTestId('replay').waitFor({ timeout: 15_000 });
    await page.waitForTimeout(1500);
    await save(page, '05-done');
    await page.getByTestId('replay').click();
    await page.waitForTimeout(5500);
    await save(page, '06-replay');
  });
} finally {
  await browser.close();
  server.stop();
}
