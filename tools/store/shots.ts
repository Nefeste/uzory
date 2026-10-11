// Снимки экрана для RuStore и сайта (store/README.md) — с веб-сборки, тем же кодом, что
// телефон. Шесть кадров спецификации 1.0 (docs/specs/2026-09-v1.md, «Карточка RuStore»): канва
// крупно, большая работа издалека, «Готово» в рамке, библиотека, календарь, «О картине».
// Работы подкладываются в хранилище браузера готовыми файлами стежков, день календаря задают
// часы браузера, поэтому кадр воспроизводим. Только то, что можно выпускать (docs/09-content.md,
// §2): веб-сборка — со встроенным набором выпуска, иначе скрипт не снимает; каталога по сети нет.
//
//   bun tools/content/build.ts --release && npm run export:web && bun tools/store/shots.ts
//     → store/screenshots/ru/NN-*.png (1080 × 1920); их же берёт сайт студии (store/site/page.*.md,
//       WebP для сайта он делает сам — ADR студии 0015)
//   потом bun tools/content/build.ts — сценарию tools/e2e нужен набор для проверки, со всеми картинками
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { extname, join } from 'node:path';
import { type BrowserContext, chromium, type Page } from 'playwright';
import sharp from 'sharp';
import { BASE_PACK } from '../../src/content/generated/pack';
import { base64Decode } from '../../src/engine/base64';
import { Daily } from '../../src/engine/calendar';
import { addDays } from '../../src/engine/dates';
import { mergedCalendar, openPack, packPattern } from '../../src/engine/pack';
import { estimateMinutes, type Pattern } from '../../src/engine/pattern';
import type { Stroke } from '../../src/engine/work';
import { allButLast, type Seed, seed, seedDone, seedWork, seedWorks } from '../e2e/seed';

const ROOT = join(import.meta.dir, '..', '..');
const DIST = join(ROOT, 'dist-web');
const SHOTS = join(ROOT, 'store', 'screenshots', 'ru');

// набор выпуска: ни одной картинки без «да» владельца и прав (tools/content/build.ts --release)
const pack = openPack(base64Decode(BASE_PACK));
if (pack.json.pictures.some((p) => p.trial)) {
  throw new Error('встроенный набор — для проверки, в нём картинки без «да»: bun tools/content/build.ts --release, затем npm run export:web');
}
const JS = join(DIST, '_expo', 'static', 'js', 'web');
if (!readdirSync(JS).some((f) => f.endsWith('.js') && readFileSync(join(JS, f), 'utf8').includes(BASE_PACK))) {
  throw new Error('веб-сборка — не с этим набором: npm run export:web');
}
const get = (id: string): Pattern => {
  const pic = pack.json.pictures.find((p) => p.id === id);
  if (!pic) throw new Error(`картинки ${id} нет в наборе выпуска`);
  return packPattern(pack, pic);
};

// старые кадры уходят: в папке — ровно то, что снято сейчас
mkdirSync(SHOTS, { recursive: true });
for (const f of readdirSync(SHOTS)) if (f.endsWith('.png')) rmSync(join(SHOTS, f));

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.ttf': 'font/ttf' };
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    // каталог и наборы по сети (src/state/net-env.web.ts) — нет: на снимках только встроенный набор
    if (path.startsWith('/uzory/v1/')) return new Response('', { status: 404 });
    const wanted = join(DIST, path === '/' ? 'index.html' : path);
    const name = (await Bun.file(wanted).exists()) ? wanted : join(DIST, 'index.html');
    return new Response(Bun.file(name), { headers: { 'content-type': TYPES[extname(name)] ?? 'application/octet-stream' } });
  },
});
const base = `http://127.0.0.1:${server.port}`;

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

// строка о мыши и колёсике — только в браузере: на телефоне, для которого эти снимки, её нет
const hideHint = (page: Page) => page.addStyleTag({ content: '[data-testid="hint"] { display: none !important; }' });

