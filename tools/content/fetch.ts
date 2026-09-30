// Исходники картинок (docs/09-content.md, §12): ассистент не «вспоминает» картинки, а берёт
// названный файл по адресу и записывает лицензию. Среда ассистента не видит Викисклад и
// Библиотеку Конгресса, поэтому это делает CI (.github/workflows/content-fetch.yml):
//
//   bun tools/content/fetch.ts search   content/wanted.yaml → content/candidates.json:
//                                       найденные файлы с лицензией, автором, датой, размером
//   bun tools/content/fetch.ts fetch    карточки с source.url, у которых нет файла рядом:
//                                       скачать, уменьшить до 2000 точек, положить рядом
//   … fetch --again                     то же и для тех, у кого файл есть (исходники крупнее)
//   bun tools/content/fetch.ts dims     размеры холстов картин из Викиданных → content/dimensions.json
//                                       (четыре клетки на сантиметр, docs/08-game-design.md)
//
// Качается только с Викисклада, Библиотеки Конгресса и из открытых собраний музеев с CC0 —
// Метрополитен-музея, Чикагского института искусств и Кливлендского музея искусств (для «Цветов»
// и картин из зарубежных собраний: адрес файла — source.download); всё остальное — ошибка.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { parse } from 'yaml';
import { CONTENT, listCards, readCard } from './cards';

const UA = 'UzoryContentBot/0.1 (https://gornitsa.games; game studio Gornitsa)';
const ALLOWED = [
  /^https:\/\/commons\.wikimedia\.org\//, /^https:\/\/(upload|thumb)\.wikimedia\.org\//,
  /^https:\/\/www\.loc\.gov\//, /^https:\/\/tile\.loc\.gov\//, /^https:\/\/www\.wikidata\.org\//,
  /^https:\/\/images\.metmuseum\.org\/CRDImages\//, /^https:\/\/www\.artic\.edu\/iiif\/2\//,
  /^https:\/\/openaccess-cdn\.clevelandart\.org\//,
];
/** Длинная сторона исходника: запас на узор в четыре клетки на сантиметр холста. */
const MAX_SIDE = 2000;

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
    const pick = images.filter((i) => i.w && i.w <= 3000).sort((a, b) => b.w - a.w)[0] ?? images[images.length - 1];
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

async function fetchSources(again: boolean) {
  let failed = 0;
  for (const file of listCards()) {
    const { card } = readCard(file);
    // свои снимки владельца (адреса нет) лежат в репозитории сразу, качать нечего
    if (!card?.pattern || !card.source.file || !card.source.url) continue;
    const target = join(card.dir, card.source.file);
    if (existsSync(target) && !again) continue;
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

/**
 * Размер холста картины из Викиданных (высота P2048, ширина P2049): элемент — из шаблона
 * Artwork страницы файла (wikidata=Q…) или из структурных данных файла (P6243 «цифровое
 * представление»). Пишется в content/dimensions.json с тем, откуда взято.
 */
async function dims() {
  const out: Record<string, { cm?: [number, number]; item?: string; note: string }> = {};
  for (const file of listCards()) {
    const { card } = readCard(file);
    if (!card || (card.collection !== 'painting' && card.collection !== 'tales')) continue;
    const m = /commons\.wikimedia\.org\/wiki\/(File:[^?#]+)/.exec(card.source.url);
    if (!m) { out[card.id] = { note: 'не Викисклад' }; continue; }
    try {
      const title = decodeURIComponent(m[1]);
      const q = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', titles: title, prop: 'revisions', rvprop: 'content', rvslots: 'main' });
      const j = (await (await get(`https://commons.wikimedia.org/w/api.php?${q}`)).json()) as { query?: { pages?: { pageid?: number; revisions?: { slots?: { main?: { content?: string } } }[] }[] } };
      const page = j.query?.pages?.[0];
      const text = page?.revisions?.[0]?.slots?.main?.content ?? '';
      let item = /\|\s*wikidata\s*=\s*(Q\d+)/i.exec(text)?.[1];
      if (!item && page?.pageid) {
        const mi = (await (await get(`https://commons.wikimedia.org/w/api.php?action=wbgetentities&format=json&ids=M${page.pageid}`)).json()) as { entities?: Record<string, { statements?: Record<string, { mainsnak?: { datavalue?: { value?: { id?: string } } } }[]> }> };
        item = Object.values(mi.entities ?? {})[0]?.statements?.P6243?.[0]?.mainsnak?.datavalue?.value?.id;
      }
      const sizeLine = /\{\{\s*Size\s*\|[^}]*\}\}/i.exec(text)?.[0];
      if (!item) { out[card.id] = { note: `нет элемента Викиданных${sizeLine ? `; на странице: ${sizeLine}` : ''}` }; continue; }
      const w = (await (await get(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims&ids=${item}`)).json()) as { entities?: Record<string, { claims?: Record<string, { mainsnak?: { datavalue?: { value?: { amount?: string; unit?: string } } } }[]> }> };
      const claims = w.entities?.[item]?.claims ?? {};
      const cm = (p: string) => {
        const v = claims[p]?.[0]?.mainsnak?.datavalue?.value;
        if (!v?.amount) return undefined;
        const n = Number(v.amount);
        // Q174728 — сантиметр, Q11573 — метр, Q174789 — миллиметр
        return v.unit?.endsWith('/Q174728') ? n : v.unit?.endsWith('/Q11573') ? n * 100 : v.unit?.endsWith('/Q174789') ? n / 10 : undefined;
      };
      const h = cm('P2048');
      const wd = cm('P2049');
      out[card.id] = h && wd ? { cm: [wd, h], item, note: `Викиданные ${item}: ширина ${wd} см, высота ${h} см` } : { item, note: `у ${item} нет высоты и ширины в сантиметрах${sizeLine ? `; на странице: ${sizeLine}` : ''}` };
    } catch (e) {
      out[card.id] = { note: (e as Error).message };
    }
    console.log(card.id, JSON.stringify(out[card.id]));
  }
  writeFileSync(join(CONTENT, 'dimensions.json'), `${JSON.stringify(out, null, 2)}\n`);
}

if (import.meta.main) {
  const cmd = process.argv[2];
  if (cmd === 'search') await search();
  else if (cmd === 'fetch') await fetchSources(process.argv.includes('--again'));
  else if (cmd === 'dims') await dims();
  else {
    console.error('bun tools/content/fetch.ts search | fetch [--again] | dims');
    process.exit(2);
  }
}
