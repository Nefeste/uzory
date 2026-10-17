// из anamnez: tools/e2e/smoke.ts @ 3d76cf5 (сервер веб-сборки)
// npm run e2e — сценарий Playwright по веб-сборке (docs/06-testing.md, §5): главная,
// первая картинка от первого стежка до «Готово» и «Как вышивалось», мышь и клавиши, лист,
// свой узор, «убить посреди кисти», «Узоры+» с заглушкой магазина, календарь с подменённой датой,
// замер, файл работы. Сначала `npm run export:web`. Снимки экранов — в tools/e2e/out/.
//
// Сборку для сайта (docs/specs/2026-09-web.md) сценарий открывает из её папки:
//   UZORY_WEB_BASE=/uzory/test npx expo export --platform web --output-dir dist-site
//   E2E_DIST=dist-site E2E_BASE=/uzory/test bun tools/e2e/smoke.ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { chromium, type Download, type Page } from 'playwright';
import sharp from 'sharp';
import { type Camera, clampX, clampY, fitScale, inMap, mapJump, mapRect, NUMBERS_DP, OPEN_DP, openCamera, wheelFactor, zoomAround } from '../../src/canvas/camera';
import { BASE_PACK } from '../../src/content/generated/pack';
import { base64Decode } from '../../src/engine/base64';
import { Daily } from '../../src/engine/calendar';
import { addDays, mondayOf } from '../../src/engine/dates';
import { mergedCalendar, openPack, packPattern } from '../../src/engine/pack';
import { FREE_FIRST } from '../../src/engine/library';
import { CANVAS, type Pattern } from '../../src/engine/pattern';
import { shareLayout } from '../../src/engine/share';
import { fillRegion, nearestGroup } from '../../src/engine/regions';
import { hash32 } from '../../src/engine/seed';
import { newKeyPair } from '../../src/engine/sign';
import { APP_VERSION } from '../../src/version';
import { utf8Encode } from '../../src/engine/utf8';
import { buildAll } from '../content/build';
import { type BuiltCatalog, makeCatalog, signJson } from '../content/catalog';
import { E2E_SECRET, e2ePack } from './net';
import { allButLast, seed, seedWork, seedWorks } from './seed';
import { lookAtShare } from './share';

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

/**
 * Центр клетки на экране при камере открытия новой работы (src/canvas/camera.ts, `openCamera`):
 * маленькая картинка — «весь узор» по центру, большая — масштаб открытия, середина узора в середине экрана.
 */
async function cellPoint(page: Page, p: Pattern, cell: number) {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  const c = openCamera(p.w, p.h, box.width, box.height, false);
  const x = cell % p.w;
  const y = (cell - x) / p.w;
  return { x: box.x + c.tx + (x + 0.5) * c.s, y: box.y + c.ty + (y + 0.5) * c.s, s: c.s };
}

/**
 * Клетка у середины экрана при камере открытия новой работы — не у края, не под строкой подсказок,
 * не на мини-карте: ближайшая к середине клетка первой нити (она выбрана сразу), а если первой
 * нити на экране нет — ближайшая клетка любой нити.
 */
async function openCell(page: Page, p: Pattern): Promise<number> {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  const c = openCamera(p.w, p.h, box.width, box.height, false);
  const map = mapRect(p.w, p.h, box.width, box.height, c.s);
  let any = -1;
  let anyD = Infinity;
  let own = -1;
  let ownD = Infinity;
  for (let i = 0; i < p.cells.length; i++) {
    if (p.cells[i] === CANVAS) continue;
    const x = c.tx + ((i % p.w) + 0.5) * c.s;
    const y = c.ty + (Math.floor(i / p.w) + 0.5) * c.s;
    if (x < 40 || y < 40 || x > box.width - 40 || y > box.height - 80 || inMap(map, x, y)) continue;
    const d = (x - box.width / 2) ** 2 + (y - box.height / 2) ** 2;
    if (p.cells[i] === 0 && d < ownD) {
      own = i;
      ownD = d;
    }
    if (d < anyD) {
      any = i;
      anyD = d;
    }
  }
  return own >= 0 ? own : any;
}

/**
 * «Далеко» (docs/specs/2026-09-canvas.md, «Жесты») у большой картинки, только что открытой новой
 * работой (камера открытия, выбрана нить `t`, вышита одна клетка `done`): колёсиком отъехали, пока
 * номера не скрылись. Щелчок по клетке выбранной нити не вышивает, а приближает это место до масштаба
 * открытия — следующий щелчок вышивает клетку, посчитанную по новой камере (по прежней там другая
 * нить). Перетаскивание с клетки выбранной нити двигает канву: кисти далеко нет. И «Где ещё?» со всего
 * узора: камера летит к ближайшей к середине экрана группе невышитых клеток нити и приближает.
 */
