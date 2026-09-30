// из anamnez: tools/e2e/smoke.ts @ 3d76cf5 (сервер веб-сборки)
// npm run e2e — сценарий Playwright по веб-сборке (docs/06-testing.md, §5): главная,
// первая картинка от первого стежка до «Готово» и «Как вышивалось», мышь и клавиши, лист,
// свой узор, замер, файл работы. Сначала `npm run export:web`. Снимки экранов — в tools/e2e/out/.
//
// Сборку для сайта (docs/specs/2026-09-web.md) сценарий открывает из её папки:
//   UZORY_WEB_BASE=/uzory/test npx expo export --platform web --output-dir dist-site
//   E2E_DIST=dist-site E2E_BASE=/uzory/test bun tools/e2e/smoke.ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { chromium, type Download, type Page } from 'playwright';
import { type Camera, clampX, clampY, fitScale, inMap, mapJump, mapRect, NUMBERS_DP, wheelFactor, zoomAround } from '../../src/canvas/camera';
import { BASE_PACK } from '../../src/content/generated/pack';
import { base64Decode } from '../../src/engine/base64';
import { addDays, mondayOf } from '../../src/engine/dates';
import { openPack } from '../../src/engine/pack';
import { CANVAS, type Pattern } from '../../src/engine/pattern';
import { fillRegion } from '../../src/engine/regions';
import { newKeyPair } from '../../src/engine/sign';
import { APP_VERSION } from '../../src/version';
import { utf8Encode } from '../../src/engine/utf8';
import { buildAll } from '../content/build';
import { type BuiltCatalog, makeCatalog, signJson } from '../content/catalog';
import { E2E_SECRET, e2ePack } from './net';
import { allButLast, seed, seedWork } from './seed';

const ROOT = join(import.meta.dir, '../..');
const DIST = join(ROOT, process.env.E2E_DIST ?? 'dist-web');
/** папка сборки на сайте, например /uzory/test; пусто — корень */
const BASE = (process.env.E2E_BASE ?? '').replace(/\/+$/, '');
const OUT = join(import.meta.dir, 'out');
mkdirSync(OUT, { recursive: true });

// Те же правила безопасности, что у папки игры на сайте (репозиторий Nefeste/gornitsagames,
// deploy/uzory/nginx.sh): что им не подходит, падает здесь ошибкой в консоли.
const CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.ttf': 'font/ttf', '.ico': 'image/x-icon' };
/** что просила страница, кроме чтения файлов самой сборки: свой снимок не должен уходить в сеть */
const requests: string[] = [];
/**
 * Поддельная раздача картинок (tools/e2e/net.ts): путь от /uzory/v1/ → байты. Как на сайте,
 * она вне папки игры; каталог подписан ключом сценария — сборка верит ему только на 127.0.0.1.
 */
let net = new Map<string, Uint8Array>();
/** что просили из раздачи, по порядку, со строкой запроса */
const netHits: string[] = [];
function publish(c: BuiltCatalog, secret: string) {
  net = new Map(c.files);
  net.set('catalog.json', c.json);
  net.set('catalog.sig', utf8Encode(signJson(c.json, secret)));
}
const basePack = base64Decode(BASE_PACK);
const baseId = openPack(basePack).json.id;
// обычный день: в каталоге только встроенный набор — качать нечего
publish(makeCatalog({ minApp: '0.0.1', packs: [{ id: baseId, bytes: basePack, builtin: true }] }), E2E_SECRET);
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(req) {
    const asked = new URL(req.url).pathname;
    const own = req.method === 'GET' && (await Bun.file(join(DIST, decodeURIComponent(asked).slice(BASE.length))).exists());
    if (!own) requests.push(`${req.method} ${asked}`);
    let path = decodeURIComponent(new URL(req.url).pathname);
    if (path.startsWith('/uzory/v1/')) {
      const rel = path.slice('/uzory/v1/'.length);
      netHits.push(rel + new URL(req.url).search);
      const body = net.get(rel);
      return body ? new Response(body.slice().buffer as ArrayBuffer, { headers: { 'content-type': rel.endsWith('.json') ? 'application/json' : 'application/octet-stream' } })
        : new Response('not found', { status: 404 });
    }
    if (BASE) {
      // вне папки игры на сайте — чужие страницы: сборка не должна туда ходить
      if (!path.startsWith(`${BASE}/`)) return new Response('not found', { status: 404 });
      path = path.slice(BASE.length);
    }
    const wanted = join(DIST, path === '/' ? 'index.html' : path);
    const name = (await Bun.file(wanted).exists()) ? wanted : join(DIST, 'index.html');
    return new Response(Bun.file(name), {
      headers: { 'content-type': TYPES[extname(name)] ?? 'application/octet-stream', 'content-security-policy': CSP },
    });
  },
});
const base = `http://127.0.0.1:${server.port}${BASE}/`;

