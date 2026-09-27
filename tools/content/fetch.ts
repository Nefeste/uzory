// Исходники картинок (docs/09-content.md, §12): ассистент не «вспоминает» картинки, а берёт
// названный файл по адресу и записывает лицензию. Среда ассистента не видит Викисклад и
// Библиотеку Конгресса, поэтому это делает CI (.github/workflows/content-fetch.yml):
//
//   bun tools/content/fetch.ts search   content/wanted.yaml → content/candidates.json:
//                                       найденные файлы с лицензией, автором, датой, размером
//   bun tools/content/fetch.ts fetch    карточки с source.url, у которых нет файла рядом:
//                                       скачать, уменьшить до 800 точек, положить рядом
//
// Качается только с Викисклада и Библиотеки Конгресса; всё остальное — ошибка.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { parse } from 'yaml';
import { CONTENT, listCards, readCard } from './cards';

const UA = 'UzoryContentBot/0.1 (https://gornitsa.games; game studio Gornitsa)';
const ALLOWED = [/^https:\/\/commons\.wikimedia\.org\//, /^https:\/\/upload\.wikimedia\.org\//, /^https:\/\/www\.loc\.gov\//, /^https:\/\/tile\.loc\.gov\//];
const MAX_SIDE = 800;

async function get(url: string): Promise<Response> {
  if (!ALLOWED.some((r) => r.test(url))) throw new Error(`адрес не из разрешённых: ${url}`);
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' } });
    if (res.ok) return res;
    if (res.status !== 429 && res.status < 500) throw new Error(`${res.status} ${url}`);
    await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
  }
  throw new Error(`не скачалось: ${url}`);
}

const strip = (s: unknown) => (typeof s === 'string' ? s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : undefined);

interface Candidate {
  source: 'commons' | 'loc';
  query: string;
  title: string;
  page: string;
  /** что качать (уменьшенная копия) */
  download: string;
  width?: number;
  height?: number;
  license?: string;
  artist?: string;
  date?: string;
  credit?: string;
  description?: string;
  rights?: string;
}

