// Снимки владельца из альбома VK — на отбор для «Природы» и «Городов» (docs/09-content.md,
// §2, «Свои снимки»). Среда ассистента VK не видит, поэтому качает CI
// (.github/workflows/content-fetch.yml, ввод `vk`) и кладёт архив в черновик релиза:
// репозиторий открытый, а черновик видят только его владельцы. В git снимки попадают
// только отобранными — карточкой и уменьшенным исходником, как любая картинка.
//
//   bun tools/content/vk.ts https://vk.com/album<владелец>_<альбом> <папка>
//
// Альбом должен быть открыт для всех: входа в VK здесь нет. Страница альбома разбирается
// тремя способами (мобильная, обычная, любые адреса снимков в тексте страницы) — разметка
// VK меняется; что нашёл каждый способ, пишется в журнал, первые страницы — в debug/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const MAX_SIDE = 1600;
const MOBILE = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const CDN = /^https:\/\/[a-z0-9.-]+\.(userapi\.com|vkuserphoto\.ru|vk-cdn\.net|vkuseraudio\.net|mycdn\.me)\//;

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

// windows-1251: в Bun у TextDecoder её нет, а VK отдаёт в ней часть страниц
const CP1251_HIGH =
  'ЂЃ‚ѓ„…†‡€‰Љ‹ЊЌЋЏђ‘’“”•–—\ufffd™љ›њќћџ\u00a0ЎўЈ¤Ґ¦§Ё©Є«¬\u00ad®Ї°±Ііґµ¶·ё№є»јЅѕї';
function decode1251(buf: Uint8Array): string {
  let s = '';
  for (const b of buf) s += b < 0x80 ? String.fromCharCode(b) : b < 0xc0 ? CP1251_HIGH[b - 0x80] : String.fromCharCode(0x410 + b - 0xc0);
  return s;
}
const unescape = (s: string) =>
  s.replace(/\\\//g, '/').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\\u0026/g, '&');

async function page(url: string, ua: string, init: RequestInit = {}): Promise<{ status: number; url: string; text: string }> {
  const res = await fetch(url, {
    ...init,
    redirect: 'follow',
    headers: { 'User-Agent': ua, 'Accept-Language': 'ru-RU,ru;q=0.9', Accept: 'text/html,application/xhtml+xml,*/*', ...(init.headers ?? {}) },
  });
  // страницы VK бывают в windows-1251
  const buf = Buffer.from(await res.arrayBuffer());
  const type = res.headers.get('content-type') ?? '';
  const text = /1251/.test(type) ? decode1251(buf) : buf.toString('utf8');
  return { status: res.status, url: res.url, text };
}

/** Размер из адреса CDN (`size=1280x960`) или из соседних чисел. */
function sizeOf(url: string): [number, number] {
  const m = /[?&]size=(\d+)x(\d+)/.exec(url);
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
}

/** m.vk.com: у миниатюры `data-src_big="адрес|ширина|высота"`, ссылка — `/photo<владелец>_<номер>`. */
function parseMobile(html: string): Photo[] {
  const out: Photo[] = [];
  for (const tag of html.match(/<a\b[^>]*>/g) ?? []) {
    const id = /href="\/photo(-?\d+_\d+)/.exec(tag)?.[1];
    const big = /data-src_big="([^"]+)"/.exec(tag)?.[1];
    if (!id || !big) continue;
    const [u, w, h] = unescape(big).split('|');
    out.push({ id, url: u, w: Number(w) || sizeOf(u)[0], h: Number(h) || sizeOf(u)[1] });
  }
  return out;
}

/** vk.com: `showPhoto('<id>', 'album…', {"temp":{"base":…,"x_":[адрес,ш,в],…}}, event)`. */
function parseDesktop(html: string): Photo[] {
  const out: Photo[] = [];
  const re = /showPhoto\('(-?\d+_\d+)',\s*'[^']*',\s*(\{.*?\})\s*,\s*event\)/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    try {
      const j = JSON.parse(unescape(m[2]).replace(/&quot;/g, '"')) as { temp?: Record<string, unknown> };
      const t = j.temp ?? {};
      const base = typeof t.base === 'string' ? t.base : '';
      let best: Photo | null = null;
      for (const k of ['w_', 'z_', 'y_', 'x_']) {
        const v = t[k];
        if (!Array.isArray(v)) continue;
        const [p, w, h] = v as [string, number, number];
        const url = /^https?:/.test(p) ? p : `${base}${p}${/\.\w+$/.test(p) ? '' : '.jpg'}`;
        if (!best || w * h > best.w * best.h) best = { id: m[1], url, w, h };
      }
      if (best) out.push(best);
    } catch {
      // разметка изменилась — поможет общий способ
    }
  }
  return out;
}

