// Снимки владельца из альбома VK — на отбор для «Природы» и «Городов» (docs/09-content.md,
// §2, «Свои снимки»). Среда ассистента VK не видит, поэтому качает CI
// (.github/workflows/content-fetch.yml, ввод `vk`) и кладёт архив в черновик релиза:
// репозиторий открытый, а черновик видят только его владельцы. В git снимки попадают
// только отобранными — карточкой и уменьшенным исходником, как любая картинка.
//
//   bun tools/content/vk.ts https://vk.com/album<владелец>_<альбом> <папка>
//
// Альбом должен быть открыт для всех: входа в VK здесь нет. Страницы VK — приложение на JS
// с проверкой браузера, поэтому альбом открывает Chromium (Playwright) как гость, листает
// до конца и берёт адреса снимков из ответов VK (объекты с `sizes`) и из разметки.
// Снимок экрана и ответы — в debug/: по ним чинится разбор, если VK что-то поменял.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, devices } from 'playwright';
import sharp from 'sharp';

const MAX_SIDE = 1600;
const CDN = /^https:\/\/[a-z0-9.-]+\.(userapi\.com|vkuserphoto\.ru|vk-cdn\.net|mycdn\.me)\//;

interface Photo {
  /** «владелец_номер», если нашёлся */
  id?: string;
  url: string;
  w: number;
  h: number;
  date?: number;
  text?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const unescape = (s: string) => s.replace(/\\\//g, '/').replace(/&amp;/g, '&').replace(/\\u0026/g, '&');

/** Размер из адреса CDN (`size=1280x960`). */
function sizeOf(url: string): [number, number] {
  const m = /[?&]size=(\d+)x(\d+)/.exec(url);
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
}

/** Снимки из ответа VK: объекты API с `sizes` (и `orig_photo`) или старые `*_src`. */
function fromJson(v: unknown, out: Photo[]) {
  if (Array.isArray(v)) {
    for (const x of v) fromJson(x, out);
    return;
  }
  if (!v || typeof v !== 'object') return;
  const o = v as Record<string, unknown>;
  const owner = o.owner_id;
  const id = typeof o.id === 'number' && typeof owner === 'number' ? `${owner}_${o.id}` : typeof o.id === 'string' && /^-?\d+_\d+$/.test(o.id) ? o.id : undefined;
  const cands: Photo[] = [];
  const sizes = Array.isArray(o.sizes) ? (o.sizes as Record<string, unknown>[]) : [];
  for (const s of [...sizes, o.orig_photo as Record<string, unknown> | undefined]) {
    if (!s || typeof s !== 'object') continue;
    const url = (s.url ?? s.src) as string | undefined;
    if (typeof url === 'string') cands.push({ id, url, w: Number(s.width) || sizeOf(url)[0], h: Number(s.height) || sizeOf(url)[1] });
  }
  for (const k of ['w_src', 'z_src', 'y_src', 'x_src']) {
    if (typeof o[k] === 'string') {
      const url = o[k] as string;
      cands.push({ id, url, w: sizeOf(url)[0], h: sizeOf(url)[1] });
    }
  }
  const best = cands.filter((c) => CDN.test(c.url)).sort((a, b) => b.w * b.h - a.w * a.h)[0];
  if (best) {
    if (typeof o.date === 'number') best.date = o.date;
    const text = typeof o.text === 'string' ? o.text : typeof o.desc === 'string' ? o.desc : '';
    if (text) best.text = text.replace(/<[^>]+>/g, ' ').trim();
    out.push(best);
  }
  for (const [k, x] of Object.entries(o)) if (k !== 'sizes' && k !== 'orig_photo') fromJson(x, out);
}

async function main() {
  const [album, outDir] = process.argv.slice(2);
  const m = /^https:\/\/(?:m\.)?(vk\.com|vk\.ru)\/album(-?\d+)_(\d+)/.exec(album ?? '');
  if (!m || !outDir) {
    console.error('bun tools/content/vk.ts https://vk.com/album<владелец>_<альбом> <папка>');
    process.exit(2);
  }
  const [, host, owner, id] = m;
  const list = `album${owner}_${id}`;
  const debug = join(outDir, 'debug');
  mkdirSync(debug, { recursive: true });

  const found = new Map<string, Photo>();
  const add = (p: Photo) => {
    if (!CDN.test(p.url) || Math.max(p.w, p.h) < 400) return; // аватарки и значки
    // только снимки этого альбома, если номер известен
    if (p.id && !p.id.startsWith(`${owner}_`)) return;
    const key = p.id ?? p.url.split('?')[0];
    const prev = found.get(key);
    if (!prev || p.w * p.h > prev.w * prev.h) found.set(key, { ...prev, ...p, date: p.date ?? prev?.date, text: p.text ?? prev?.text });
  };

  const browser = await chromium.launch();
  let saved = 0;
  try {
    for (const [name, url, device] of [
      ['mobile', `https://m.${host}/${list}`, devices['Pixel 7']],
      ['desktop', `https://${host}/${list}`, devices['Desktop Chrome']],
    ] as const) {
      const ctx = await browser.newContext({ ...device, locale: 'ru-RU' });
      const page = await ctx.newPage();
      page.on('response', async (res) => {
        const type = res.headers()['content-type'] ?? '';
        if (!/json|javascript|text\/(plain|html)/.test(type) || res.request().resourceType() === 'document') return;
        let body: string;
        try {
          body = await res.text();
        } catch {
          return;
        }
        if (!/"sizes"|_src"|orig_photo/.test(body)) return;
        if (saved < 12) writeFileSync(join(debug, `${name}-response-${saved++}.txt`), `${res.url()}\n\n${body.slice(0, 300_000)}`);
        const out: Photo[] = [];
        for (const chunk of [body.replace(/^<!--/, ''), ...(body.match(/\{"response":.*\}/s) ?? [])]) {
          try {
            fromJson(JSON.parse(chunk), out);
            break;
          } catch {
            // не JSON целиком — ниже разбор разметки
          }
        }
        out.forEach(add);
      });
      const before = found.size;
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
      } catch (e) {
        console.log(`${name}: ${(e as Error).message.split('\n')[0]}`);
      }
      // листаем, пока появляются новые снимки
      for (let idle = 0, round = 0; idle < 3 && round < 80; round++) {
        const n = found.size;
        await page.mouse.wheel(0, 5000);
        await sleep(900);
        idle = found.size === n ? idle + 1 : 0;
      }
      // разметка: data-src_big у мобильной версии и адреса миниатюр
      const html = await page.content();
      writeFileSync(join(debug, `${name}.html`), html);
      await page.screenshot({ path: join(debug, `${name}.png`), fullPage: false });
      for (const mm of unescape(html).matchAll(/href="\/photo(-?\d+_\d+)[^"]*"[^>]*?data-src_big="([^"|]+)\|(\d+)\|(\d+)"/g)) {
        add({ id: mm[1], url: mm[2], w: Number(mm[3]), h: Number(mm[4]) });
      }
      console.log(`${name}: ${page.url().slice(0, 70)} — «${(await page.title()).slice(0, 60)}», снимков +${found.size - before}`);
      await ctx.close();
      if (found.size) break;
    }
  } finally {
    await browser.close();
  }

  const photos = [...found.values()].sort((a, b) => (a.date ?? 0) - (b.date ?? 0));
  console.log(`всего снимков: ${photos.length}`);
  const manifest: (Photo & { file: string })[] = [];
  let n = 0;
  for (const p of photos) {
    n++;
    const file = `${String(n).padStart(3, '0')}${p.id ? `-${p.id}` : ''}.jpg`;
    try {
      const res = await fetch(p.url, { headers: { Referer: `https://${host}/` } });
      if (!res.ok) throw new Error(String(res.status));
      const img = sharp(Buffer.from(await res.arrayBuffer())).rotate();
      const meta = await img.metadata();
      await img.resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85, mozjpeg: true }).toFile(join(outDir, file));
      manifest.push({ ...p, w: meta.width ?? p.w, h: meta.height ?? p.h, file });
    } catch (e) {
      console.error(`${p.url.slice(0, 80)}: ${(e as Error).message}`);
    }
    await sleep(100);
  }
  writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify({ album, photos: manifest }, null, 2)}\n`);
  console.log(`скачано: ${manifest.length} из ${photos.length}`);
  if (!manifest.length) process.exitCode = 1;
}

if (import.meta.main) await main();