async function open(page: Page, s: Seed, settings: Record<string, unknown>) {
  await page.goto(base);
  await seedWork(page, s, { 'uzory.settings.v1': JSON.stringify(settings) });
  await hideHint(page);
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

/**
 * Вся картинка без последней клетки, она — в центре экрана: касание кладёт её, и открывается «Готово».
 * Минут со стежками — сколько обещает карточка картинки (docs/08-game-design.md, «Размеры узоров»).
 */
async function finish(page: Page, id: string, p: Pattern) {
  const { strokes, last } = allButLast(p);
  const x = last % p.w;
  const y = (last - x) / p.w;
  await open(page, { ...seed(id, p, strokes, { x: x + 0.5, y: y + 0.5 }), minutes: estimateMinutes(p) - 1 }, { ...base0, style: 'cross' });
  const box = (await page.getByTestId('canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByTestId('replay').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1500);
}

async function save(page: Page, name: string) {
  const png = await page.screenshot();
  // без потерь, но плотнее: сайт делает из них WebP сам, а RuStore берёт как есть
  await sharp(png).png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(join(SHOTS, `${name}.png`));
  console.log(name);
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const shot = async (f: (page: Page, ctx: BrowserContext) => Promise<void>) => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
  const page = await ctx.newPage();
  try {
    await f(page, ctx);
  } finally {
    await ctx.close();
  }
};
const base0 = { hints: false, haptics: false, sound: false, music: false };

// Игрок четвёртой недели — для библиотеки и календаря: поставил игру 1 октября, вышил первую
// картинку и почти каждую картинку дня (трёх дней нет, одна начата), большую картину и снимок,
// вторую картину вышивает. Сегодня 24 октября, картинка дня ещё не начата.
const INSTALLED = '2026-10-01';
const TODAY = '2026-10-24';
const SKIPPED = ['2026-10-10', '2026-10-14', '2026-10-18'];
const STARTED = '2026-10-22';
const at = (day: string, hm: string) => Date.parse(`${day}T${hm}:00+03:00`);
function fourthWeek(): Seed[] {
  const daily = new Daily({ calendar: mergedCalendar([pack]), pictures: pack.json.pictures });
  const out: Seed[] = [seedDone('w-shot-first', get('first-picture'), at(INSTALLED, '18:10'), at(INSTALLED, '18:14'))];
  for (let d = INSTALLED; d < TODAY; d = addDays(d, 1)) {
    const id = daily.on(d);
    if (!id) throw new Error(`в календаре нет дня ${d}`);
    if (SKIPPED.includes(d)) continue;
    const p = get(id);
    out.push(d === STARTED
      ? { ...seed(`w-shot-${d}`, p, progress(p, 0.6), { x: p.w / 2, y: p.h / 2 }), started: at(d, '19:00') }
      : seedDone(`w-shot-${d}`, p, at(d, '19:00'), at(d, '19:35')));
  }
  out.push(seedDone('w-shot-girls', get('pg-krestyanskie-devushki'), at('2026-10-03', '20:00'), at('2026-10-12', '21:10')));
  out.push(seedDone('w-shot-ship', get('ayvazovsky-korabl-v-lunnuyu-noch'), at('2026-10-12', '21:30'), at('2026-10-20', '20:40')));
  const sunset = get('kuindzhi-krasnyy-zakat');
  out.push({ ...seed('w-shot-sunset', sunset, progress(sunset, 0.23), { x: sunset.w / 2, y: sunset.h * 0.2 }), started: at('2026-10-20', '21:00') });
  return out;
}

try {
  // 1. Вышивание: «Крестьянские девушки» Прокудина-Горского — красная кофта и тарелка с ягодами
  // вышиты, ниже номера; чуть дальше масштаба открытия, чтобы в кадр вошли и крестики, и картина
  await shot(async (page) => {
    const p = get('pg-krestyanskie-devushki');
    await open(page, seed('w-shot-1', p, progress(p, 0.41), { x: p.w * 0.76, y: p.h * 0.4 }), { ...base0, style: 'cross' });
    await keys(page, '-');
    await save(page, '01-stitch');
  });
  // 2. Большая работа издалека: вышитое — цветом, остальное — бледной схемой
  await shot(async (page) => {
    const p = get('pg-pinkhus-karlinskiy');
    await open(page, seed('w-shot-2', p, progress(p, 0.55), { x: p.w / 2, y: p.h / 2 }), { ...base0, style: 'cross' });
    await keys(page, '0');
    await save(page, '02-far');
  });
  // 3. «Готово»: работа в рамке, «Как вышивалось», «Поделиться», «О картине»
  await shot(async (page) => {
    await finish(page, 'w-shot-3', get('pg-krestyanskie-devushki'));
    await save(page, '03-done');
  });
  // 4–5. Библиотека и календарь игрока четвёртой недели: вышитое — цветом и с галочкой
  await shot(async (page, ctx) => {
    await ctx.clock.setFixedTime(at(TODAY, '16:00'));
    await page.goto(base);
    await seedWorks(page, fourthWeek(), {
      'uzory.settings.v1': JSON.stringify({ ...base0, style: 'cross' }),
      'uzory.player.v1': JSON.stringify({ installed: INSTALLED, seen: TODAY, pinned: {}, firstDone: true, hints: [] }),
    });
    await hideHint(page);
    await page.getByTestId('home-library').waitFor({ timeout: 60_000 });
    await page.getByTestId('home-library').click();
    await page.getByTestId('library').waitFor();
    await page.waitForTimeout(4000);
    await save(page, '04-library');
    await page.getByTestId('back').click();
    await page.getByTestId('home-calendar').click();
    await page.getByTestId(`day-${TODAY}`).waitFor({ timeout: 10_000 });
    await page.waitForTimeout(4000);
    await save(page, '05-calendar');
  });
  // 6. «О картине» на «Готово»: «Красный закат» Куинджи — кто, когда, где хранится, рассказ
  await shot(async (page) => {
    await finish(page, 'w-shot-6', get('kuindzhi-krasnyy-zakat'));
    await page.getByTestId('done-about').click();
    await page.getByTestId('done-about-panel').waitFor();
    await page.waitForTimeout(800);
    await save(page, '06-about');
  });
} finally {
  await browser.close();
  server.stop();
}