const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'да ' : 'НЕТ'} ${what}`);
  if (!ok) failures.push(what);
};

/** Центр клетки на экране: камера открытия маленькой картинки — «весь узор» по центру. */
async function cellPoint(page: Page, p: Pattern, cell: number) {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  const s = fitScale(p.w, p.h, box.width, box.height);
  const tx = (box.width - p.w * s) / 2;
  const ty = (box.height - p.h * s) / 2;
  const x = cell % p.w;
  const y = (cell - x) / p.w;
  return { x: box.x + tx + (x + 0.5) * s, y: box.y + ty + (y + 0.5) * s, s };
}

const { built } = await buildAll();
const first = built.find((b) => b.card.id === 'first-picture')!.pattern;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2 });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

// музыка (src/state/music.ts): что и когда просили у проигрывателей страницы — play, pause, громкость
type MediaEvent = { src: string; what: 'play' | 'pause' | 'volume'; v: number; t: number };
await page.addInitScript(() => {
  const w = window as unknown as { media: MediaEvent[]; els: Set<HTMLMediaElement> };
  w.media = [];
  w.els = new Set();
  const P = HTMLMediaElement.prototype;
  const { play, pause } = P;
  const vol = Object.getOwnPropertyDescriptor(P, 'volume')!;
  const log = (el: HTMLMediaElement, what: MediaEvent['what'], v: number) => w.media.push({ src: el.src, what, v, t: performance.now() });
  P.play = function (this: HTMLMediaElement) {
    w.els.add(this);
    log(this, 'play', vol.get!.call(this) as number);
    return play.call(this);
  };
  P.pause = function (this: HTMLMediaElement) {
    log(this, 'pause', vol.get!.call(this) as number);
    return pause.call(this);
  };
  Object.defineProperty(P, 'volume', {
    get() { return vol.get!.call(this); },
    set(v: number) { vol.set!.call(this, v); log(this, 'volume', v); },
  });
});
/** События музыки — файлов пьес .webm; звуки стежка — .wav — не в счёт. */
const music = async (): Promise<MediaEvent[]> =>
  (await page.evaluate(() => (window as unknown as { media: MediaEvent[] }).media)).filter((e) => /\.webm/.test(e.src));
const musicPlays = () => page.waitForFunction(() => [...(window as unknown as { els: Set<HTMLMediaElement> }).els]
  .some((el) => /\.webm/.test(el.currentSrc) && !el.paused && el.currentTime > 0), null, { timeout: 8000 }).then(() => true, () => false);

try {
  await page.goto(base);
  await page.getByTestId('first-stitch').waitFor({ timeout: 60_000 });
  check(true, 'главная открылась: на месте картинки дня — первая картинка');
  await page.screenshot({ path: join(OUT, '01-home.png') });

  // библиотека (docs/specs/2026-09-library.md): коллекции рядами → «Все» → карточка картинки →
  // «Вышивать»; начатая работа — «Продолжить» на карточке и в «Моих работах»
  // библиотека не держит экран (0.10.3): превью считаются по одному, между ними экран отвечает;
  // при замедлении процессора в четыре раза «назад» срабатывает сразу, а не после всех превью
  // (прежде — 3,4 с при замедлении в шесть раз)
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.getByTestId('home-library').click();
  await page.getByTestId('lib-ornaments').waitFor({ timeout: 20_000 });
  const backAt = Date.now();
  await page.getByTestId('back').click();
  await page.getByTestId('home-library').waitFor({ timeout: 20_000 });
  const backMs = Date.now() - backAt;
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  check(backMs < 2000, `библиотека не держит экран: «назад» при замедлении ×4 — за ${backMs} мс`);
  await page.getByTestId('home-library').click();
  await page.getByTestId('lib-ornaments').waitFor({ timeout: 10_000 });
  check((await page.locator('[data-testid^="lib-"]').count()) >= 3, 'библиотека: коллекции рядами');
  await page.getByTestId('lib-all-ornaments').click();
  await page.getByTestId('tile-rozetka').waitFor({ timeout: 10_000 });
  await page.getByTestId('tile-rozetka').click();
  const picMeta = await page.getByTestId('picture-meta').innerText();
  check(/^Малая · \d+ нит/.test(picMeta) && (await page.getByTestId('picture-stitch').innerText()) === 'Вышивать', `«Все» → карточка картинки: ${picMeta}`);
  await page.getByTestId('picture-stitch').click();
  await page.getByTestId('canvas').waitFor();
  await page.waitForTimeout(1200);
  await page.getByTestId('back').click();
  await page.getByTestId('picture-stitch').waitFor();
  check((await music()).length === 0, 'музыка: открыли канву и ушли без стежка — не звучала');
  await page.waitForFunction(() => document.querySelector('[data-testid="picture-stitch"]')?.textContent?.startsWith('Продолжить'), null, { timeout: 5000 }).catch(() => {});
  check((await page.getByTestId('picture-stitch').innerText()).startsWith('Продолжить'), 'начатая картинка: на карточке — «Продолжить»');
  await page.getByTestId('back').click();
  await page.getByTestId('back').click();
  await page.getByTestId('back').click();

  // настройки: переключатель запоминается
  await page.getByTestId('home-settings').click();
  await page.getByTestId('settings').waitFor({ timeout: 5000 });
  await page.getByTestId('set-big').click();
  await page.waitForTimeout(200);
  const stored = await page.evaluate(() => localStorage.getItem('uzory.settings.v1') ?? '');
  check(stored.includes('"bigNumbers":true'), 'настройки: «Крупные номера» включились и запомнились');
  await page.getByTestId('set-big').click();
  await page.waitForTimeout(200);
  check((await page.getByTestId('set-music').count()) === 1, 'настройки: переключатель «Музыка»');
  await page.getByTestId('set-about').click();
  check((await page.getByTestId('about-version').innerText().catch(() => '')).includes('Узоры'), '«О программе»: версия и источники картинок');
  const aboutMusic = await page.locator('[data-testid^="about-music-"]').allInnerTexts();
  check(aboutMusic.length >= 5 && aboutMusic.every((t) => /общественное достояние|CC BY/.test(t)), `«О программе»: ${aboutMusic.length} пьес, у каждой — исполнитель и лицензия записи`);
  await page.getByTestId('back').click();
  await page.getByTestId('back').click();
  await page.getByTestId('first-stitch').waitFor();

  // первая картинка: касаниями по клеткам каждой нити, нить за нитью
  await page.getByTestId('first-stitch').click();
  await page.getByTestId('canvas').waitFor();
  await page.waitForTimeout(1500);
  const probe = await cellPoint(page, first, 0);
  check(probe.s >= NUMBERS_DP, `первая картинка открылась целиком и с номерами (${probe.s.toFixed(1)} dp на клетку)`);
  await page.screenshot({ path: join(OUT, '02-stitch-start.png') });

  // первая подсказка — про клетку выбранной нити (с компьютера — «щёлкните»)
  check((await page.getByTestId('hint-start').innerText().catch(() => '')).includes('Щёлкните клетку'), 'подсказка: «Щёлкните клетку с номером выбранной нити»');

  // меню ⋮: стиль меняется сразу и запоминается, работа не перезагружается
  await page.getByTestId('menu').click();
  await page.getByTestId('menu-panel').waitFor({ timeout: 5000 });
  await page.getByTestId('menu-style-mosaic').click();
  await page.waitForTimeout(200);
  const mosaic = await page.evaluate(() => localStorage.getItem('uzory.settings.v1') ?? '');
  await page.getByTestId('menu-style-cross').click();
  await page.getByTestId('panel-close').click({ position: { x: 20, y: 400 } });
  check(mosaic.includes('"style":"mosaic"') && (await page.getByTestId('menu-panel').count()) === 0, 'меню ⋮: «Мозаика» и обратно «Крестик»');

  // чужая клетка — строка «Эта клетка — нить …»
  const foreign = first.cells.findIndex((c) => c === 1);
  const fp = await cellPoint(page, first, foreign);
  await page.mouse.click(fp.x, fp.y);
  await page.waitForFunction(() => document.querySelector('[data-testid="hint"]')?.textContent?.includes('Эта клетка'), null, { timeout: 5000 }).catch(() => {});
  check((await page.getByTestId('hint').innerText().catch(() => '')).includes('Эта клетка'), 'касание чужой клетки показывает её нить');

  // заливка: двойное касание по клетке выбранной нити — вся её связная область. Первое
  // касание уже вышивает клетку; второе — через 80 мс, пока штрих ещё ждёт второго пальца
  await page.getByTestId('thread-1').click();
  const whereLeft = async () => Number((await page.getByTestId('where').innerText()).match(/(\d+)\s*$/)?.[1]);
  const row = Math.floor(first.h / 2);
  const rowOwn = Array.from({ length: first.w }, (_, x) => row * first.w + x).filter((i) => first.cells[i] === 0);
  const none = new Uint8Array(first.cells.length);
  let region: number[] = [];
  for (let i = 0; i < first.cells.length; i++) {
    if (first.cells[i] !== 0) continue;
    const r = fillRegion(first, none, i);
    // кисти ниже должна остаться работа в своей строке
    if (r.length > region.length && rowOwn.some((c) => !r.includes(c))) region = r;
  }
  const left0 = await whereLeft();
  const rp = await cellPoint(page, first, region[0]);
  await page.mouse.click(rp.x, rp.y);
  await page.waitForTimeout(80);
  await page.mouse.click(rp.x, rp.y);
  const leftBelow = (n: number) => page.waitForFunction((k) => {
    const m = document.querySelector('[data-testid="where"]')?.textContent?.match(/(\d+)\s*$/);
    return !!m && Number(m[1]) <= k;
  }, n, { timeout: 5000 }).catch(() => {});
  await leftBelow(left0 - region.length);
  const leftFill = await whereLeft();
  check(leftFill === left0 - region.length, `двойное касание залило область: ${left0 - leftFill} из ${region.length} клеток`);
  await page.waitForTimeout(300); // следующее касание — уже не третье подряд
  check((await page.getByTestId('hint-start').count()) === 0, 'подсказка про клетку ушла после стежка');

  // музыка начинается с первого стежка — тихо, и нарастает (docs/08-game-design.md, «Звук и музыка»)
  {
    const m = await music();
    const vols = m.filter((e) => e.what === 'volume').map((e) => e.v);
    const plays = m.filter((e) => e.what === 'play');
    check(plays.length === 1 && vols.length > 0 && vols[0] <= 0.01 && Math.max(...vols) < 0.3,
      `музыка: первый стежок — пьеса началась тихо (${decodeURIComponent(plays[0]?.src.split('/').pop() ?? '—').replace(/\.[0-9a-f]+\.webm$/, '')}, громкость до ${Math.max(0, ...vols).toFixed(2)})`);
    check(await musicPlays(), 'музыка звучит в браузере: WebM с Opus');
    // меню ⋮: выключили — затихла и встала на паузу; включили — сразу снова
    await page.getByTestId('menu').click();
    await page.getByTestId('menu-music').click();
    await page.waitForTimeout(1300);
    const off = await music();
    const stored = await page.evaluate(() => localStorage.getItem('uzory.settings.v1') ?? '');
    check(off[off.length - 1]?.what === 'pause' && off[off.length - 2]?.v === 0 && stored.includes('"music":false'), 'меню ⋮: «Музыка» выключилась — пьеса затихла и на паузе');
    await page.getByTestId('menu-music').click();
    await page.waitForTimeout(300);
    const on = await music();
    check(on.slice(off.length).some((e) => e.what === 'play'), 'меню ⋮: «Музыка» включилась — пьеса зазвучала снова');
    await page.getByTestId('panel-close').click({ position: { x: 20, y: 400 } });
  }

  // ещё четыре стежка касаниями — нитью 2, не в строке кисти: у нити 1 вне заливки клеток
  // почти нет, — и подсказка про кисть
  await page.getByTestId('thread-2').click();
  const taps = Array.from({ length: first.cells.length }, (_, i) => i).filter((i) => first.cells[i] === 1 && Math.floor(i / first.w) !== row).slice(0, 4);
  for (const i of taps) {
    const pt = await cellPoint(page, first, i);
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(280);
  }
  await page.getByTestId('hint-brush').waitFor({ timeout: 5000 }).catch(() => {});
  check((await page.getByTestId('hint-brush').innerText().catch(() => '')).includes('Проведите мышью'), 'после пяти касаний — подсказка про кисть');
  await page.getByTestId('thread-1').click();
  const left1 = await whereLeft();

  // кисть: провести по строке с клетками выбранной нити
  const a = await cellPoint(page, first, row * first.w);
  const b = await cellPoint(page, first, row * first.w + first.w - 1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  // палец идёт около 300 клеток в секунду, как в замере
  for (let k = 1; k <= 20; k++) {
    await page.mouse.move(a.x + ((b.x - a.x) * k) / 20, a.y);
    await page.waitForTimeout(8);
  }
  await page.mouse.up();
  // штрих уходит в работу по кадрам: ждём счётчик, а не угадываем время
  await leftBelow(left1 - 1);
  await page.screenshot({ path: join(OUT, '02b-brush.png') });
  const left2 = await whereLeft();
  check(left2 < left1, `кисть вышила строку: ${left1 - left2} клеток, ${await page.getByTestId('percent').innerText()}`);
  check((await page.getByTestId('hint-brush').count()) === 0, 'подсказка про кисть ушла после кисти');

  // мышь и клавиши (docs/specs/2026-09-web.md, «Управление»): колёсико приближает к курсору,
  // правая кнопка двигает канву, «+» приближает, «0» — снова весь узор. Щелчок каждый раз —
  // по клетке, которая без верного масштаба или сдвига оказалась бы клеткой другой нити:
  // тогда счётчик нити не сдвинулся бы.
  {
    const t = 2;
    await page.getByTestId(`thread-${t + 1}`).click();
    const box = (await page.getByTestId('canvas').boundingBox())!;
    const W = box.width;
    const H = box.height;
    const s0 = fitScale(first.w, first.h, W, H);
    const fit: Camera = { s: s0, tx: (W - first.w * s0) / 2, ty: (H - first.h * s0) / 2 };
    const cellAt = (c: Camera, x: number, y: number) => {
      const cx = Math.floor((x - c.tx) / c.s);
      const cy = Math.floor((y - c.ty) / c.s);
      return cx < 0 || cy < 0 || cx >= first.w || cy >= first.h ? -1 : cy * first.w + cx;
    };
    const used = new Set<number>();
    const target = (good: Camera, bad: Camera) => {
      for (let i = 0; i < first.cells.length; i++) {
        if (first.cells[i] !== t || used.has(i)) continue;
        const x = good.tx + ((i % first.w) + 0.5) * good.s;
        const y = good.ty + (Math.floor(i / first.w) + 0.5) * good.s;
        if (x < 20 || y < 20 || x > W - 20 || y > H - 20) continue;
        // в углу приближённой канвы — мини-карта: щелчок по ней двигает камеру, а не вышивает
        if (inMap(mapRect(first.w, first.h, W, H, good.s), x, y) || inMap(mapRect(first.w, first.h, W, H, bad.s), x, y)) continue;
        const j = cellAt(bad, x, y);
        if (j >= 0 && first.cells[j] === t) continue;
        used.add(i);
        return { x: box.x + x, y: box.y + y };
      }
      return null;
    };
    const stitchAt = async (pt: { x: number; y: number } | null) => {
      if (!pt) return false;
      const before = await whereLeft();
      await page.mouse.click(pt.x, pt.y);
      await leftBelow(before - 1);
      const ok = (await whereLeft()) === before - 1;
      await page.waitForTimeout(260); // следующий щелчок — не двойной
      return ok;
    };
    const zoom = (c: Camera, fx: number, fy: number, f: number) => zoomAround(c, fx, fy, f, first.w, first.h, W, H);

    // три щелчка колёсика к себе — над клеткой левее и выше центра. Сколько точек в щелчке,
    // решает браузер (при двойной плотности экрана — вдвое меньше): считаем по его событиям
    const fx = W / 2 - 2.3 * s0;
    const fy = H / 2 - 1.7 * s0;
    await page.evaluate(() => {
      const w = window as unknown as { wheels: [number, number, boolean][] };
      w.wheels = [];
      window.addEventListener('wheel', (e) => w.wheels.push([e.deltaY, e.deltaMode, e.ctrlKey]), { capture: true });
    });
    await page.mouse.move(box.x + fx, box.y + fy);
    for (let k = 0; k < 3; k++) {
      await page.mouse.wheel(0, -100);
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(300);
    const wheels = await page.evaluate(() => (window as unknown as { wheels: [number, number, boolean][] }).wheels);
    let cam = fit;
    for (const [dy, mode, ctrl] of wheels) cam = zoom(cam, fx, fy, wheelFactor(dy, mode, ctrl, H));
    check(wheels.length === 3 && await stitchAt(target(cam, fit)), `колёсико приблизило к курсору: ${s0.toFixed(1)} → ${cam.s.toFixed(1)} на клетку`);

    // правой кнопкой — сдвиг
    const d = { x: -0.9 * cam.s, y: -1.4 * cam.s };
    const from = { x: box.x + W / 2, y: box.y + H / 2 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down({ button: 'right' });
    for (let k = 1; k <= 6; k++) {
      await page.mouse.move(from.x + (d.x * k) / 6, from.y + (d.y * k) / 6);
      await page.waitForTimeout(16);
    }
    await page.mouse.up({ button: 'right' });
    const moved: Camera = { s: cam.s, tx: clampX(cam.tx + d.x, cam.s, first.w, W), ty: clampY(cam.ty + d.y, cam.s, first.h, H) };
    await page.waitForTimeout(200);
    check(await stitchAt(target(moved, cam)), 'правая кнопка сдвинула канву');

    // «+» — ближе к середине экрана
    await page.keyboard.press('+');
    const closer = zoom(moved, W / 2, H / 2, 1.25);
    await page.waitForTimeout(200);
    check(await stitchAt(target(closer, moved)), `«+» приблизил: ${moved.s.toFixed(1)} → ${closer.s.toFixed(1)}`);

    // мини-карта (docs/specs/2026-09-canvas.md): узор уже не весь на экране — щелчок по мини-карте
    // у правого нижнего угла узора переносит камеру туда
    const map = mapRect(first.w, first.h, W, H, closer.s);
    const mp = map ? { x: map.x + map.w * 0.8, y: map.y + map.h * 0.85 } : null;
    const jumped = map && mp ? mapJump(map, mp.x, mp.y, closer.s, first.w, first.h, W, H) : closer;
    if (mp) await page.mouse.click(box.x + mp.x, box.y + mp.y);
    await page.waitForTimeout(300);
    check(!!map && await stitchAt(target(jumped, closer)), 'мини-карта: щелчок перенёс камеру к этому месту узора');

    // «0» — весь узор, как при открытии: дальше сценарий снова считает клетки от него
    await page.keyboard.press('0');
    await page.waitForTimeout(600);
    check(await stitchAt(target(fit, closer)), '«0» вернул весь узор');
  }

  // начатая картинка из листа открывается с того же места, а не заново
  const pct = await page.getByTestId('percent').innerText();
  await page.waitForFunction(() => (window as unknown as { media: MediaEvent[] }).media.some((e) => /\.webm/.test(e.src) && e.what === 'volume' && e.v === 0.5),
    null, { timeout: 7000 }).catch(() => {});
  const heard = await music();
  const rise = heard.filter((e) => e.what === 'volume' && e.t >= heard.filter((x) => x.what === 'play').pop()!.t);
  const top = rise.find((e) => e.v === 0.5);
  check(!!top && top.t - rise[0].t >= 4500 && top.t - rise[0].t < 7000, `музыка дошла до своей громкости — половины — за ${top ? ((top.t - rise[0].t) / 1000).toFixed(1) : '—'} с`);
  await page.getByTestId('back').click();
  await page.waitForTimeout(1200);
  const gone = (await music()).slice(heard.length);
  check(gone.some((e) => e.what === 'pause') && !gone.some((e) => e.what === 'play'), 'ушли с экрана вышивания — музыка затихла и встала на паузу');
  // лист открывается сразу (0.10.1): превью и числа карточки считаются при показе — разом двести
  // узоров открывались 2,3 с на компьютере и десятки секунд на слабом телефоне
  const sheetAt = Date.now();
  await page.getByTestId('home-sheet').click();
  await page.getByTestId('sheet-picked').waitFor();
  const sheetMs = Date.now() - sheetAt;
  check(sheetMs < 1500, `лист из ${built.length} картинок открылся за ${sheetMs} мс`);
  await page.getByTestId('sheet-work-first-picture').waitFor({ timeout: 5000 }).catch(() => {});
  const started = await page.getByTestId('sheet-work-first-picture').innerText().catch(() => '');
  check(started.includes('Вышито'), `в листе — начатая работа: «${started}»`);
  await page.getByTestId('sheet-first-picture').click();
  await page.getByTestId('canvas').waitFor();
  await page.waitForTimeout(1500);
  check((await page.getByTestId('percent').innerText()) === pct, `из листа открылась та же работа: ${pct}`);

  // колёсико уже приближало — подсказки про два пальца не будет; у нити меньше десяти
  // клеток — подсказка про «Где ещё?», а после «Где ещё?» — камера к клеткам и «0» обратно
  let whereHint = '';
  for (let t = 0; t < first.threads.length; t++) {
    await page.getByTestId(`thread-${t + 1}`).click();
    for (let i = 0; i < first.cells.length; i++) {
      if (first.cells[i] !== t || first.cells[i] === CANVAS) continue;
      const pt = await cellPoint(page, first, i);
      await page.mouse.click(pt.x, pt.y);
      await page.waitForTimeout(260); // не двойное касание
      if (!whereHint && (await page.getByTestId('hint-where').count())) {
        whereHint = await page.getByTestId('hint-where').innerText();
        check((await page.getByTestId('hint-zoom').count()) === 0, 'подсказки про два пальца нет: колёсико уже приближало');
        await page.getByTestId('where').click();
        await page.waitForTimeout(700);
        check((await page.getByTestId('hint-where').count()) === 0, `подсказка «${whereHint}» ушла после «Где ещё?»`);
        await page.keyboard.press('0');
        await page.waitForTimeout(700);
      }
    }
  }
  check(whereHint.includes('Где ещё?'), 'у нити меньше десяти клеток — подсказка про «Где ещё?»');
  await page.getByTestId('replay').waitFor({ timeout: 15_000 });
  check(await page.getByTestId('done-frame').isVisible(), 'последний стежок — экран «Готово», работа в рамке');
  await page.screenshot({ path: join(OUT, '03-done.png') });
  // «Поделиться» в вебе — файл PNG: работа в рамке, под ней подпись
  const shared = page.waitForEvent('download', { timeout: 15_000 });
  await page.getByTestId('share').click();
  const png = await shared.then(async (d) => ({ name: d.suggestedFilename(), bytes: readFileSync((await d.path())!) })).catch(() => null);
  const dims = png && png.bytes.subarray(1, 4).toString() === 'PNG' ? [png.bytes.readUInt32BE(16), png.bytes.readUInt32BE(20)] : [0, 0];
  check(png?.name === 'uzory-first-picture.png' && dims.every((n) => n >= 1100 && n <= 2000) && dims[1] > dims[0],
    `«Поделиться»: ${png?.name ?? 'файл не скачался'} ${dims.join(' × ')}`);
  if (png) writeFileSync(join(OUT, '03-share.png'), png.bytes);
  await page.getByTestId('replay').click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: join(OUT, '04-replay.png') });
  await page.getByTestId('skip').click().catch(() => {});
  await page.getByTestId('next').click();
  await page.getByTestId('daily-stitch').waitFor({ timeout: 10_000 }).catch(() => {});
  check((await page.getByTestId('daily-stitch').innerText().catch(() => '')).includes('Вышивать') && (await page.getByTestId('first-stitch').count()) === 0,
    'первая картинка вышита — на главной картинка дня');

  // мои работы: готовая первая картинка; начатую «Розетку» — долгим касанием удалить
  await page.getByTestId('home-works').click();
  await page.getByTestId('works').waitFor({ timeout: 10_000 });
  const startedRows = page.locator('[data-testid^="work-w-"]');
  await startedRows.first().waitFor({ timeout: 5000 }).catch(() => {});
  const nStarted = await startedRows.count();
  const rb = (await startedRows.first().boundingBox())!;
  await page.mouse.move(rb.x + rb.width / 2, rb.y + 20);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await page.locator('[data-testid^="work-remove-"]').first().click();
  await page.waitForTimeout(600);
  check(nStarted === 1 && (await startedRows.count()) === 0, 'Мои работы: начатая работа удалилась долгим касанием');
  await page.getByTestId('works-tab-finished').click();
  await page.waitForTimeout(600);
  check((await page.locator('[data-testid^="work-w-"]').count()) === 1, 'Мои работы: готовая — первая картинка');
  await page.getByTestId('back').click();

  // календарь: у сегодняшнего дня — картинка дня, касание — её карточка
  const dailyTitle = await page.locator('[data-testid="home-daily"]').innerText();
  await page.getByTestId('home-calendar').click();
  await page.getByTestId('calendar').waitFor({ timeout: 10_000 });
  const todayStr = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  await page.getByTestId(`day-pic-${todayStr}`).click();
  await page.getByTestId('picture').waitFor({ timeout: 5000 });
  const calTitle = await page.locator('[data-testid="picture"]').innerText();
  check(dailyTitle.split('\n').some((l) => l.length > 3 && calTitle.includes(l)), 'календарь: сегодняшний день — та же картинка дня');
  await page.getByTestId('back').click();
  await page.getByTestId('back').click();
  await page.getByTestId('home-daily').waitFor();

  // «Дальше» после картинки из библиотеки — карточка картинки дня (или следующей в коллекции,
  // если картинка дня — эта же). «Ромбы кольцами» 23 × 23 в широком окне открываются целиком:
  // пять областей — пять двойных касаний. До первого стежка окно становится ниже — узор
  // открывается заново по новому размеру и остаётся целым: так канву уменьшает полоса нитей,
  // если она появилась уже после разметки канвы (в CI узор оставался обрезанным)
  const koltsa = built.find((b) => b.card.id === 'romb-koltsa')!.pattern;
  await page.setViewportSize({ width: 720, height: 860 });
  await page.getByTestId('home-library').click();
  await page.getByTestId('lib-all-ornaments').click();
  await page.getByTestId('tile-romb-koltsa').click();
  await page.getByTestId('picture-stitch').click();
  await page.getByTestId('canvas').waitFor();
  await page.waitForTimeout(1500);
  await page.setViewportSize({ width: 720, height: 760 });
  await page.waitForTimeout(600);
  const filled = new Uint8Array(koltsa.cells.length);
  for (let t = 0; t < koltsa.threads.length; t++) {
    await page.getByTestId(`thread-${t + 1}`).click();
    for (let i = 0; i < koltsa.cells.length; i++) {
      if (koltsa.cells[i] !== t || filled[i]) continue;
      for (const c of fillRegion(koltsa, filled, i)) filled[c] = 1;
      const pt = await cellPoint(page, koltsa, i);
      await page.mouse.click(pt.x, pt.y);
      await page.waitForTimeout(80);
      await page.mouse.click(pt.x, pt.y);
      await page.waitForTimeout(400);
    }
  }
  check(await page.getByTestId('replay').waitFor({ timeout: 15_000 }).then(() => true, () => false),
    'окно стало ниже до первого стежка — узор остался целым: пять заливок его закончили');
  check((await page.getByTestId('done-about').count()) === 0, '«Готово» своего орнамента — без «О картине»: рассказывать нечего');
  await page.getByTestId('next').click();
  await page.getByTestId('picture').waitFor({ timeout: 5000 }).catch(() => {});
  const nextTitle = (await page.getByTestId('picture').innerText().catch(() => '')).split('\n').find((l) => l.trim()) ?? '';
  check(!!nextTitle && nextTitle !== 'Ромбы кольцами' && (dailyTitle.includes('Ромбы кольцами') || dailyTitle.includes(nextTitle)),
    `«Дальше» — карточка картинки дня: «${nextTitle}»`);
  await page.getByTestId('back').click();
  await page.getByTestId('home-daily').waitFor();
  await page.setViewportSize({ width: 400, height: 860 });

  // лист
  await page.getByTestId('home-sheet').click();
  await page.getByTestId('sheet-first-picture').waitFor();
  // список прокручивается и рисует не всё сразу: проверяем, что он не пуст и первые на месте
  check((await page.locator('[data-testid^="sheet-"]').count()) >= Math.min(built.length, 5), `лист: ${built.length} картинок в наборе`);
  await page.screenshot({ path: join(OUT, '05-sheet.png') });
  // отбор (docs/09-content.md, §8): «Да» у первой картинки, «Нет» у «Розетки», «Позже» и снова
  // «Позже» — снято; «Скопировать решения» — текстом в буфер обмена
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(base).origin });
  await page.getByTestId('pick-first-picture-yes').click();
  await page.getByTestId('pick-rozetka-no').click();
  await page.getByTestId('pick-zvezda-alatyr-later').click();
  await page.getByTestId('pick-zvezda-alatyr-later').click();
  const picked = await page.getByTestId('sheet-picked').innerText();
  await page.getByTestId('sheet-copy').click();
  await page.getByTestId('sheet-picks-text').waitFor({ timeout: 5000 }).catch(() => {});
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  check(picked.startsWith('Отмечено 2 из') && clip.includes('Да (1): Первая картинка (first-picture)') && clip.includes('Нет (1): Розетка (rozetka)')
    && !clip.includes('Позже'), `отбор в листе: ${picked}; решения — в буфере обмена`);
  await page.getByTestId('sheet-filter-unmarked').click();
  await page.waitForTimeout(300);
  check((await page.getByTestId('sheet-first-picture').count()) === 0 && (await page.getByTestId('sheet-zvezda-alatyr').count()) === 1,
    '«Без отметки» — только неотмеченные');
  await page.getByTestId('sheet-filter-all').click();
  // коллекции — по частям (0.10.2): «Цветы» — только цветы, «Все» — снова все
  await page.getByTestId('sheet-coll-flowers').click();
  await page.waitForTimeout(300);
  const flowersOnly = (await page.getByTestId('sheet-first-picture').count()) === 0 && (await page.getByTestId('sheet-van-gogh-podsolnukhi').count()) === 1;
  await page.getByTestId('sheet-coll-all').click();
  await page.waitForTimeout(300);
  check(flowersOnly && (await page.getByTestId('sheet-first-picture').count()) === 1, 'в листе — коллекция «Цветы» отдельно, «Все» — снова все');
  await page.screenshot({ path: join(OUT, '05-sheet-picks.png') });
  await page.getByTestId('back').click();

  // «Узоры+» (0.12.0, docs/specs/2026-09-plus.md): в сборке для проверки — образец экрана: цены —
  // гипотезы, до кнопки всё, что требует закон, кнопка неактивна; «Как в 1.0» запирает картинку
  // «Узоры+» — вместо «Вышивать» «Подробнее», сняли — снова «Вышивать»
  await page.getByTestId('home-plus').click();
  await page.getByTestId('plus-sample').waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, '06-plus.png'), fullPage: true });
  const plusText = await page.getByTestId('plus').innerText();
  const buyBtn = page.getByTestId('plus-buy');
  check(/Вся библиотека — \d+ картин/.test(plusText) && plusText.includes('199 ₽ в месяц') && plusText.includes('990 ₽ в год')
    && plusText.includes('≈ 83 ₽ в месяц') && plusText.includes('автопродление') && plusText.includes('раз в год')
    && plusText.includes('Отменить — в RuStore') && plusText.includes('дошить') && (await buyBtn.innerText()) === 'Покупка — в сборке для RuStore'
    && (await buyBtn.getAttribute('aria-disabled')) === 'true', 'образец «Узоры+»: цены, автопродление, где отменить; покупки в этой сборке нет');
  await page.getByTestId('plus-month').click();
  await page.getByTestId('plus-restore').click();
  const legal = await page.getByTestId('plus-legal').innerText();
  const said = await page.getByTestId('plus-said').innerText().catch(() => '');
  check(legal.includes('раз в месяц') && said.includes('в сборке для RuStore'), `месячная — «раз в месяц»; «Восстановить покупки»: «${said}»`);
  await page.getByTestId('plus-preview-lock').click();
  await page.getByTestId('back').click();
  await page.getByTestId('home-library').click();
  await page.getByTestId('lib-all-painting').click();
  await page.getByTestId('collection').waitFor();
  const lockedTile = page.locator('[data-testid^="tile-"]', { hasText: 'Узоры+' }).first();
  await lockedTile.waitFor({ timeout: 10_000 });
  await lockedTile.click();
  await page.getByTestId('picture-locked').waitFor({ timeout: 5000 }).catch(() => {});
  check((await page.getByTestId('picture-stitch').count()) === 0
    && (await page.getByTestId('picture-locked').innerText().catch(() => '')).includes('Эта картинка — в «Узоры+»'),
    '«Как в 1.0»: картинка «Узоры+» заперта — вместо «Вышивать» «Подробнее»');
  await page.screenshot({ path: join(OUT, '06-plus-locked.png') });
  await page.getByTestId('picture-more').click();
  await page.getByTestId('plus-sample').waitFor();
  await page.getByTestId('plus-preview-lock').click();
  await page.getByTestId('back').click();
  check(await page.getByTestId('picture-stitch').waitFor({ timeout: 5000 }).then(() => true, () => false), '«Как в 1.0» сняли — на карточке снова «Вышивать»');
  await page.getByTestId('back').click();
  await page.getByTestId('back').click();
  await page.getByTestId('back').click();
  await page.getByTestId('home-library').waitFor();

  // свой узор (docs/specs/2026-09-custom.md): снимок → кадр → размер → приговор → «Вышивать»
  await page.getByTestId('home-mine').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('mine-pick').click();
  const sent = requests.length;
  await (await chooser).setFiles(join(ROOT, 'content/cities/zontiki-v-parke.jpg'));
  await page.getByTestId('mine-verdict').waitFor({ timeout: 30_000 });
  const meta0 = await page.getByTestId('mine-meta').innerText();
  check(/^70 × \d+ клеток/.test(meta0), `свой узор собрался: ${meta0}`);
  // колёсико над снимком — рамка ближе, узор другой
  const photoBox = (await page.getByTestId('mine-photo').boundingBox())!;
  await page.mouse.move(photoBox.x + photoBox.width / 2, photoBox.y + photoBox.height / 2);
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -120);
  const frame = (await page.getByTestId('mine-frame').boundingBox())!;
  check(frame.width < photoBox.width * 0.8, 'колёсико приблизило рамку');
  // малая: узор пересобирается, приговор — и для неё
  await page.getByTestId('mine-size-S').click();
  await page.waitForFunction(() => /^40 × /.test(document.querySelector('[data-testid="mine-meta"]')?.textContent ?? ''), null, { timeout: 30_000 });
  const verdictS = await page.getByTestId('mine-verdict').innerText();
  check(/Подходит|Не подходит/.test(verdictS), `приговор малой: ${verdictS.replace(/\n/g, ' — ')}`);
  // весь снимок, средняя: без упрощения лес рассыпается на мелкие пятна — «не подходит»,
  // «сильно» выравнивает пятна — подходит (по умолчанию — «немного»)
  await page.getByTestId('mine-whole').click();
  await page.getByTestId('mine-size-M').click();
  await page.waitForFunction(() => /^70 × /.test(document.querySelector('[data-testid="mine-meta"]')?.textContent ?? ''), null, { timeout: 30_000 });
  const simplify = async (level: number) => {
    await page.getByTestId(`mine-simplify-${level}`).click();
    // «Собираю узор…» появляется сразу после правки и уходит с новым узором
    await page.getByTestId('mine-building').waitFor({ state: 'attached', timeout: 2000 }).catch(() => {});
    await page.getByTestId('mine-building').waitFor({ state: 'detached', timeout: 30_000 });
    return page.getByTestId('mine-verdict').innerText();
  };
  const plain = await simplify(0);
  check(/Не подходит/.test(plain) && await page.getByTestId('mine-stitch').isDisabled(), `без упрощения: ${plain.split('\n')[0]}, «Вышивать» неактивна`);
  const verdict = await simplify(2);
  check(!/Не подходит/.test(verdict) && !(await page.getByTestId('mine-stitch').isDisabled()), `упрощение «сильно»: ${verdict.split('\n')[0]}`);
  await page.screenshot({ path: join(OUT, '09-mine.png') });
  // карточка для библиотеки: YAML с кадром и снимок без метаданных
  const downloads: Download[] = [];
  page.on('download', (d) => downloads.push(d));
  await page.getByTestId('mine-card').click();
  await page.waitForTimeout(1500);
  const yamlFile = downloads.find((d) => d.suggestedFilename().endsWith('.yaml'));
  const jpgFile = downloads.find((d) => d.suggestedFilename().endsWith('.jpg'));
  const yamlText = yamlFile ? readFileSync((await yamlFile.path())!, 'utf8') : '';
  check(!!jpgFile && /\npattern:\n {2}crop: \[/.test(yamlText) && /\n {2}size: 70\n/.test(yamlText) && /\n {2}simplify: 2 /.test(yamlText),
    `карточка для библиотеки: ${downloads.map((d) => d.suggestedFilename()).join(', ')}`);
  await page.getByTestId('mine-stitch').click();
  await page.getByTestId('canvas').waitFor({ timeout: 30_000 });
  check(true, 'свой узор открылся на канве');
  await page.getByTestId('back').click();
  await page.locator('[data-testid^="mine-item-"]').first().waitFor();
  // от выбора снимка до сих пор страница не просила у сервера ничего: снимок никуда не ушёл
  const leaked = requests.slice(sent).filter((r) => !r.startsWith('GET /uzory/v1/'));
  check(leaked.length === 0, `снимок не ушёл в сеть${leaked.length ? `: ${leaked.join(', ')}` : ''}`);
  // после перезагрузки узор на месте: он в хранилище браузера, а снимок — нет
  await page.reload();
  await page.getByTestId('home-mine').click();
  await page.locator('[data-testid^="mine-open-"]').first().click();
  await page.getByTestId('canvas').waitFor({ timeout: 30_000 });
  check(true, 'после перезагрузки свой узор продолжается');
  await page.getByTestId('back').click();
  await page.getByTestId('back').click();
  await page.getByTestId('home-daily').waitFor();

  // «Сообщить об ошибке» (0.14.0): для закрытого теста — сколько раз открывали (перезагрузка выше —
  // второй запуск), сколько раз игра оборвалась и сколько картинок закончено
  await page.getByTestId('home-settings').click();
  await page.getByTestId('set-report').click();
  await page.waitForFunction(() => (document.querySelector('[data-testid="report-text"]')?.textContent ?? '').includes('Последние ошибки'),
    null, { timeout: 10_000 }).catch(() => {});
  const report = await page.getByTestId('report-text').innerText().catch(() => '');
  const runs = /Запусков с \d+ [а-я]+: (\d+), из них оборвались: (\d+)/.exec(report);
  check(!!runs && Number(runs[1]) >= 1 && Number(runs[2]) <= Number(runs[1]) && /Законченных картинок: [1-9]/.test(report),
    `отчёт об ошибке: ${runs ? `запусков ${runs[1]}, оборвались ${runs[2]}` : 'строки о запусках нет'}, ${/Законченных картинок: \d+/.exec(report)?.[0] ?? 'законченных нет'}`);
  await page.getByTestId('back').click();
  await page.getByTestId('back').click();
  await page.getByTestId('home-daily').waitFor();

  // «Перенос» (docs/specs/2026-09-plus.md): «Сохранить работы в файл» — файл .uzw; «Загрузить из
  // файла» в чистой вкладке — работы и свой узор на месте; тот же файл второй раз — ничего нового
  await page.getByTestId('home-settings').click();
  const saved = page.waitForEvent('download', { timeout: 15_000 });
  await page.getByTestId('set-save').click();
  const uzw = await saved.then(async (d) => ({ name: d.suggestedFilename(), path: (await d.path())! })).catch(() => null);
  const backup = uzw ? JSON.parse(readFileSync(uzw.path, 'utf8')) as { format: string; works: unknown[]; mine: unknown[] } : null;
  const nWorks = backup?.works.length ?? 0;
  check(!!uzw && /^uzory-\d{4}-\d{2}-\d{2}\.uzw$/.test(uzw.name) && backup?.format === 'uzory-works' && nWorks === 3 && backup.mine.length === 1,
    `«Сохранить работы в файл»: ${uzw?.name ?? 'файл не скачался'}, работ ${nWorks}, своих узоров ${backup?.mine.length ?? 0}`);
  await page.getByTestId('back').click();
  await page.getByTestId('home-daily').waitFor();
  if (uzw) writeFileSync(join(OUT, 'transfer.uzw'), readFileSync(uzw.path));
  if (uzw) {
    const ctx3 = await browser.newContext({ viewport: { width: 400, height: 860 } });
    const page3 = await ctx3.newPage();
    page3.on('pageerror', (e) => errors.push(e.message));
    page3.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page3.goto(base);
    await page3.getByTestId('first-stitch').waitFor({ timeout: 60_000 });
    await page3.getByTestId('home-settings').click();
    const load = async () => {
      const chooser = page3.waitForEvent('filechooser');
      await page3.getByTestId('set-load').click();
      await (await chooser).setFiles(uzw.path);
      await page3.waitForFunction(() => document.querySelector('[data-testid="set-load"]')?.textContent === 'Загрузить из файла'
        && !!document.querySelector('[data-testid="set-transfer-said"]'), null, { timeout: 15_000 }).catch(() => {});
      return page3.getByTestId('set-transfer-said').innerText().catch(() => '');
    };
    const loaded = await load();
    check(loaded === `Добавлено: ${nWorks} работы, своих узоров: 1.`, `«Загрузить из файла» в чистой вкладке: ${loaded}`);
    const again = await load();
    check(again === `Новых работ в файле нет, уже были: ${nWorks}.`, `тот же файл второй раз: ${again}`);
    await page3.getByTestId('set-transfer-said').scrollIntoViewIfNeeded().catch(() => {});
    await page3.screenshot({ path: join(OUT, '10-transfer.png') });
    await page3.getByTestId('back').click();
    await page3.getByTestId('daily-stitch').waitFor({ timeout: 10_000 }).catch(() => {});
    check((await page3.getByTestId('first-stitch').count()) === 0, 'после загрузки первая картинка вышита — на главной картинка дня');
    await page3.getByTestId('home-works').click();
    await page3.getByTestId('works-tab-finished').click();
    await page3.waitForTimeout(600);
    const finishedN = await page3.locator('[data-testid^="work-w-"]').count();
    check(finishedN === 2, `в чистой вкладке «Готовые»: ${finishedN} — первая картинка и «Ромбы кольцами»`);
    await page3.getByTestId('back').click();
    await page3.getByTestId('home-mine').click();
    await page3.locator('[data-testid^="mine-open-"]').first().click();
    await page3.getByTestId('canvas').waitFor({ timeout: 30_000 });
    check(true, 'свой узор из файла открылся на канве');
    await ctx3.close();
  }

  // новые картинки по сети (docs/specs/2026-09-packs.md, «Критерии приёмки»): в каждой проверке —
  // чистая вкладка игрока, поставившего игру три дня назад (новое — с меткой «Новое»)
  const installedNet = addDays(todayStr, -3);
  const w1 = e2ePack('e2e-w1', [{ id: 'e2e-novyy-uzor', title: 'Новый узор' }], todayStr);
  const w2 = e2ePack('e2e-w2', [{ id: 'e2e-bityy-uzor', title: 'Битый узор' }], todayStr);
  // вчера — день игры: 4 картинки и 20 минут со стежками (корзины f = 3, m = 3)
  const counters = JSON.stringify({ cur: { day: addDays(todayStr, -1), finished: 4, minutes: 20, lastMinute: 1 }, prev: null, sentOn: null });
  const netTab = async () => {
    const ctx = await browser.newContext({ viewport: { width: 400, height: 860 } });
    await ctx.addInitScript(([pl, cn]) => {
      if (!localStorage.getItem('uzory.player.v1')) localStorage.setItem('uzory.player.v1', pl);
      if (!localStorage.getItem('uzory.counters.v1')) localStorage.setItem('uzory.counters.v1', cn);
    }, [JSON.stringify({ installed: installedNet, seen: todayStr, pinned: {}, firstDone: true, hints: [] }), counters] as const);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    netHits.length = 0;
    await p.goto(base);
    await p.getByTestId('home-library').waitFor({ timeout: 60_000 });
    return { ctx, p };
  };
  const until = async (f: () => boolean, ms = 10_000) => {
    for (let t = 0; t < ms && !f(); t += 100) await new Promise((r) => setTimeout(r, 100));
    return f();
  };
  const ornamentTiles = async (p: Page, wait?: string) => {
    await p.getByTestId('home-library').click();
    await p.getByTestId('lib-all-ornaments').click();
    await p.getByTestId('tile-rozetka').waitFor({ timeout: 10_000 });
    if (wait) await p.getByTestId(wait).waitFor({ timeout: 5000 }).catch(() => {});
    const ids = await p.locator('[data-testid^="tile-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid') ?? ''));
    await p.getByTestId('back').click();
    await p.getByTestId('back').click();
    return ids;
  };

  // чужая подпись: каталог не тронут — ни одного набора
  publish(makeCatalog({ minApp: '0.0.1', packs: [{ id: baseId, bytes: basePack, builtin: true }, { id: 'e2e-w1', bytes: w1, from: todayStr }] }),
    newKeyPair().secret);
  const na = await netTab();
  const sawSig = await until(() => netHits.includes('catalog.sig'));
  await na.p.waitForTimeout(800);
  const tilesA = await ornamentTiles(na.p);
  const logA = await na.p.evaluate(() => localStorage.getItem('uzory.crashlog.v1') ?? '');
  check(sawSig && !tilesA.includes('tile-e2e-novyy-uzor') && !netHits.some((h) => h.startsWith('packs/')) && logA.includes('catalog signature'),
    'каталог с чужой подписью не тронут: наборы не качались, в журнале сбоев — запись');
  await na.ctx.close();

  // подпись своя: новый набор — в библиотеке с меткой «Новое»; набор с неверным SHA-256 — нет
  const both = makeCatalog({
    minApp: '0.0.1',
    packs: [{ id: baseId, bytes: basePack, builtin: true }, { id: 'e2e-w1', bytes: w1, from: todayStr }, { id: 'e2e-w2', bytes: w2 }],
  });
  publish(both, E2E_SECRET);
  const w2file = [...both.files.keys()].find((f) => f.startsWith('packs/e2e-w2.'))!;
  const w2bad = w2.slice();
  w2bad[w2bad.length - 1] ^= 1; // тот же размер, другой SHA-256
  net.set(w2file, w2bad);
  const nb = await netTab();
  const gotPacks = await until(() => netHits.some((h) => h.startsWith('packs/e2e-w1.')) && netHits.some((h) => h.startsWith('packs/e2e-w2.')));
  const tilesB = await ornamentTiles(nb.p, 'tile-e2e-novyy-uzor');
  await nb.p.getByTestId('home-library').click();
  await nb.p.getByTestId('lib-all-ornaments').click();
  const newTile = await nb.p.getByTestId('tile-e2e-novyy-uzor').innerText().catch(() => '');
  await nb.p.getByTestId('back').click();
  await nb.p.getByTestId('back').click();
  check(gotPacks && tilesB.includes('tile-e2e-novyy-uzor') && newTile.includes('Новое') && !tilesB.includes('tile-e2e-bityy-uzor'),
    'новый набор — в библиотеке с меткой «Новое»; набор с неверным SHA-256 — нет');
  // счётчики (docs/03-server-api.md, «Счётчики»): ровно параметры таблицы, в её порядке
  const asked = netHits.find((h) => h.startsWith('catalog.json')) ?? '';
  const wantQuery = `catalog.json?v=${APP_VERSION}&s=web&c=${mondayOf(installedNet)}&d=3&p=0&f=3&m=3`;
  check(asked === wantQuery && !netHits.some((h) => !h.startsWith('catalog.json') && h.includes('?')),
    `строка запроса каталога — счётчики по таблице: ${asked}`);
  // день уже спрошен: после перезагрузки каталог не просится, скачанный набор — на месте
  await nb.p.reload();
  await nb.p.getByTestId('home-library').waitFor({ timeout: 60_000 });
  await nb.p.waitForTimeout(800);
  const tilesB2 = await ornamentTiles(nb.p);
  check(netHits.filter((h) => h.startsWith('catalog.json')).length === 1 && tilesB2.includes('tile-e2e-novyy-uzor'),
    'каталог — раз в сутки: после перезагрузки не спрашивается, набор остался');
  await nb.p.getByTestId('home-settings').click();
  await nb.p.getByTestId('set-about').click();
  const updated = await nb.p.getByTestId('about-updated').innerText().catch(() => '');
  check(updated.startsWith('Картинки обновлены'), `«О программе»: ${updated || 'нет строки'}`);
  await nb.ctx.close();

  // minApp выше версии: строка на главной, ничего не качается
  publish(makeCatalog({ minApp: '99.0.0', packs: [{ id: baseId, bytes: basePack, builtin: true }, { id: 'e2e-w1', bytes: w1 }] }), E2E_SECRET);
  const nc = await netTab();
  await nc.p.getByTestId('home-net').waitFor({ timeout: 10_000 }).catch(() => {});
  const lineC = await nc.p.getByTestId('home-net').innerText().catch(() => '');
  check(lineC.startsWith('Новые картинки — в новой версии игры') && !netHits.some((h) => h.startsWith('packs/')),
    `minApp выше версии — строка на главной: «${lineC}», наборы не качались`);
  await nc.ctx.close();

  // файл работы и повтор
  await page.getByTestId('home-file').click();
  await page.getByTestId('file-run').click();
  await page.getByTestId('file-replay').waitFor({ timeout: 60_000 });
  const size = await page.getByTestId('file-Размер файла').innerText();
  check(parseFloat(size.replace(',', '.')) <= 40, `файл законченной работы 120 × 120: ${size}`);
  await page.screenshot({ path: join(OUT, '06-file.png') });
  await page.getByTestId('file-replay').click();
  await page.getByTestId('replay').waitFor();
  await page.getByTestId('next').click();
  await page.getByTestId('home-daily').waitFor();

  // «Готово» большой картины — в отдельной вкладке с чистым хранилищем: «Крестьянские девушки»
  // без последней клетки, последний стежок — в центре экрана. «О картине» — автор с годами
  // жизни и источник, «Поделиться» — PNG, «Дальше» — карточка картинки
  // узкий телефон, 360 × 640: кнопки «Готово» — одна под другой, картина в рамке — целиком
  const ctx2 = await browser.newContext({ viewport: { width: 360, height: 640 } });
  const page2 = await ctx2.newPage();
  page2.on('pageerror', (e) => errors.push(e.message));
  page2.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const girls = built.find((b) => b.card.id === 'pg-krestyanskie-devushki')!.pattern;
  const tail = allButLast(girls);
  const gx = tail.last % girls.w;
  await page2.goto(base);
  await seedWork(page2, seed('w-e2e-girls', girls, tail.strokes, { x: gx + 0.5, y: (tail.last - gx) / girls.w + 0.5 }), {});
  await page2.getByTestId('continue').click();
  await page2.getByTestId('canvas').waitFor({ timeout: 30_000 });
  await page2.waitForTimeout(2000);
  const gb = (await page2.getByTestId('canvas').boundingBox())!;
  await page2.mouse.click(gb.x + gb.width / 2, gb.y + gb.height / 2);
  await page2.getByTestId('replay').waitFor({ timeout: 15_000 });
  const replayBox = (await page2.getByTestId('replay').boundingBox())!;
  const shareBox = (await page2.getByTestId('share').boundingBox())!;
  const fb = (await page2.getByTestId('done-frame').boundingBox())!;
  check(shareBox.y >= replayBox.y + replayBox.height - 1 && replayBox.width > 300 && fb.x >= 0 && fb.x + fb.width <= 360,
    `узкий экран: «Как вышивалось» и «Поделиться» одна под другой, рамка в экране (${Math.round(fb.width)} × ${Math.round(fb.height)})`);
  await page2.getByTestId('done-about').click();
  const aboutText = await page2.getByTestId('done-about-panel').innerText().catch(() => '');
  check(aboutText.includes('Прокудин-Горский (1863–1944), 1909') && aboutText.includes('Источник: www.loc.gov')
    && aboutText.includes('Сергей Прокудин-Горский. Крестьянские девушки, 1909. Схема для вышивки по мотивам снимка'),
    '«Готово» картины: «О картине» — автор с годами жизни, год, подпись и источник');
  await page2.screenshot({ path: join(OUT, '03-done-about.png') });
  await page2.getByTestId('done-about-close').click();
  const shared2 = page2.waitForEvent('download', { timeout: 20_000 });
  await page2.getByTestId('share').click();
  const png2 = await shared2.then(async (d) => ({ name: d.suggestedFilename(), bytes: readFileSync((await d.path())!) })).catch(() => null);
  const dims2 = png2 ? [png2.bytes.readUInt32BE(16), png2.bytes.readUInt32BE(20)] : [0, 0];
  check(png2?.name === 'uzory-pg-krestyanskie-devushki.png' && dims2.every((n) => n >= 1100 && n <= 2000),
    `«Поделиться» большой картины: ${png2?.name ?? 'файл не скачался'} ${dims2.join(' × ')}`);
  await page2.getByTestId('next').click();
  await page2.getByTestId('picture').waitFor({ timeout: 5000 }).catch(() => {});
  check((await page2.getByTestId('picture').count()) === 1, '«Дальше» после картины — карточка следующей картинки');
  await ctx2.close();

  // замер: канва рисуется, числа вживую
  await page.getByTestId('home-bench').click();
  await page.getByTestId('bench-canvas').waitFor();
  await page.waitForTimeout(3000);
  const live = await page.getByTestId('bench-live').innerText();
  check(/fps/.test(live), `замер: ${live}`);
  await page.screenshot({ path: join(OUT, '07-bench.png') });
  // замер сам: сдвиг, масштаб и кисть по 10 секунд — числа появляются на экране
  await page.getByTestId('bench-run').click();
  await page.getByTestId('bench-result').waitFor({ timeout: 90_000 });
  const result = await page.getByTestId('bench-result').innerText();
  check(/Кисть: \d+ кадров/.test(result) && !/стежков: 0/.test(result), 'замер прошёл все три фазы, кисть вышивала');
  console.log(result);
  // путь Б — «слои»
  await page.getByTestId('bench-path-layers').click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: join(OUT, '08-bench-layers.png') });
  check(/fps/.test(await page.getByTestId('bench-live').innerText()), 'путь «слои» рисует');
} catch (e) {
  failures.push(`сценарий упал: ${(e as Error).message}`);
  await page.screenshot({ path: join(OUT, 'failure.png') }).catch(() => {});
} finally {
  await browser.close();
  server.stop();
}

const serious = errors.filter((e) => !/favicon|Download the React DevTools/.test(e));
if (serious.length) console.log(`ошибки страницы:\n${serious.slice(0, 10).join('\n')}`);
check(serious.length === 0, 'без ошибок в консоли');
if (failures.length) {
  console.log(`\nне прошло: ${failures.length}\n${failures.map((f) => `  ${f}`).join('\n')}`);
  process.exit(1);
}
console.log('\nсценарий пройден');