/** Любые адреса снимков на странице: один снимок — один путь, берём самый крупный размер. */
function parseAny(html: string): Photo[] {
  const text = unescape(html);
  const byPath = new Map<string, Photo>();
  for (const m of text.matchAll(/https:\/\/[a-z0-9.-]+\.(?:userapi\.com|vkuserphoto\.ru)\/[^\s"'()<>\\]+/g)) {
    const url = m[0].replace(/[,;]+$/, '');
    const [w, h] = sizeOf(url);
    if (!w || Math.max(w, h) < 400) continue; // аватарки и значки
    const path = url.split('?')[0];
    const prev = byPath.get(path);
    if (!prev || w * h > prev.w * prev.h) byPath.set(path, { url, w, h });
  }
  return [...byPath.values()];
}

/** Окно просмотра снимка (al_photos.php, act=show) отдаёт соседние снимки альбома с датой и подписью. */
async function viewer(list: string, first: string, host: string, debug: string): Promise<Photo[]> {
  const body = new URLSearchParams({ act: 'show', al: '1', list, module: 'photos', photo: first });
  const r = await page(`https://${host}/al_photos.php?act=show`, DESKTOP, {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
  });
  writeFileSync(join(debug, 'viewer.txt'), r.text.slice(0, 400_000));
  console.log(`окно просмотра: ${r.status}, ${r.text.length} знаков`);
  const out: Photo[] = [];
  let j: unknown;
  try {
    j = JSON.parse(r.text.replace(/^<!--/, ''));
  } catch {
    return out;
  }
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if (typeof o.id === 'string' && /^-?\d+_\d+$/.test(o.id)) {
      let best: Photo | null = null;
      for (const k of ['w_', 'z_', 'y_', 'x_']) {
        const s = o[k];
        if (!Array.isArray(s)) continue;
        const [u, w, h] = s as [string, number, number];
        if (typeof u === 'string' && (!best || w * h > best.w * best.h)) best = { id: o.id, url: u, w, h };
      }
      if (best) {
        if (typeof o.date === 'string' || typeof o.date === 'number') best.date = Number(o.date) || undefined;
        if (typeof o.desc === 'string' && o.desc) best.text = o.desc.replace(/<[^>]+>/g, ' ').trim();
        out.push(best);
      }
    }
    Object.values(o).forEach(walk);
  };
  walk(j);
  return out;
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
    if (!CDN.test(p.url)) return;
    const key = p.id ?? p.url.split('?')[0];
    const prev = found.get(key);
    if (!prev || p.w * p.h > prev.w * prev.h) found.set(key, { ...prev, ...p });
  };

  // 1. мобильная страница, по страницам
  for (let offset = 0, pageNo = 0; pageNo < 60; pageNo++) {
    const r = await page(`https://m.${host}/${list}${offset ? `?offset=${offset}` : ''}`, MOBILE);
    if (pageNo === 0) writeFileSync(join(debug, 'mobile-0.html'), r.text);
    const got = parseMobile(r.text);
    const fresh = got.filter((p) => !found.has(p.id!));
    console.log(`мобильная, сдвиг ${offset}: ${r.status} ${r.url.slice(0, 60)} — снимков ${got.length}, новых ${fresh.length}`);
    got.forEach(add);
    if (!fresh.length) break;
    offset += got.length;
    await sleep(700);
  }

  // 2. обычная страница и общий способ
  const d = await page(`https://${host}/${list}`, DESKTOP);
  writeFileSync(join(debug, 'desktop.html'), d.text);
  const desk = parseDesktop(d.text);
  const any = parseAny(d.text);
  console.log(`обычная: ${d.status} ${d.url.slice(0, 60)} — showPhoto ${desk.length}, адресов ${any.length}`);
  desk.forEach(add);
  if (!found.size) any.forEach(add);

  // 3. окно просмотра: даты и подписи, и снимки, которых не было на страницах
  const firstId = [...found.values()].find((p) => p.id)?.id;
  if (firstId) {
    try {
      const v = await viewer(list, firstId, host, debug);
      console.log(`окно просмотра: снимков ${v.length}`);
      v.forEach(add);
    } catch (e) {
      console.log(`окно просмотра не открылось: ${(e as Error).message}`);
    }
  }

  const photos = [...found.values()];
  console.log(`всего снимков: ${photos.length}`);
  let n = 0;
  const manifest: (Photo & { file: string })[] = [];
  for (const p of photos) {
    n++;
    const file = `${String(n).padStart(3, '0')}${p.id ? `-${p.id}` : ''}.jpg`;
    try {
      const res = await fetch(p.url, { headers: { 'User-Agent': DESKTOP, Referer: `https://${host}/` } });
      if (!res.ok) throw new Error(String(res.status));
      const buf = Buffer.from(await res.arrayBuffer());
      const img = sharp(buf).rotate();
      const meta = await img.metadata();
      await img.resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85, mozjpeg: true }).toFile(join(outDir, file));
      manifest.push({ ...p, w: meta.width ?? p.w, h: meta.height ?? p.h, file });
    } catch (e) {
      console.error(`${p.url.slice(0, 80)}: ${(e as Error).message}`);
    }
    await sleep(150);
  }
  writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify({ album, photos: manifest }, null, 2)}\n`);
  console.log(`скачано: ${manifest.length} из ${photos.length}`);
  if (!manifest.length) process.exitCode = 1;
}

if (import.meta.main) await main();