async function farAway(page: Page, p: Pattern, t: number, done: number) {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  const W = box.width;
  const H = box.height;
  const left = async () => Number((await page.getByTestId('where').innerText()).match(/(\d+)\s*$/)?.[1]);
  const cellAt = (c: Camera, x: number, y: number) => {
    const cx = Math.floor((x - c.tx) / c.s);
    const cy = Math.floor((y - c.ty) / c.s);
    return cx < 0 || cy < 0 || cx >= p.w || cy >= p.h ? -1 : cy * p.w + cx;
  };
  const used = new Set<number>([done]);
  // невышитая клетка выбранной нити (из `only`, если задано), видная при камере `good` — не у края,
  // не под строкой подсказок, не на мини-карте; при камере `bad` на её месте — клетка другой нити
  const pick = (good: Camera, bad?: Camera, only?: ReadonlySet<number>) => {
    for (let i = 0; i < p.cells.length; i++) {
      if (p.cells[i] !== t || used.has(i) || (only && !only.has(i))) continue;
      const x = good.tx + ((i % p.w) + 0.5) * good.s;
      const y = good.ty + (Math.floor(i / p.w) + 0.5) * good.s;
      if (x < 40 || y < 40 || x > W - 40 || y > H - 80 || inMap(mapRect(p.w, p.h, W, H, good.s), x, y)) continue;
      if (bad) {
        const j = cellAt(bad, x, y);
        if (inMap(mapRect(p.w, p.h, W, H, bad.s), x, y) || (j >= 0 && p.cells[j] === t)) continue;
      }
      used.add(i);
      return { x, y, i };
    }
    return null;
  };
  const leftTo = (n: number) => page.waitForFunction((k) => Number(document.querySelector('[data-testid="where"]')?.textContent?.match(/(\d+)\s*$/)?.[1]) === k,
    n, { timeout: 5000 }).catch(() => {});
  // четыре щелчка колёсика от себя над серединой канвы; сколько точек в щелчке — по событиям браузера
  await page.evaluate(() => {
    const w = window as unknown as { wheels: [number, number, boolean][] };
    window.addEventListener('wheel', (e) => w.wheels.push([e.deltaY, e.deltaMode, e.ctrlKey]), { capture: true });
  });
  const away = async (from: Camera) => {
    await page.evaluate(() => { (window as unknown as { wheels: unknown[] }).wheels = []; });
    await page.mouse.move(box.x + W / 2, box.y + H / 2);
    for (let k = 0; k < 4; k++) {
      await page.mouse.wheel(0, 100);
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(300);
    let c = from;
    for (const [dy, mode, ctrl] of await page.evaluate(() => (window as unknown as { wheels: [number, number, boolean][] }).wheels)) {
      c = zoomAround(c, W / 2, H / 2, wheelFactor(dy, mode, ctrl, H), p.w, p.h, W, H);
    }
    return c;
  };
  const open = openCamera(p.w, p.h, W, H, false);
  const far = await away(open);
  const tap = pick(far);
  const l0 = await left();
  if (tap) await page.mouse.click(box.x + tap.x, box.y + tap.y);
  await page.waitForTimeout(600);
  const l1 = await left();
  // это место — в середине экрана, в масштабе открытия
  const cx = tap ? (tap.x - far.tx) / far.s : 0;
  const cy = tap ? (tap.y - far.ty) / far.s : 0;
  const near: Camera = { s: OPEN_DP, tx: clampX(W / 2 - cx * OPEN_DP, OPEN_DP, p.w, W), ty: clampY(H / 2 - cy * OPEN_DP, OPEN_DP, p.h, H) };
  const hit = tap ? pick(near, open) : null;
  if (hit) await page.mouse.click(box.x + hit.x, box.y + hit.y);
  await leftTo(l1 - 1);
  const l2 = await left();
  check(far.s < NUMBERS_DP && !!tap && l1 === l0 && !!hit && l2 === l1 - 1,
    `далеко (${far.s.toFixed(1)} точки на клетку): щелчок не вышил, а приблизил это место до масштаба открытия — следующий вышил (осталось ${l0} → ${l1} → ${l2})`);
  // перетаскивание далеко — с клетки выбранной нити: кисть вышила бы её сразу, на касании
  await page.waitForTimeout(300);
  const far2 = await away(near);
  const from = pick(far2);
  const l3 = await left();
  if (from) {
    await page.mouse.move(box.x + from.x, box.y + from.y);
    await page.mouse.down();
    for (let k = 1; k <= 10; k++) {
      await page.mouse.move(box.x + from.x - 8 * k, box.y + from.y - 5 * k);
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(150);
    await page.mouse.up();
  }
  await page.waitForTimeout(800);
  const l4 = await left();
  check(far2.s < NUMBERS_DP && !!from && l4 === l3, `далеко: перетаскивание двигает канву — кисти нет, ни одного стежка (осталось ${l3} → ${l4})`);

  // «Где ещё?» (docs/specs/2026-09-canvas.md, «Камера»): «0» — весь узор, номера не видны. Группа — по
  // движку (`nearestGroup`) от середины экрана; вышиты пока две клетки. Камера летит к группе в масштабе
  // открытия: щелчок по клетке группы вышивает, а при приближении к середине узора на её месте была бы
  // другая нить (если группа не у самой середины)
  await page.keyboard.press('0');
  await page.waitForTimeout(600);
  const ws = fitScale(p.w, p.h, W, H);
  const whole: Camera = { s: ws, tx: (W - p.w * ws) / 2, ty: (H - p.h * ws) / 2 };
  const stitched = new Uint8Array(p.cells.length);
  stitched[done] = 1;
  if (hit) stitched[hit.i] = 1;
  const g = nearestGroup(p, stitched, t, (W / 2 - whole.tx) / whole.s, (H / 2 - whole.ty) / whole.s);
  const at = (cx: number, cy: number): Camera => ({ s: OPEN_DP, tx: clampX(W / 2 - cx * OPEN_DP, OPEN_DP, p.w, W), ty: clampY(H / 2 - cy * OPEN_DP, OPEN_DP, p.h, H) });
  const flown = g ? at(g.cx, g.cy) : whole;
  const middle = at(p.w / 2, p.h / 2);
  const apart = Math.abs(flown.tx - middle.tx) >= OPEN_DP || Math.abs(flown.ty - middle.ty) >= OPEN_DP;
  const l5 = await left();
  await page.getByTestId('where').click();
  await page.waitForTimeout(800);
  const inGroup = pick(flown, apart ? middle : undefined, new Set(g?.cells ?? []));
  if (inGroup) await page.mouse.click(box.x + inGroup.x, box.y + inGroup.y);
  await leftTo(l5 - 1);
  const l6 = await left();
  check(whole.s < NUMBERS_DP && !!g && !!inGroup && l6 === l5 - 1,
    `«Где ещё?»: со всего узора — к ближайшей группе нити (${g?.cells.length ?? 0} кл.) в масштабе открытия, щелчок по ней вышил (осталось ${l5} → ${l6})`);
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
  // «Стежки на картинке „Поделиться“» сразу выключены (владелец, 15.10.2026), включаются и запоминаются
  await page.getByTestId('set-share-stitches').click();
  await page.waitForTimeout(200);
  const withStitches = await page.evaluate(() => localStorage.getItem('uzory.settings.v1') ?? '');
  await page.getByTestId('set-share-stitches').click();
  await page.waitForTimeout(200);
  check(stored.includes('"shareStitches":false') && withStitches.includes('"shareStitches":true'),
    'настройки: «Стежки на картинке „Поделиться“» сразу выключены, включаются и запоминаются');
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

  // пипетка: долгое касание чужой клетки выбирает её нить — «Где ещё?» считает клетки этой нити
  const own2 = first.cells.filter((c) => c === 1).length;
  await page.mouse.move(fp.x, fp.y);
  await page.mouse.down();
  await page.waitForTimeout(800);
  await page.mouse.up();
  await page.waitForTimeout(400);
  const pipetted = Number((await page.getByTestId('where').innerText()).match(/(\d+)\s*$/)?.[1]);
  check(pipetted === own2 || pipetted === own2 - 1, `пипетка: долгое касание выбрало нить клетки — «Где ещё?» ${pipetted} из ${own2}`);

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

    // смена стиля посреди работы (docs/specs/2026-09-canvas.md, критерий 5): канва перерисована
    // за 0,3 с, процент и нить на месте, и работа не открывалась заново — камера осталась
    // приближенной: щелчок по клетке, которая при камере открытия была бы клеткой другой нити, вышивает
    const styleSwitch = async (to: 'mosaic' | 'cross') => {
      await page.getByTestId('menu').click();
      await page.getByTestId('menu-panel').waitFor({ timeout: 5000 });
      await page.getByTestId(`menu-style-${to}`).click();
      await page.getByTestId('panel-close').click({ position: { x: 20, y: 400 } });
      await page.waitForTimeout(300);
    };
    const pctBefore = await page.getByTestId('percent').innerText();
    const leftBefore = await whereLeft();
    const shotCross = await page.getByTestId('canvas').screenshot();
    await styleSwitch('mosaic');
    const shotMosaic = await page.getByTestId('canvas').screenshot();
    const same = (await page.getByTestId('percent').innerText()) === pctBefore && (await whereLeft()) === leftBefore;
    check(same && !shotCross.equals(shotMosaic) && await stitchAt(target(closer, fit)),
      `смена стиля посреди работы: канва перерисована, работа, нить и камера на месте (${pctBefore}, «Где ещё?» ${leftBefore})`);
    await styleSwitch('cross');

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
  // время на «Готово» — минуты со стежками, а не от начала работы до конца (docs/08-game-design.md,
  // «Готово»): между заходами на первую картинку сценарий слушал музыку и открывал лист
  const doneStats = await page.getByTestId('done-stats').innerText();
  const firstStitches = first.cells.filter((c) => c !== CANVAS).length;
  check(new RegExp(`^${firstStitches} стеж(ок|ка|ков) · \\d+ минут[аы]?$`).test(doneStats), `«Готово»: «${doneStats}» — стежки и минуты со стежками`);
  await page.screenshot({ path: join(OUT, '03-done.png') });
  // «Поделиться» в вебе — файл PNG: работа в рамке, под ней подпись
  const shared = page.waitForEvent('download', { timeout: 15_000 });
  await page.getByTestId('share').click();
  const png = await shared.then(async (d) => ({ name: d.suggestedFilename(), bytes: readFileSync((await d.path())!) })).catch(() => null);
  const dims = png && png.bytes.subarray(1, 4).toString() === 'PNG' ? [png.bytes.readUInt32BE(16), png.bytes.readUInt32BE(20)] : [0, 0];
  const firstShare = shareLayout(first.w, first.h);
  check(png?.name === 'uzory-first-picture.png' && dims[0] === firstShare.width && dims[1] === firstShare.height,
    `«Поделиться»: ${png?.name ?? 'файл не скачался'} ${dims.join(' × ')} (по раскладке ${firstShare.width} × ${firstShare.height})`);
  if (png) writeFileSync(join(OUT, '03-share.png'), png.bytes);
  await page.getByTestId('replay').click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: join(OUT, '04-replay.png') });
  await page.getByTestId('skip').click().catch(() => {});
  await page.getByTestId('next').click();
  await page.getByTestId('daily-stitch').waitFor({ timeout: 10_000 }).catch(() => {});
  // сегодняшняя картинка дня — по календарю встроенного набора; если это «Розетка», начатая выше,
  // на её кнопке «Продолжить» (так и вышло 4 октября 2026 года)
  const todayStr = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const builtinPack = openPack(basePack);
  const dailyToday = new Daily({ calendar: mergedCalendar([builtinPack]), pictures: builtinPack.json.pictures }).on(todayStr);
  const dailyButton = dailyToday === 'rozetka' ? 'Продолжить' : 'Вышивать';
  check((await page.getByTestId('daily-stitch').innerText().catch(() => '')).includes(dailyButton) && (await page.getByTestId('first-stitch').count()) === 0,
    `первая картинка вышита — на главной картинка дня, на кнопке «${dailyButton}»`);

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
  // комментарий — что поправить (0.15.5): у «Нет» и у картинки без отметки; записывается, когда поле
  // теряет фокус, — здесь нажатием «Скопировать решения»
  await page.getByTestId('note-rozetka').fill('  мелко,   не видно лепестков ');
  await page.getByTestId('note-zvezda-alatyr').fill('темнее фон');
  await page.getByTestId('sheet-copy').click();
  await page.getByTestId('sheet-picks-text').waitFor({ timeout: 5000 }).catch(() => {});
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  check(picked.startsWith('Отмечено 2 из') && clip.includes('Да (1): Первая картинка (first-picture)')
    && clip.includes('Нет (1): Розетка (rozetka) — «мелко, не видно лепестков»')
    && clip.includes('Без отметки, с комментарием (1): Восьмиконечная звезда (zvezda-alatyr) — «темнее фон»')
    && !clip.includes('Позже'), `отбор в листе: ${picked}; решения с комментариями — в буфере обмена`);
  await page.getByTestId('sheet-filter-unmarked').click();
  await page.waitForTimeout(300);
  check((await page.getByTestId('sheet-first-picture').count()) === 0 && (await page.getByTestId('sheet-zvezda-alatyr').count()) === 1,
    '«Без отметки» — только неотмеченные');
  // отмеченная в «Без отметки» остаётся на экране до смены фильтра: после «Нет» можно дописать,
  // что поправить (0.15.6); фильтр сменили и вернули — её уже нет
  await page.getByTestId('pick-zvezda-alatyr-later').click();
  await page.waitForTimeout(300);
  const markedStays = (await page.getByTestId('sheet-zvezda-alatyr').count()) === 1;
  await page.getByTestId('sheet-filter-all').click();
  await page.getByTestId('sheet-filter-unmarked').click();
  await page.waitForTimeout(300);
  const markedGone = (await page.getByTestId('sheet-zvezda-alatyr').count()) === 0;
  await page.getByTestId('sheet-filter-all').click();
  await page.getByTestId('pick-zvezda-alatyr-later').click();
  check(markedStays && markedGone, '«Без отметки»: отмеченная картинка остаётся на экране, пока не сменят фильтр');
  // «Без «да»» — только картинки не для выпуска: запас без «да» есть, первой картинки (с «да») нет
  await page.getByTestId('sheet-filter-trial').click();
  await page.getByTestId('sheet-sinij-tsvetok').waitFor({ timeout: 5000 }).catch(() => {});
  check((await page.getByTestId('sheet-first-picture').count()) === 0 && (await page.getByTestId('sheet-sinij-tsvetok').count()) === 1,
    '«Без «да»» — только картинки не для выпуска');
  await page.getByTestId('sheet-filter-all').click();
  // коллекции — по частям (0.10.2): «Цветы» — только цветы, «Все» — снова все
  await page.getByTestId('sheet-coll-flowers').click();
  await page.waitForTimeout(300);
  const flowersOnly = (await page.getByTestId('sheet-first-picture').count()) === 0 && (await page.getByTestId('sheet-van-gogh-podsolnukhi').count()) === 1;
  await page.getByTestId('sheet-coll-all').click();
  await page.waitForTimeout(300);
  check(flowersOnly && (await page.getByTestId('sheet-first-picture').count()) === 1, 'в листе — коллекция «Цветы» отдельно, «Все» — снова все');
  await page.screenshot({ path: join(OUT, '05-sheet-picks.png') });
  // отметки и комментарии хранятся: лист открыт заново — всё на месте; нажатие на поле картинку не открывает
  await page.getByTestId('back').click();
  await page.getByTestId('home-sheet').click();
  await page.getByTestId('note-rozetka').waitFor();
  const keptNote = await page.getByTestId('note-rozetka').inputValue();
  const keptPicked = await page.getByTestId('sheet-picked').innerText();
  await page.getByTestId('note-rozetka').click();
  await page.waitForTimeout(300);
  check(keptNote === 'мелко, не видно лепестков' && keptPicked.includes('с комментарием — 2') && (await page.getByTestId('sheet-picked').count()) === 1,
    `лист открыт заново: комментарий «${keptNote}», ${keptPicked}`);
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
  // весь снимок, средняя: цвет клетки — преобладающий, и лес не рассыпается даже без упрощения
  // (по среднему цвету клетки мелких пятен было 3,3 % — «не подходит»; по умолчанию — «немного»)
  await page.getByTestId('mine-whole').click();
  await page.getByTestId('mine-size-M').click();
  await page.waitForFunction(() => /^70 × /.test(document.querySelector('[data-testid="mine-meta"]')?.textContent ?? ''), null, { timeout: 30_000 });
  // «Собираю узор…» появляется сразу после правки и уходит с новым узором
  const rebuilt = async () => {
    await page.getByTestId('mine-building').waitFor({ state: 'attached', timeout: 2000 }).catch(() => {});
    await page.getByTestId('mine-building').waitFor({ state: 'detached', timeout: 30_000 });
    return page.getByTestId('mine-verdict').innerText();
  };
  const simplify = async (level: number) => {
    await page.getByTestId(`mine-simplify-${level}`).click();
    return rebuilt();
  };
  const zontiki = await simplify(0);
  check(!/Не подходит/.test(zontiki) && !(await page.getByTestId('mine-stitch').isDisabled()),
    `«Зонтики в парке» без упрощения: ${zontiki.split('\n')[0]} — по преобладающему цвету клетки лес не рассыпается`);
  // пёстрая листва — пятна пяти зелёных чуть крупнее клетки (как в tools/test/mine.test.ts): без
  // упрощения рассыпается на мелкие пятна — «не подходит»; «сильно» выравнивает пятна — подходит
  const leavesFile = join(OUT, 'mine-leaves.png');
  const greens = [0x2e5e3a, 0x4f8a3c, 0x7fb35a, 0x1d3b24, 0xa8c46a];
  const leaves = Buffer.alloc(700 * 525 * 3);
  for (let y = 0; y < 525; y++) {
    for (let x = 0; x < 700; x++) {
      const c = greens[hash32(`${Math.floor((x / 700) * 40)},${Math.floor((y / 525) * 30)}`) % 5];
      leaves.set([c >> 16, (c >> 8) & 255, c & 255], (y * 700 + x) * 3);
    }
  }
  await sharp(leaves, { raw: { width: 700, height: 525, channels: 3 } }).png().toFile(leavesFile);
  const chooser2 = page.waitForEvent('filechooser');
  await page.getByTestId('mine-other').click();
  await (await chooser2).setFiles(leavesFile);
  const plain = await rebuilt();
  check(/Не подходит/.test(plain) && await page.getByTestId('mine-stitch').isDisabled(), `пёстрая листва без упрощения: ${plain.split('\n')[0]}, «Вышивать» неактивна`);
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
  check(!!jpgFile && /\npattern:\n {2}crop: \[/.test(yamlText) && /\n {2}size: 70\n/.test(yamlText) && /\n {2}simplify: 2 /.test(yamlText)
    && /\n {2}grid: dominant /.test(yamlText) && /\n {2}chroma: 1\.15 /.test(yamlText),
    `карточка для библиотеки: ${downloads.map((d) => d.suggestedFilename()).join(', ')}`);
  await page.getByTestId('mine-stitch').click();
  await page.getByTestId('canvas').waitFor({ timeout: 30_000 });
  // заливки в трёх местах канвы: чужая клетка — «Выбрать» её нить, потом двойное касание
  await page.waitForTimeout(1500);
  const mb = (await page.getByTestId('canvas').boundingBox())!;
  for (const fx of [0.3, 0.5, 0.7]) {
    const at = { x: mb.x + mb.width * fx, y: mb.y + mb.height / 2 };
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(400);
    if (await page.getByTestId('pick').count()) {
      await page.getByTestId('pick').click();
      await page.waitForTimeout(200);
    }
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(80);
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(400);
  }
  const minePercent = await page.getByTestId('percent').innerText();
  check(/^[1-9]\d*\s%$/.test(minePercent), `свой узор открылся на канве и вышивается: ${minePercent}`);
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
  await page.waitForTimeout(1000);
  const mineAgain = await page.getByTestId('percent').innerText();
  check(mineAgain === minePercent, `после перезагрузки свой узор продолжается: ${minePercent} → ${mineAgain}`);
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
    await page3.waitForTimeout(1000);
    const moved = await page3.getByTestId('percent').innerText();
    check(moved === minePercent, `свой узор из файла открылся на канве с той же работой: ${moved}`);
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
  check(await page.getByTestId('file-share').isVisible(), '«Файл работы»: числа можно отправить одним сообщением — «Поделиться числами»');
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
  // «Как вышивалось» большой картины (docs/specs/2026-09-library.md, критерий 3): от 8 до 12 секунд —
  // от появления «Пропустить» до возвращения «Как вышивалось», по кадрам страницы; в конце на канве —
  // все стежки, как до показа
  const frameBefore = await page2.getByTestId('done-frame').screenshot();
  const shown = (id: string) => page2.waitForFunction((t) => !!document.querySelector(`[data-testid="${t}"]`), id, { polling: 'raf', timeout: 20_000 })
    .then(() => Date.now(), () => NaN);
  await page2.getByTestId('replay').click();
  const playFrom = await shown('skip');
  const playMs = (await shown('replay')) - playFrom;
  const playing = !Number.isNaN(playMs);
  await page2.waitForTimeout(300);
  const frameAfter = await page2.getByTestId('done-frame').screenshot();
  check(playing && playMs >= 8000 && playMs <= 12_500 && frameBefore.equals(frameAfter),
    `«Как вышивалось» большой картины (${girls.w} × ${girls.h}) — ${(playMs / 1000).toFixed(1)} с, в конце все стежки на месте`);
  await page2.getByTestId('done-about').click();
  const aboutText = await page2.getByTestId('done-about-panel').innerText().catch(() => '');
  check(aboutText.includes('Прокудин-Горский (1863–1944), 1909') && aboutText.includes('Источник: www.loc.gov')
    && aboutText.includes('Сергей Прокудин-Горский. Крестьянские девушки, 1909. Схема для вышивки по мотивам снимка')
    && aboutText.includes('Сарафан когда-то носили мужчины'),
    '«Готово» картины: «О картине» — автор с годами жизни, год, рассказ, подпись и источник');
  await page2.screenshot({ path: join(OUT, '03-done-about.png') });
  await page2.getByTestId('done-about-close').click();
  const shared2 = page2.waitForEvent('download', { timeout: 20_000 });
  await page2.getByTestId('share').click();
  const png2 = await shared2.then(async (d) => ({ name: d.suggestedFilename(), bytes: readFileSync((await d.path())!) })).catch(() => null);
  const dims2 = png2 ? [png2.bytes.readUInt32BE(16), png2.bytes.readUInt32BE(20)] : [0, 0];
  // мелкая клетка (меньше SHARE_STITCHES_FROM) — цветом в любом стиле; под рамкой — название, автор и год,
  // «Вышито в „Узорах“ по мотивам снимка»
  const look2 = png2 ? await lookAtShare(png2.bytes, girls) : null;
  check(png2?.name === 'uzory-pg-krestyanskie-devushki.png' && !!look2?.size && look2.frame && !look2.stitches
    && look2.tile >= 0.95 * look2.cells && look2.lines.title > 400 && look2.lines.caption > 400 && look2.lines.mark > 200,
    `«Поделиться» большой картины: ${png2?.name ?? 'файл не скачался'} ${dims2.join(' × ')}, рамка ${look2?.frame ? 'на месте' : 'не та'}, `
    + `клетки цветом ${look2?.tile}/${look2?.cells}, строки подписи ${look2 ? `${look2.lines.title}/${look2.lines.caption}/${look2.lines.mark}` : '—'} точек`);
  await page2.getByTestId('next').click();
  await page2.getByTestId('picture').waitFor({ timeout: 5000 }).catch(() => {});
  check((await page2.getByTestId('picture').count()) === 1, '«Дальше» после картины — карточка следующей картинки');
  await ctx2.close();

  // «Поделиться» в выбранном стиле (docs/specs/2026-09-library.md, «Готово», критерий приёмки 3): одна
  // и та же законченная работа — со «Стежками на картинке» в «Крестике» и в «Мозаике» и без них
  // (так сразу после установки), каждая в чистой вкладке. Клетка на картинке — 64 точки: в «Крестике»
  // у середины стороны клетки — канва, в середине — нить; в «Мозаике» и без стежков вся клетка — нить.
  // Под рамкой — название и «Вышито в „Узорах“»: это своя работа студии, подписи картины нет
  const gribok = built.find((b) => b.card.id === 'kids-gribok')!.pattern;
  const gTail = allButLast(gribok);
  const shareIn = async (style: 'cross' | 'mosaic', stitches?: boolean) => {
    const name = stitches ? style : `${style}-flat`;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => errors.push(e.message));
    pg.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await pg.goto(base);
    const lx = gTail.last % gribok.w;
    await seedWork(pg, seed(`w-e2e-share-${name}`, gribok, gTail.strokes, { x: lx + 0.5, y: (gTail.last - lx) / gribok.w + 0.5 }),
      { 'uzory.settings.v1': JSON.stringify(stitches === undefined ? { style } : { style, shareStitches: stitches }) });
    await pg.getByTestId('continue').click();
    await pg.getByTestId('canvas').waitFor({ timeout: 30_000 });
    await pg.waitForTimeout(1500);
    const pt = await cellPoint(pg, gribok, gTail.last);
    await pg.mouse.click(pt.x, pt.y);
    const done = await pg.getByTestId('replay').waitFor({ timeout: 15_000 }).then(() => true, () => false);
    const dl = done ? pg.waitForEvent('download', { timeout: 15_000 }) : null;
    if (done) await pg.getByTestId('share').click();
    const bytes = dl ? await dl.then(async (d) => readFileSync((await d.path())!)).catch(() => null) : null;
    await ctx.close();
    if (bytes) writeFileSync(join(OUT, `03-share-${name}.png`), bytes);
    return bytes ? lookAtShare(bytes, gribok) : null;
  };
  const crossLook = await shareIn('cross', true);
  const tileLook = await shareIn('mosaic', true);
  const flatLook = await shareIn('cross');
  const studioCaption = (l: typeof crossLook) => !!l && l.lines.title > 400 && l.lines.mark > 200 && l.lines.caption < 100;
  check(!!crossLook?.size && crossLook.frame && crossLook.stitches && crossLook.cells >= 20
    && crossLook.cross >= 0.95 * crossLook.cells && crossLook.tile === 0 && studioCaption(crossLook),
    `«Поделиться» в «Крестике»: крестиками ${crossLook?.cross}/${crossLook?.cells} клеток, плиткой ${crossLook?.tile}, `
    + `рамка ${crossLook?.frame ? 'на месте' : 'не та'}, подпись ${crossLook ? `${crossLook.lines.title}/${crossLook.lines.caption}/${crossLook.lines.mark}` : '—'} точек`);
  check(!!tileLook?.size && tileLook.frame && tileLook.stitches && tileLook.cells >= 20
    && tileLook.tile >= 0.95 * tileLook.cells && tileLook.cross === 0 && studioCaption(tileLook),
    `«Поделиться» в «Мозаике»: плиткой ${tileLook?.tile}/${tileLook?.cells} клеток, крестиками ${tileLook?.cross}, `
    + `рамка ${tileLook?.frame ? 'на месте' : 'не та'}, подпись ${tileLook ? `${tileLook.lines.title}/${tileLook.lines.caption}/${tileLook.lines.mark}` : '—'} точек`);
  check(!!flatLook?.size && flatLook.frame && flatLook.cells >= 20
    && flatLook.tile >= 0.95 * flatLook.cells && flatLook.cross === 0 && studioCaption(flatLook),
    `«Поделиться» без «Стежков на картинке» (так сразу): ровным цветом ${flatLook?.tile}/${flatLook?.cells} клеток, крестиками ${flatLook?.cross}, `
    + `рамка ${flatLook?.frame ? 'на месте' : 'не та'}`);

  // без сети, с чистой установки (docs/specs/2026-09-library.md, критерий 1; ADR 0007): сервер
  // картинок недоступен — до первого стежка два касания (docs/specs/2026-09-first-picture.md,
  // критерий 1), главная без строки о сети; картинка дня из календаря и первая картинка «России
  // в цвете» (большая) из библиотеки открываются и вышиваются, на их карточках после этого —
  // «Продолжить»; в консоли — только отказы сети
  const ctxOff = await browser.newContext({ viewport: { width: 400, height: 860 } });
  await ctxOff.route('**/uzory/v1/**', (r) => r.abort('internetdisconnected'));
  const off = await ctxOff.newPage();
  const offErrors: string[] = [];
  off.on('pageerror', (e) => offErrors.push(e.message));
  off.on('console', (m) => { if (m.type() === 'error' && !/ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(m.text())) offErrors.push(m.text()); });
  const offLeft = async () => Number((await off.getByTestId('where').innerText()).match(/(\d+)\s*$/)?.[1]);
  // новая работа открылась (полоса нитей — когда работа прочитана): касание клетки у середины экрана
  // (если она не первой нити — сперва её нить в полосе), «Где ещё?» — на одну меньше
  const offStitch = async (p: Pattern) => {
    await off.getByTestId('thread-1').waitFor({ timeout: 30_000 });
    await off.waitForTimeout(1500);
    const cell = await openCell(off, p);
    const t = p.cells[cell];
    if (t !== 0) await off.getByTestId(`thread-${t + 1}`).click();
    const before = await offLeft();
    const pt = await cellPoint(off, p, cell);
    await off.mouse.click(pt.x, pt.y);
    await off.waitForFunction((n) => Number(document.querySelector('[data-testid="where"]')?.textContent?.match(/(\d+)\s*$/)?.[1]) === n - 1,
      before, { timeout: 5000 }).catch(() => {});
    return { before, after: await offLeft(), t, cell };
  };
  // со стежка — назад на карточку: начатая работа сохранилась, на кнопке «Продолжить»
  const offCard = async () => {
    await off.getByTestId('back').click();
    await off.waitForFunction(() => document.querySelector('[data-testid="picture-stitch"]')?.textContent?.startsWith('Продолжить'), null, { timeout: 5000 }).catch(() => {});
    return off.getByTestId('picture-stitch').innerText().catch(() => '');
  };
  await off.goto(base);
  await off.getByTestId('first-stitch').click();
  const one = await offStitch(first);
  check(one.t === 0 && one.after === one.before - 1, `без сети, с чистой установки: до первого стежка — два касания (осталось ${one.before} → ${one.after})`);
  await off.getByTestId('back').click();
  await off.getByTestId('home-library').waitFor();
  const offNet = await off.getByTestId('home-net').count();

  // картинка дня — та, что по календарю встроенного набора на сегодня
  const builtin = openPack(basePack);
  const picOf = (id: string | undefined) => builtin.json.pictures.find((p) => p.id === id);
  const daily = picOf(new Daily({ calendar: mergedCalendar([builtin]), pictures: builtin.json.pictures }).on(todayStr));
  await off.getByTestId('home-calendar').click();
  await off.getByTestId('calendar').waitFor({ timeout: 10_000 });
  await off.getByTestId(`day-pic-${todayStr}`).click();
  await off.getByTestId('picture').waitFor({ timeout: 5000 });
  const dailyCard = await off.getByTestId('picture').innerText();
  await off.getByTestId('picture-stitch').click();
  const two = daily ? await offStitch(packPattern(builtin, daily)) : { before: 0, after: 0, t: 0, cell: -1 };
  const dailyAgain = await offCard();
  check(!!daily && dailyCard.includes(daily.title) && two.after === two.before - 1 && dailyAgain.startsWith('Продолжить'),
    `без сети: картинка дня «${daily?.title}» из календаря вышивается (осталось ${two.before} → ${two.after}), на карточке — «${dailyAgain}»`);
  await off.getByTestId('back').click();
  await off.getByTestId('calendar').waitFor();
  await off.getByTestId('back').click();

  // любая картинка встроенного набора — первая в «России в цвете» (большая; не картинка дня). В сборке
  // для проверки открыто всё: метка «Узоры+» на плитке не запирает
  await off.getByTestId('home-library').click();
  await off.getByTestId('library').waitFor({ timeout: 15_000 });
  await off.getByTestId('lib-all-russia').click();
  await off.getByTestId('collection').waitFor({ timeout: 10_000 });
  await off.locator('[data-testid^="tile-"]').first().waitFor({ timeout: 10_000 });
  const tiles = await off.locator('[data-testid^="tile-"]').evaluateAll((els) => els.map((e) => (e.getAttribute('data-testid') ?? '').slice('tile-'.length)));
  const ru = picOf(tiles.find((id) => id !== daily?.id));
  const ruPattern = ru ? packPattern(builtin, ru) : null;
  await off.getByTestId(`tile-${ru?.id}`).click();
  await off.getByTestId('picture-stitch').click();
  const three = ruPattern ? await offStitch(ruPattern) : { before: 0, after: 0, t: 0, cell: -1 };
  check(!!ru && three.after === three.before - 1,
    `без сети: «${ru?.title}» (${ru?.size}) из библиотеки открылась и вышивается (осталось ${three.before} → ${three.after})`);
  // заодно «далеко»: большая картинка открыта новой работой, вышита одна клетка
  if (ruPattern) await farAway(off, ruPattern, three.t, three.cell);
  const ruAgain = await offCard();
  check(ruAgain.startsWith('Продолжить'), `без сети: работа над «${ru?.title}» сохранилась — на карточке «${ruAgain}»`);
  await off.getByTestId('back').click();
  await off.getByTestId('collection').waitFor();
  await off.getByTestId('back').click();
  await off.getByTestId('library').waitFor();
  await off.getByTestId('back').click();
  await off.getByTestId('home-library').waitFor();
  check(offNet === 0 && offErrors.length === 0,
    `без сети: главная без строки о сети, в консоли — только отказы сети${offErrors.length ? `; ошибки: ${offErrors.slice(0, 3).join(' | ')}` : ''}`);
  await ctxOff.close();

  // пальцы (docs/specs/2026-09-canvas.md, «Жесты», критерий 2) — касания через CDP: касание клетки
  // вышивает её сразу; второй палец в первые 100 мс — это был масштаб: стежка нет, канва как была;
  // второй палец позже — стежок остаётся. Промежуток между пальцами — по событиям страницы: если на
  // медленной машине «сразу» опоздало, ещё попытка на другой клетке
  const ctxTouch = await browser.newContext({ viewport: { width: 400, height: 860 }, hasTouch: true });
  const tp = await ctxTouch.newPage();
  tp.on('pageerror', (e) => errors.push(e.message));
  await tp.addInitScript(() => {
    const w = window as unknown as { downs: number[] };
    w.downs = [];
    window.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') w.downs.push(e.timeStamp); }, { capture: true });
  });
  await tp.goto(base);
  await tp.getByTestId('first-stitch').click();
  await tp.getByTestId('thread-1').waitFor({ timeout: 30_000 });
  await tp.waitForTimeout(1500);
  const tcdp = await ctxTouch.newCDPSession(tp);
  const fingers = (type: 'touchStart' | 'touchEnd', points: { x: number; y: number }[]) =>
    tcdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((q, id) => ({ x: q.x, y: q.y, id })) });
  const tLeft = async () => Number((await tp.getByTestId('where').innerText()).match(/(\d+)\s*$/)?.[1]);
  const gap = async () => {
    const d = await tp.evaluate(() => (window as unknown as { downs: number[] }).downs.splice(0));
    return d.length === 2 ? Math.round(d[1] - d[0]) : NaN;
  };
  const tb = (await tp.getByTestId('canvas').boundingBox())!;
  const aside = { x: tb.x + tb.width * 0.75, y: tb.y + tb.height * 0.8 };
  const own = [...first.cells.keys()].filter((i) => first.cells[i] === 0);
  const tap0 = await tLeft();
  await fingers('touchStart', [await cellPoint(tp, first, own[0])]);
  await fingers('touchEnd', []);
  await tp.waitForTimeout(600);
  const tap1 = await tLeft();
  check(tap1 === tap0 - 1, `палец: касание клетки — стежок сразу (осталось ${tap0} → ${tap1})`);
  // второй палец «сразу», без движения: до 3 попыток, пока он не придёт раньше 100 мс
  let early = { gap: NaN, before: 0, after: 0, same: false };
  for (let k = 1; k <= 3 && !(early.gap < 100); k++) {
    await gap();
    const at = await cellPoint(tp, first, own[k]);
    const before = await tLeft();
    const shot = await tp.getByTestId('canvas').screenshot();
    await fingers('touchStart', [at]);
    await fingers('touchStart', [at, aside]);
    await tp.waitForTimeout(30);
    await fingers('touchEnd', []);
    await tp.waitForTimeout(800);
    early = { gap: await gap(), before, after: await tLeft(), same: shot.equals(await tp.getByTestId('canvas').screenshot()) };
  }
  check(early.gap < 100 && early.after === early.before && early.same,
    `второй палец через ${early.gap} мс: это был масштаб — стежка нет, канва как была (осталось ${early.before} → ${early.after})`);
  await gap();
  const late0 = await tLeft();
  const lateAt = await cellPoint(tp, first, own[4]);
  await fingers('touchStart', [lateAt]);
  await tp.waitForTimeout(250);
  await fingers('touchStart', [lateAt, aside]);
  await tp.waitForTimeout(30);
  await fingers('touchEnd', []);
  await tp.waitForTimeout(800);
  const lateGap = await gap();
  const late1 = await tLeft();
  check(lateGap >= 100 && late1 === late0 - 1, `второй палец через ${lateGap} мс: стежок касания остался (осталось ${late0} → ${late1})`);
  await ctxTouch.close();

  // подсказка про колёсико и два пальца (docs/specs/2026-09-first-picture.md, критерий 3): в
  // основном сценарии колёсико приближало ещё до середины — подсказки там нет. Здесь камеру не
  // трогают: заливками вышита больше чем половина первой картинки — все нити, кроме самой большой
  // (у неё клеток с запасом, «Где ещё?» не пора), — и подсказка появляется; колёсико — уходит
  const ctxZoom = await browser.newContext({ viewport: { width: 400, height: 860 } });
  const zp = await ctxZoom.newPage();
  zp.on('pageerror', (e) => errors.push(e.message));
  await zp.goto(base);
  await zp.getByTestId('first-stitch').click();
  await zp.getByTestId('thread-1').waitFor({ timeout: 30_000 });
  await zp.waitForTimeout(1500);
  const counts = first.threads.map((_, t) => first.cells.filter((c) => c === t).length);
  const biggest = counts.indexOf(Math.max(...counts));
  const zFilled = new Uint8Array(first.cells.length);
  for (let t = 0; t < first.threads.length; t++) {
    if (t === biggest) continue;
    await zp.getByTestId(`thread-${t + 1}`).click();
    for (let i = 0; i < first.cells.length; i++) {
      if (first.cells[i] !== t || zFilled[i]) continue;
      for (const c of fillRegion(first, zFilled, i)) zFilled[c] = 1;
      const pt = await cellPoint(zp, first, i);
      await zp.mouse.click(pt.x, pt.y);
      await zp.waitForTimeout(80);
      await zp.mouse.click(pt.x, pt.y);
      await zp.waitForTimeout(400);
    }
  }
  await zp.getByTestId(`thread-${biggest + 1}`).click();
  const half = await zp.getByTestId('hint-zoom').waitFor({ timeout: 5000 }).then(() => true, () => false);
  const halfPct = await zp.getByTestId('percent').innerText();
  const zoomText = await zp.getByTestId('hint-zoom').innerText().catch(() => '');
  const zb = (await zp.getByTestId('canvas').boundingBox())!;
  await zp.mouse.move(zb.x + zb.width / 2, zb.y + zb.height / 2);
  await zp.mouse.wheel(0, -100);
  await zp.waitForTimeout(600);
  check(half && zoomText.includes('Колёсико') && (await zp.getByTestId('hint-zoom').count()) === 0,
    `на середине первой картинки (${halfPct}) — подсказка «${zoomText}», колёсико её убрало`);
  await ctxZoom.close();

  // убить посреди кисти (docs/specs/2026-09-canvas.md, критерий 4): долгий штрих мышью змейкой по
  // первой картинке, и посреди него процесс вкладки убит сигналом, как `adb shell am kill`: ни ухода с
  // экрана, ни записи напоследок. Штрих уходит в работу частями раз в секунду (FLUSH_MS в
  // src/canvas/StitchCanvas.tsx), работа пишется сразу за ним (SAVE_MS в src/state/works.ts) —
  // запись работы ловится в IndexedDB. Новая вкладка того же браузера открывает работу: пропал только
  // конец следа — то, что кисть провела после последней записи, не больше секунды с записью (1,25 с)
  {
    const LOST_MS = 1250;
    // процессы страниц: процесс новой вкладки — тот, которого до неё не было
    const bcdp = await browser.newBrowserCDPSession();
    const renderers = async () => (await bcdp.send('SystemInfo.getProcessInfo')).processInfo.filter((r) => r.type === 'renderer').map((r) => r.id);
    const before = await renderers();
    const ctxKill = await browser.newContext({ viewport: { width: 400, height: 860 } });
    const kp = await ctxKill.newPage();
    kp.on('pageerror', (e) => errors.push(e.message));
    await kp.addInitScript(() => {
      const w = window as unknown as { workWrites: number[] };
      w.workWrites = [];
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
        if (typeof key === 'string' && key.endsWith('.log')) this.transaction.addEventListener('complete', () => w.workWrites.push(performance.now()));
        return put.call(this, value, key);
      };
    });
    await kp.goto(base);
    await kp.getByTestId('first-stitch').click();
    await kp.getByTestId('thread-1').waitFor({ timeout: 30_000 });
    await kp.waitForTimeout(1500);
    const kcdp = await ctxKill.newCDPSession(kp);
    const kb = (await kp.getByTestId('canvas').boundingBox())!;
    const kc = openCamera(first.w, first.h, kb.width, kb.height, false);
    const at = (i: number) => ({ x: kb.x + kc.tx + ((i % first.w) + 0.5) * kc.s, y: kb.y + kc.ty + (Math.floor(i / first.w) + 0.5) * kc.s });
    // змейка: строка слева направо, следующая — справа налево, шаг — клетка
    const path: number[] = [];
    for (let y = 0; y < first.h; y++) for (let k = 0; k < first.w; k++) path.push(y * first.w + (y % 2 ? first.w - 1 - k : k));
    const own1 = first.cells.filter((c) => c === 0).length;
    // часы сценария и страницы: время записи на странице → время сценария
    const ta = performance.now();
    const pageNow = await kp.evaluate(() => performance.now());
    const shift = (ta + performance.now()) / 2 - pageNow;
    /** когда кисть дошла до клетки первой нити — по порядку следа */
    const reached: number[] = [];
    const p0 = at(path[0]);
    await kp.mouse.move(p0.x, p0.y);
    await kp.mouse.down();
    const t0 = performance.now();
    if (first.cells[path[0]] === 0) reached.push(t0);
    for (const i of path.slice(1)) {
      const p = at(i);
      await kp.mouse.move(p.x, p.y);
      if (first.cells[i] === 0) reached.push(performance.now());
      if (performance.now() - t0 >= 2600) break;
      await kp.waitForTimeout(8);
    }
    const writes = (await kp.evaluate(() => (window as unknown as { workWrites: number[] }).workWrites)).map((t) => t + shift);
    // Page.crash в CI вкладку не ронял (сборка v0.15.2: 30 с без события crash, локально — 28 мс);
    // сигнал процессу страницы роняет её в любой среде. Page.crash — только если процесс не нашёлся
    const own = (await renderers()).filter((id) => !before.includes(id));
    const crash = performance.now();
    const crashed = kp.waitForEvent('crash', { timeout: 15_000 }).then(() => true, () => false);
    let how = `SIGKILL процессу страницы (${own.length})`;
    if (own.length) for (const id of own) process.kill(id, 'SIGKILL');
    else {
      how = 'Page.crash';
      void kcdp.send('Page.crash').catch((e: Error) => { how += `: ${e.message.split('\n')[0]}`; });
    }
    if (!(await crashed)) check(false, `убить посреди кисти: вкладка не упала за 15 с (${how})`);
    else {
      // записи за время штриха: первая — не позже секунды с записью от начала, дальше так же
      const during = writes.filter((t) => t > t0);
      const gaps = [...during, crash].map((t, k) => Math.round(t - (k ? during[k - 1] : t0)));
      const kp2 = await ctxKill.newPage();
      kp2.on('pageerror', (e) => errors.push(e.message));
      await kp2.goto(base);
      await kp2.getByTestId('first-stitch').waitFor({ timeout: 60_000 });
      const again = await kp2.getByTestId('first-stitch').innerText();
      await kp2.getByTestId('first-stitch').click();
      await kp2.getByTestId('thread-1').waitFor({ timeout: 30_000 });
      await kp2.getByTestId('thread-1').click();
      await kp2.waitForTimeout(500);
      const kept = own1 - Number((await kp2.getByTestId('where').innerText()).match(/(\d+)\s*$/)?.[1]);
      // в работе — начало следа: пропало то, что кисть провела после первой не записанной клетки
      const lost = kept >= reached.length ? 0 : Math.round(crash - reached[kept]);
      check(during.length >= 2 && Math.max(...gaps) <= LOST_MS && kept > 0 && kept <= reached.length && lost <= LOST_MS,
        `убить посреди кисти: штрих ${Math.round(crash - t0)} мс, клеток первой нити — ${reached.length}, записей работы — ${during.length} (промежутки ${gaps.join(', ')} мс); вкладка упала (${how}), в работе ${kept} — пропали последние ${lost} мс следа («${again}»)`);
    }
    await bcdp.detach();
    await ctxKill.close();
  }

  // «Узоры+» с магазином (docs/specs/2026-09-plus.md, «Покупка» и критерий 3): веб-сборка 0.x на
  // 127.0.0.1 берёт заглушку RuStore Pay из хранилища (src/state/fakeBilling.ts) — её цены, покупку,
  // отказ, сбой и «нет RuStore»; запирание — как в 1.0. Строка «Вся библиотека — в „Узоры+“» на
  // «Готово» — после бесплатной картинки, не в первые три дня после установки и не второй раз за день;
  // на главной подписку игра сама не предлагает. Две начатые картинки «Детям» (бесплатные) — без
  // последней клетки; «Продолжить» открывает их по очереди
  {
    const FAKE = 'uzory.billing.fake.v1';
    const OFFER = 'Вся библиотека — в «Узоры+»';
    const kids = ['kids-gribok', 'kids-arbuz', 'kids-domik'].filter((id) => id !== dailyToday).slice(0, 2)
      .map((id) => {
        const p = built.find((b) => b.card.id === id)!.pattern;
        const { strokes, last } = allButLast(p);
        // работа открывается там, где вышивали в прошлый раз, — у последней клетки
        return { id, p, strokes, last, at: { x: (last % p.w) + 0.5, y: Math.floor(last / p.w) + 0.5 } };
      });
    const plusPage = async (mode: string, installedAgo: number) => {
      const ctx = await browser.newContext({ viewport: { width: 400, height: 860 } });
      const pg = await ctx.newPage();
      pg.on('pageerror', (e) => errors.push(e.message));
      pg.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      await pg.goto(base);
      await seedWorks(pg, kids.map((k) => seed(`w-e2e-plus-${k.id}`, k.p, k.strokes, k.at)), {
        [FAKE]: JSON.stringify({ mode }),
        'uzory.settings.v1': JSON.stringify({ previewLock: true }),
        'uzory.player.v1': JSON.stringify({ installed: addDays(todayStr, -installedAgo), seen: todayStr, pinned: {}, firstDone: true, hints: [] }),
      });
      return { ctx, pg };
    };
    /** Последний стежок картинки, которую открывает «Продолжить»; на «Готово» — строка «Узоры+» или пусто. */
    const finish = async (pg: Page, k: (typeof kids)[number]) => {
      await pg.getByTestId('continue').click();
      await pg.getByTestId('canvas').waitFor({ timeout: 30_000 });
      await pg.waitForTimeout(1500);
      const box = (await pg.getByTestId('canvas').boundingBox())!;
      const c = openCamera(k.p.w, k.p.h, box.width, box.height, false, k.at);
      await pg.mouse.click(box.x + c.tx + k.at.x * c.s, box.y + c.ty + k.at.y * c.s);
      await pg.getByTestId('replay').waitFor({ timeout: 15_000 });
      const line = await pg.getByTestId('done-plus').innerText().catch(() => '');
      // с «Готово» — «Дальше»: карточка следующей картинки, с неё — на главную
      await pg.getByTestId('next').click();
      await pg.getByTestId('picture').waitFor({ timeout: 5000 }).catch(() => {});
      if (await pg.getByTestId('picture').count()) await pg.getByTestId('back').click();
      await pg.getByTestId('home-library').waitFor();
      return line;
    };
    /** Запертая картинка «Живописи» → «Подробнее» → экран «Узоры+»; цены — у магазина. */
    const toPlus = async (pg: Page) => {
      await pg.getByTestId('home-library').click();
      await pg.getByTestId('lib-all-painting').click();
      await pg.getByTestId('collection').waitFor();
      const tile = pg.locator('[data-testid^="tile-"]', { hasText: 'Узоры+' }).first();
      await tile.waitFor({ timeout: 10_000 });
      await tile.click();
      await pg.getByTestId('picture-more').click();
      await pg.getByTestId('plus').waitFor();
      await pg.waitForTimeout(500);
    };

    // на третий день после установки: первая бесплатная за день — со строкой, вторая — без
    {
      const { ctx, pg } = await plusPage('ok', 3);
      const first = await finish(pg, kids[0]);
      const second = await finish(pg, kids[1]);
      const home = await pg.locator('body').innerText();
      check(first === OFFER && second === '' && !home.includes(OFFER),
        `«Узоры+» на «Готово»: на третий день после бесплатной картинки — «${first}», вторая за день — ${second ? `«${second}»` : 'без строки'}; на главной подписку не предлагают`);
      await toPlus(pg);
      const text = await pg.getByTestId('plus').innerText();
      check(text.includes('249 ₽ в месяц') && text.includes('1490 ₽ в год') && text.includes('≈ 124 ₽ в месяц') && (await pg.getByTestId('plus-sample').count()) === 0,
        'экран «Узоры+» с магазином: цены — у магазина, а не образца');
      const mode = (m: string) => pg.evaluate(([k, v]) => localStorage.setItem(k, v), [FAKE, JSON.stringify({ mode: m })] as const);
      await mode('cancelled');
      await pg.getByTestId('plus-buy').click();
      await pg.waitForTimeout(600);
      const quiet = (await pg.getByTestId('plus-said').count()) === 0 && (await pg.getByTestId('plus-active').count()) === 0;
      await mode('failed');
      await pg.getByTestId('plus-buy').click();
      await pg.getByTestId('plus-said').waitFor({ timeout: 5000 }).catch(() => {});
      const failed = await pg.getByTestId('plus-said').innerText().catch(() => '');
      await mode('ok');
      await pg.getByTestId('plus-buy').click();
      await pg.getByTestId('plus-active').waitFor({ timeout: 5000 }).catch(() => {});
      const bought = await pg.getByTestId('plus-said').innerText().catch(() => '');
      const back = await pg.getByTestId('picture-stitch').waitFor({ timeout: 5000 }).then(() => true, () => false);
      check(quiet && failed.includes('Платёж не прошёл') && bought.includes('вся библиотека открыта') && back,
        `покупка: отказ — тихо, сбой — «${failed}», успех — «${bought}» и назад на карточку, уже с «Вышивать»`);
      await ctx.close();
    }
    // на второй день после установки — строки нет
    {
      const { ctx, pg } = await plusPage('ok', 2);
      const line = await finish(pg, kids[0]);
      check(line === '', `в первые три дня после установки строки «Узоры+» на «Готово» нет${line ? ` (а есть «${line}»)` : ''}`);
      await ctx.close();
    }
    // нет RuStore: цены не узнать — кнопка неактивна; «Восстановить покупки» говорит, что не спросить
    {
      const { ctx, pg } = await plusPage('no-store', 3);
      await toPlus(pg);
      const noPrice = await pg.getByTestId('plus-no-price').innerText().catch(() => '');
      const disabled = (await pg.getByTestId('plus-buy').getAttribute('aria-disabled')) === 'true';
      await pg.getByTestId('plus-restore').click();
      await pg.getByTestId('plus-said').waitFor({ timeout: 5000 }).catch(() => {});
      const said = await pg.getByTestId('plus-said').innerText().catch(() => '');
      check(noPrice.includes('Не удалось узнать цену') && disabled && said.includes('Не удалось спросить RuStore'),
        `нет RuStore: «${noPrice}», кнопка неактивна, «Восстановить покупки» — «${said}»`);
      await ctx.close();
    }
  }

  // календарь с подменённой датой (docs/06-testing.md, §5; docs/04-data-model.md, «Что доступно
  // игроку»): часы браузера стоят на дне D, установка — за три дня до него, запирание — как в 1.0,
  // сети нет — календарь только встроенного набора. Вчерашняя картинка дня открыта навсегда;
  // завтрашней в календаре нет, и в коллекции она заперта; назавтра она открыта, а часы, переведённые
  // назад, её снова не запирают (самая поздняя виденная дата). День D — по календарю встроенного
  // набора: вчера и завтра — картинки не из бесплатных, завтрашняя — среди первых в своей коллекции
  {
    const sched = mergedCalendar([builtinPack]);
    const days = new Daily({ calendar: sched, pictures: builtinPack.json.pictures });
    const shown = builtinPack.json.pictures.filter((p) => !p.hidden);
    const pic = (id: string) => shown.find((p) => p.id === id)!;
    const closed = (id: string) => !pic(id).free && pic(id).order >= FREE_FIRST;
    const place = (id: string) => shown.filter((p) => p.collection === pic(id).collection).sort((a, b) => a.order - b.order).findIndex((p) => p.id === id);
    const D = sched.map((d) => d.date).find((d) => {
      const y = days.on(addDays(d, -1));
      const z = days.on(addDays(d, 1));
      return !!y && !!z && closed(y) && closed(z) && place(z) < 9;
    });
    if (!D) check(false, 'календарь с подменённой датой: в календаре встроенного набора нет дня, где вчера и завтра — не бесплатные картинки');
    else {
      const Y = days.on(addDays(D, -1))!;
      const Z = days.on(addDays(D, 1))!;
      const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, timezoneId: 'UTC' });
      await ctx.route('**/uzory/v1/**', (r) => r.abort('internetdisconnected'));
      const cp = await ctx.newPage();
      cp.on('pageerror', (e) => errors.push(e.message));
      cp.on('console', (m) => { if (m.type() === 'error' && !/ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(m.text())) errors.push(m.text()); });
      const at = (d: string) => cp.clock.setFixedTime(new Date(`${d}T12:00:00Z`));
      await at(D);
      await cp.goto(base);
      await seedWorks(cp, [], {
        'uzory.settings.v1': JSON.stringify({ previewLock: true }),
        'uzory.player.v1': JSON.stringify({ installed: addDays(D, -3), seen: D, pinned: {}, firstDone: true, hints: [] }),
      });
      await cp.getByTestId('home-calendar').waitFor({ timeout: 60_000 });
      /** Карточка открыта, библиотека прочитана: на ней «Вышивать» или «Подробнее» — заперта ли. */
      const lockedCard = async () => {
        await cp.locator('[data-testid="picture-locked"], [data-testid="picture-stitch"]').first().waitFor({ timeout: 10_000 });
        return (await cp.getByTestId('picture-locked').count()) === 1 && (await cp.getByTestId('picture-stitch').count()) === 0;
      };
      /** Карточка завтрашней картинки — из её коллекции: заперта ли (вместо «Вышивать» — «Подробнее»). */
      const zLocked = async () => {
        await cp.getByTestId('home-library').click();
        await cp.getByTestId(`lib-all-${pic(Z).collection}`).click();
        await cp.getByTestId(`tile-${Z}`).click({ timeout: 10_000 });
        const locked = await lockedCard();
        for (let k = 0; k < 3; k++) await cp.getByTestId('back').click();
        await cp.getByTestId('home-calendar').waitFor();
        return locked;
      };
      await cp.getByTestId('home-calendar').click();
      await cp.getByTestId(`day-pic-${addDays(D, -1)}`).click({ timeout: 10_000 });
      const yOpen = !(await lockedCard());
      await cp.getByTestId('back').click();
      const zInCalendar = await cp.getByTestId(`day-pic-${addDays(D, 1)}`).count();
      await cp.getByTestId('back').click();
      const zToday = await zLocked();
      await at(addDays(D, 1));
      await cp.reload();
      await cp.getByTestId('home-calendar').waitFor({ timeout: 60_000 });
      const zTomorrow = await zLocked();
      await at(D);
      await cp.reload();
      await cp.getByTestId('home-calendar').waitFor({ timeout: 60_000 });
      const zBack = await zLocked();
      check(yOpen && zInCalendar === 0 && zToday && !zTomorrow && !zBack,
        `календарь с подменённой датой (${D}): вчерашняя «${Y}» открыта; завтрашней «${Z}» в календаре нет, в коллекции она ${zToday ? 'заперта' : 'НЕ заперта'}; назавтра — ${zTomorrow ? 'заперта' : 'открыта'}; часы назад — ${zBack ? 'заперта снова' : 'открыта'}`);
      await ctx.close();
    }
  }

  // «Замер прокрутки» (docs/specs/2026-09-library.md, критерий 4): вся библиотека с ещё не
  // нарисованными превью сама листается вниз до конца и обратно, кадры считает поток интерфейса.
  // Порог «ни одного кадра дольше 50 мс» — для телефона; здесь — что список едет и замер даёт числа
  {
    const ctx = await browser.newContext({ viewport: { width: 400, height: 860 } });
    const sp = await ctx.newPage();
    sp.on('pageerror', (e) => errors.push(e.message));
    sp.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await sp.goto(base);
    await sp.getByTestId('home-scroll-bench').click({ timeout: 60_000 });
    await sp.getByTestId('scroll-bench-run').click();
    await sp.getByTestId('scroll-bench-list').waitFor({ timeout: 10_000 });
    await sp.waitForTimeout(1500);
    const mid = await sp.getByTestId('scroll-bench-list').evaluate((el) => el.scrollTop).catch(() => 0);
    await sp.getByTestId('scroll-bench-result').waitFor({ timeout: 90_000 }).catch(() => {});
    const res = await sp.getByTestId('scroll-bench-result').innerText().catch(() => '');
    const top = await sp.getByTestId('scroll-bench-list').evaluate((el) => el.scrollTop).catch(() => -1);
    const n = Number(res.match(/(\d+) кадров/)?.[1] ?? 0);
    check(mid > 1000 && top === 0 && n > 30 && /дольше 50 мс — \d+/.test(res),
      `замер прокрутки: на полпути ${Math.round(mid)} точек вниз, в конце — снова наверху; ${res.split('\n').slice(1).join(' · ') || 'чисел нет'}`);
    await ctx.close();
  }

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
  // во время штриха React не перерисовывает экран (docs/specs/2026-09-spikes.md, критерий 4)
  check(/Кисть: \d+ кадров/.test(result) && !/стежков: 0/.test(result) && /коммитов React: 0\b/.test(result),
    'замер прошёл все три фазы, кисть вышивала, коммитов React во время кисти — 0');
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
