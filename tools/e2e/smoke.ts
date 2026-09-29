// из anamnez: tools/e2e/smoke.ts @ 3d76cf5 (сервер веб-сборки)
// npm run e2e — сценарий Playwright по веб-сборке (docs/06-testing.md, §5): главная,
// первая картинка от первого стежка до «Готово» и «Как вышивалось», мышь и клавиши, лист,
// свой узор, замер, файл работы. Сначала `npm run export:web`. Снимки экранов — в tools/e2e/out/.
//
// Сборку для сайта (docs/specs/2026-09-web.md) сценарий открывает из её папки:
//   UZORY_WEB_BASE=/uzory/test npx expo export --platform web --output-dir dist-site
//   E2E_DIST=dist-site E2E_BASE=/uzory/test bun tools/e2e/smoke.ts
import { mkdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { chromium, type Download, type Page } from 'playwright';
import { type Camera, clampX, clampY, fitScale, inMap, mapJump, mapRect, NUMBERS_DP, wheelFactor, zoomAround } from '../../src/canvas/camera';
import { CANVAS, type Pattern } from '../../src/engine/pattern';
import { fillRegion } from '../../src/engine/regions';
import { buildAll } from '../content/build';

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
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(req) {
    const asked = new URL(req.url).pathname;
    const own = req.method === 'GET' && (await Bun.file(join(DIST, decodeURIComponent(asked).slice(BASE.length))).exists());
    if (!own) requests.push(`${req.method} ${asked}`);
    let path = decodeURIComponent(new URL(req.url).pathname);
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

try {
  await page.goto(base);
  await page.getByTestId('first-stitch').waitFor({ timeout: 60_000 });
  check(true, 'главная открылась: на месте картинки дня — первая картинка');
  await page.screenshot({ path: join(OUT, '01-home.png') });

  // «Библиотека», «Мои работы», «Календарь» — до этапа библиотеки заглушка «Скоро»
  await page.getByTestId('home-library').click();
  await page.getByTestId('soon').waitFor({ timeout: 5000 });
  check(true, '«Библиотека» — «Скоро»');
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
  await page.getByTestId('set-about').click();
  check((await page.getByTestId('about-version').innerText().catch(() => '')).includes('Узоры'), '«О программе»: версия и источники картинок');
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
  await page.getByTestId('back').click();
  await page.getByTestId('home-sheet').click();
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
  check(true, 'последний стежок — экран «Готово»');
  await page.screenshot({ path: join(OUT, '03-done.png') });
  await page.getByTestId('replay').click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: join(OUT, '04-replay.png') });
  await page.getByTestId('skip').click().catch(() => {});
  await page.getByTestId('next').click();
  await page.getByTestId('daily-stitch').waitFor({ timeout: 10_000 }).catch(() => {});
  check((await page.getByTestId('daily-stitch').innerText().catch(() => '')).includes('Вышивать') && (await page.getByTestId('first-stitch').count()) === 0,
    'первая картинка вышита — на главной картинка дня');

  // лист
  await page.getByTestId('home-sheet').click();
  await page.getByTestId('sheet-first-picture').waitFor();
  // список прокручивается и рисует не всё сразу: проверяем, что он не пуст и первые на месте
  check((await page.locator('[data-testid^="sheet-"]').count()) >= Math.min(built.length, 5), `лист: ${built.length} картинок в наборе`);
  await page.screenshot({ path: join(OUT, '05-sheet.png') });
  await page.getByTestId('back').click();

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
  const leaked = requests.slice(sent);
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
  console.log(`\nне прошло: ${failures.length}`);
  process.exit(1);
}
console.log('\nсценарий пройден');