async function commons(q: string): Promise<Candidate[]> {
  const params = new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', generator: 'search', gsrsearch: `${q} filetype:bitmap`,
    gsrnamespace: '6', gsrlimit: '6', prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: String(MAX_SIDE),
    iiextmetadatafilter: 'LicenseShortName|License|Artist|DateTimeOriginal|ObjectName|Credit|UsageTerms|Copyrighted|ImageDescription',
  });
  const j = (await (await get(`https://commons.wikimedia.org/w/api.php?${params}`)).json()) as {
    query?: { pages?: { title: string; index?: number; imageinfo?: { url: string; thumburl?: string; width: number; height: number; descriptionurl: string; extmetadata?: Record<string, { value: string }> }[] }[] };
  };
  const pages = [...(j.query?.pages ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return pages.flatMap((p) => {
    const ii = p.imageinfo?.[0];
    if (!ii) return [];
    const m = ii.extmetadata ?? {};
    return [{
      source: 'commons' as const, query: q, title: p.title, page: ii.descriptionurl, download: ii.thumburl ?? ii.url,
      width: ii.width, height: ii.height, license: strip(m.LicenseShortName?.value), artist: strip(m.Artist?.value),
      date: strip(m.DateTimeOriginal?.value), credit: strip(m.Credit?.value)?.slice(0, 300),
      description: strip(m.ImageDescription?.value)?.slice(0, 400), rights: strip(m.UsageTerms?.value),
    }];
  });
}

/** Цветные сборки Прокудина-Горского в Библиотеке Конгресса. */
async function loc(q: string): Promise<Candidate[]> {
  const url = `https://www.loc.gov/collections/prokudin-gorskii/?q=${encodeURIComponent(q)}&fo=json&c=6`;
  const j = (await (await get(url)).json()) as { results?: { title: string; id: string; date?: string; image_url?: string[] }[] };
  const out: Candidate[] = [];
  for (const r of j.results ?? []) {
    const images = (r.image_url ?? []).map((u) => {
      const w = Number(/[#&]w=(\d+)/.exec(u)?.[1] ?? 0);
      return { u: u.split('#')[0], w };
    });
    // самая крупная копия не больше 1600 точек: её уменьшит sharp
    const pick = images.filter((i) => i.w && i.w <= 1600).sort((a, b) => b.w - a.w)[0] ?? images[images.length - 1];
    let rights: string | undefined;
    try {
      const item = (await (await get(`${r.id.replace(/\/$/, '')}/?fo=json`)).json()) as { item?: { rights_advisory?: string[] | string } };
      const ra = item.item?.rights_advisory;
      rights = Array.isArray(ra) ? ra.join(' ') : ra;
    } catch {
      rights = undefined;
    }
    if (pick) out.push({ source: 'loc', query: q, title: r.title, page: r.id, download: pick.u, width: pick.w || undefined, date: r.date, rights, artist: 'Prokudin-Gorskii, Sergei Mikhailovich, 1863-1944' });
  }
  return out;
}

async function search() {
  const wanted = parse(readFileSync(join(CONTENT, 'wanted.yaml'), 'utf8')) as { commons?: string[]; loc?: string[] };
  const out: Candidate[] = [];
  for (const q of wanted.commons ?? []) {
    try { out.push(...(await commons(q))); } catch (e) { console.error(`commons «${q}»: ${(e as Error).message}`); }
  }
  for (const q of wanted.loc ?? []) {
    try { out.push(...(await loc(q))); } catch (e) { console.error(`loc «${q}»: ${(e as Error).message}`); }
  }
  writeFileSync(join(CONTENT, 'candidates.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`кандидатов: ${out.length}`);
}

/** Адрес для скачивания по адресу карточки: страница файла Викисклада или запись Библиотеки Конгресса. */
async function resolve(url: string, download?: string): Promise<string> {
  if (download) return download;
  const m = /commons\.wikimedia\.org\/wiki\/(File:[^?#]+)/.exec(url);
  if (m) {
    const params = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', titles: decodeURIComponent(m[1]), prop: 'imageinfo', iiprop: 'url', iiurlwidth: String(MAX_SIDE) });
    const j = (await (await get(`https://commons.wikimedia.org/w/api.php?${params}`)).json()) as { query?: { pages?: { imageinfo?: { thumburl?: string; url: string }[] }[] } };
    const ii = j.query?.pages?.[0]?.imageinfo?.[0];
    if (!ii) throw new Error(`на Викискладе нет ${m[1]}`);
    return ii.thumburl ?? ii.url;
  }
  if (/loc\.gov\/(item|pictures\/item)\//.test(url)) {
    const c = await loc(url.replace(/\/$/, '').split('/').pop()!);
    if (!c[0]) throw new Error(`в Библиотеке Конгресса не нашлось ${url}`);
    return c[0].download;
  }
  throw new Error(`не знаю, как скачать ${url}`);
}

async function fetchSources() {
  let failed = 0;
  for (const file of listCards()) {
    const { card } = readCard(file);
    if (!card?.pattern || !card.source.file) continue;
    const target = join(card.dir, card.source.file);
    if (existsSync(target)) continue;
    try {
      const from = await resolve(card.source.url, (card.source as { download?: string }).download);
      const buf = Buffer.from(await (await get(from)).arrayBuffer());
      await sharp(buf).rotate().resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90, mozjpeg: true }).toFile(target);
      console.log(`скачано: ${card.path} ← ${from}`);
    } catch (e) {
      failed++;
      console.error(`${card.path}: ${(e as Error).message}`);
    }
  }
  if (failed) process.exitCode = 1;
}

if (import.meta.main) {
  const cmd = process.argv[2];
  if (cmd === 'search') await search();
  else if (cmd === 'fetch') await fetchSources();
  else {
    console.error('bun tools/content/fetch.ts search | fetch');
    process.exit(2);
  }
}
