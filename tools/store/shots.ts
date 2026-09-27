// Снимки экрана для RuStore и сайта (store/README.md) — с веб-сборки, тем же кодом, что
// телефон. Работы подкладываются в хранилище браузера готовыми файлами стежков, поэтому
// кадр воспроизводим. Только картинки, которые можно выпускать: орнаменты студии и снимки
// Прокудина-Горского (docs/09-content.md, §2).
//
//   npm run export:web && bun tools/store/shots.ts
//     → store/screenshots/ru/NN-*.png (1080 × 1920), store/site/uzory-NN-*.webp (540 × 960)
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
const SITE = join(ROOT, 'store', 'site');
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
  await page.addInitScript(([id, work, idx, set]) => {
    localStorage.clear();
    localStorage.setItem(`uzory.files.${id}.log`, work);
    localStorage.setItem('uzory.files.index.json', idx);
    localStorage.setItem('uzory.settings.v1', set);
  }, [s.id, base64Encode(bytes), base64Encode(utf8Encode(JSON.stringify(index))), JSON.stringify(settings)] as const);
  await page.goto(base);
  await page.getByTestId('continue').waitFor({ timeout: 60_000 });
  await page.getByTestId('continue').click();
  await page.getByTestId('canvas').waitFor();
  await page.waitForTimeout(2500);
}

async function save(page: Page, name: string, site?: string) {
  const png = await page.screenshot();
  await sharp(png).toFile(join(SHOTS, `${name}.png`));
  if (site) await sharp(png).resize(540, 960).webp({ quality: 86 }).toFile(join(SITE, `uzory-${site}.webp`));
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
  // 1. Вышивание: снимок Прокудина-Горского, верх вышит, дальше — номера
  await shot(async (page) => {
    const p = get('pg-sushka-setey').pattern;
    await open(page, seed('w-shot-1', p, progress(p, 0.46), { x: p.w * 0.42, y: p.h * 0.47 }), { ...base0, style: 'cross' });
    await save(page, '01-stitch', '01-stitch');
  });
  // 2. Крупные номера: орнамент, выбранная нить подсвечена
  await shot(async (page) => {
    const p = get('zvezda-alatyr').pattern;
    await open(page, seed('w-shot-2', p, progress(p, 0.5, [0]), { x: p.w / 2, y: p.h / 2 }), { ...base0, style: 'cross', bigNumbers: true });
    await save(page, '02-close', '02-close');
  });
  // 3. «Мозаика»
  await shot(async (page) => {
    const p = get('pg-torgovets-dynyami').pattern;
    await open(page, seed('w-shot-3', p, progress(p, 0.55), { x: p.w * 0.35, y: p.h * 0.56 }), { ...base0, style: 'mosaic' });
    await save(page, '03-mosaic', '03-mosaic');
  });
  // 4–5. Готово и «Как вышивалось»: последняя клетка — в центре экрана
  await shot(async (page) => {
    const p = get('pg-krestyanskie-devushki').pattern;
    const all = progress(p, 1);
    const last = all[all.length - 1];
    const cell = last.cells.pop()!;
    if (!last.cells.length) all.pop();
    const x = cell % p.w;
    const y = (cell - x) / p.w;
    await open(page, seed('w-shot-4', p, all, { x: x + 0.5, y: y + 0.5 }), { ...base0, style: 'cross' });
    const box = (await page.getByTestId('canvas').boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.getByTestId('replay').waitFor({ timeout: 15_000 });
    await page.waitForTimeout(1500);
    await save(page, '04-done', '04-done');
    await page.getByTestId('replay').click();
    await page.waitForTimeout(4500);
    await save(page, '05-replay');
  });
} finally {
  await browser.close();
  server.stop();
}
