// Набор недели (docs/05-process.md, «Выкладывание наборов»; docs/specs/2026-09-packs.md): картинки
// с «да», которых ещё нет ни в одном выпущенном наборе, и календарь картинок дня ещё на неделю —
// и новый каталог: все выпущенные наборы и этот. Что выпущено, знает сервер: каталог и наборы
// берутся оттуда (или из папки с тем же устройством), подпись каталога проверяется. Номер
// недели, дата и дни — в content/week.yaml: его правит PR недели.
//
//   bun tools/content/week.ts --released https://gornitsa.games/uzory/v1/
//       золотой тест выпущенного и, если в content/week.yaml ещё не выпущенный id, набор недели
//       и новый каталог → dist/v1/ (выкладывает content.yml)
//   … --check     только золотой тест, даже при новом week.yaml
//   … --base      первый каталог: встроенный набор этой версии (один раз, к выпуску 1.0)
//   … --freeze    в PR недели: узоры набора — в список выпущенного у золотого теста
//                 tools/test/fixtures/released.json; ничего не подписывает и не выкладывает
//   bun tools/content/week.ts --base --freeze   в PR с «да» владельца (и к 1.0): туда же — узоры
//                 встроенного набора этой версии, с которым соберётся APK; сервер не нужен
//   bun tools/content/week.ts --verify https://gornitsa.games/uzory/v1/   выложено ли то, что в dist/v1/
//
// Подпись — закрытым ключом из переменной CATALOG_SIGNING_KEY (секрет CI); его открытая половина
// должна быть в src/state/keys.ts, иначе телефоны каталог не примут.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { type Catalog, type CatalogPack, readCatalog } from '../../src/engine/catalog';
import { addDays, isDate, maxDate } from '../../src/engine/dates';
import { type CalendarDay, COLLECTIONS, patternKey, type Picture } from '../../src/engine/library';
import { libraryIndex, mergedCalendar, openPack, type Pack, packError, packPattern, samePattern, writePack } from '../../src/engine/pack';
import { dailySize, hex, type Pattern } from '../../src/engine/pattern';
import { publicKeyOf, sha256Hex, verifyCatalog } from '../../src/engine/sign';
import { utf8Decode } from '../../src/engine/utf8';
import { CATALOG_KEYS } from '../../src/state/keys';
import { APP_VERSION } from '../../src/version';
import { autoCalendar, buildAll, type CalendarRules } from './build';
import { type BuiltCatalog, makeCatalog, signJson } from './catalog';
import { CONTENT, ROOT } from './cards';

const UA = 'UzoryContentBot/0.1 (https://gornitsa.games; game studio Gornitsa)';
const DAY = 86400000;

/** Выпущенное: каталог с сервера и его наборы по порядку каталога; ничего не выпущено — `catalog: null`. */
export interface Released {
  catalog: Catalog | null;
  /** точные байты catalog.json и его подпись — копия для отката */
  json: Uint8Array | null;
  sig?: string;
  packs: { entry: CatalogPack; pack: Pack }[];
}

export const NOTHING_RELEASED: Released = { catalog: null, json: null, packs: [] };

/** Картинка из сборки карточек: то, что пошло бы в набор. */
export interface Source {
  picture: Picture;
  pattern: Pattern;
}

/** content/week.yaml */
export interface WeekPlan {
  /** «w2026-42» — неделя даты `from` по ISO; второй набор той же недели — «w2026-42-2» */
  id: string;
  /** с какой даты картинки набора видны в библиотеке */
  from: string;
  /** на сколько дней продлить календарь картинок дня */
  days: number;
  /** праздник с плавающей датой, день рождения художника: дата → картинка (docs/09-content.md, §9) */
  pin: Map<string, string>;
  notice: string | null;
  /** ниже этой версии новые наборы не подходят; нет — как в выпущенном каталоге */
  minApp: string | null;
}

/** Неделя даты по ISO 8601: «w2026-42». Неделя — с понедельника, год — по её четвергу. */
export function isoWeek(date: string): string {
  const t = Date.parse(`${date}T00:00:00Z`);
  const thursday = t + (3 - ((new Date(t).getUTCDay() + 6) % 7)) * DAY;
  const year = new Date(thursday).getUTCFullYear();
  const week = 1 + Math.floor((thursday - Date.UTC(year, 0, 1)) / (7 * DAY));
  return `w${year}-${String(week).padStart(2, '0')}`;
}

/** content/week.yaml → план; ошибки — списком. */
export function readWeek(raw: unknown): { plan: WeekPlan | null; errors: string[] } {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object') return { plan: null, errors: ['week.yaml — не словарь'] };
  const r = raw as Record<string, unknown>;
  const from = String(r.from ?? '');
  if (!isDate(from)) errors.push(`from «${from}» — дата`);
  const id = String(r.id ?? '');
  if (isDate(from) && !new RegExp(`^${isoWeek(from)}(-[2-9])?$`).test(id)) errors.push(`id «${id}» — не неделя даты ${from}: ${isoWeek(from)} (второй набор недели — ${isoWeek(from)}-2)`);
  const days = r.days ?? 7;
  if (!Number.isInteger(days) || (days as number) < 0 || (days as number) > 60) errors.push(`days «${String(days)}» — от 0 до 60`);
  const pin = new Map<string, string>();
  if (r.pin !== undefined && r.pin !== null) {
    if (typeof r.pin !== 'object') errors.push('pin — словарь «дата: картинка»');
    else for (const [d, p] of Object.entries(r.pin)) {
      if (!isDate(d) || typeof p !== 'string') errors.push(`pin «${d}: ${String(p)}»`);
      else pin.set(d, p);
    }
  }
  const notice = r.notice === undefined || r.notice === null ? null : String(r.notice);
  if (notice !== null && notice.length > 200) errors.push('notice длиннее 200 знаков');
  const minApp = r.min_app === undefined || r.min_app === null ? null : String(r.min_app);
  if (minApp !== null && !/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(minApp)) errors.push(`min_app «${minApp}»`);
  if (errors.length) return { plan: null, errors };
  return { plan: { id, from, days: days as number, pin, notice, minApp }, errors };
}

/**
 * Золотой тест (docs/05-process.md, «Выкладывание наборов»): картинка, чей ключ уже выпущен, собирается
 * в те же клетки и нити. Иначе у игроков под одним ключом разошлись бы узоры — начатая работа
 * открылась бы на чужих клетках; новая сборка картинки — это новая версия `v`.
 */
export function goldenErrors(released: Released, built: readonly Source[]): string[] {
  const lib = libraryIndex(released.packs.map((p) => p.pack));
  const out: string[] = [];
  for (const b of built) {
    const key = patternKey(b.picture);
    const hit = lib.byKey.get(key);
    if (hit && !samePattern(b.pattern, packPattern(hit.pack, hit.pic))) {
      out.push(`${key} собирается иначе, чем в выпущенном наборе ${hit.pack.json.id}: поднимите v в карточке (или верните сборку)`);
    }
  }
  return out;
}

const byCollection = (a: Picture, b: Picture) =>
  COLLECTIONS.indexOf(a.collection) - COLLECTIONS.indexOf(b.collection) || a.order - b.order || a.id.localeCompare(b.id);

export interface Week {
  bytes: Uint8Array;
  /** новые картинки набора */
  pictures: Picture[];
  calendar: CalendarDay[];
  catalog: BuiltCatalog;
}

/**
 * Набор недели и новый каталог. Картинки — из сборки, чьих ключей нет ни в одном выпущенном
 * наборе (новые и новые версии), видны с `from`. Календарь продолжает выпущенный — со дня после
 * его конца (не раньше `from`) на `days` дней — картинками всех наборов, ещё не бывшими
 * картинкой дня, по правилам сборки (docs/09-content.md, §9) и с днями из `pin`.
 */
export function weekPack(released: Released, built: readonly Source[], plan: WeekPlan, rules: CalendarRules = {}): Week {
  if (!released.catalog) throw new Error('выпущенного каталога нет — сначала первый каталог со встроенным набором (--base)');
  if (released.catalog.packs.some((p) => p.id === plan.id)) throw new Error(`набор ${plan.id} уже выпущен`);
  const lib = libraryIndex(released.packs.map((p) => p.pack));
  const fresh = built
    .filter((b) => !lib.byKey.has(patternKey(b.picture)))
    .map((b) => ({ picture: { ...b.picture, added: plan.from }, pattern: b.pattern }));
  fresh.sort((a, b) => byCollection(a.picture, b.picture));

  const cal = mergedCalendar(released.packs.map((p) => p.pack));
  const last = cal.at(-1);
  const start = last ? maxDate(addDays(last.date, 1), plan.from) : plan.from;
  const wasDaily = new Set(cal.map((d) => d.picture));
  const latest = new Map<string, Picture>(lib.latest.map((p) => [p.id, p]));
  for (const f of fresh) {
    const cur = latest.get(f.picture.id);
    if (!cur || f.picture.v > cur.v) latest.set(f.picture.id, f.picture);
  }
  const pool = [...latest.values()].filter((p) => !wasDaily.has(p.id)).sort(byCollection);
  const end = addDays(start, plan.days);
  const pinned = new Set<string>();
  for (const [date, id] of plan.pin) {
    if (date < start || date >= end) throw new Error(`pin ${date}: вне календаря этого набора (${start} — ${addDays(end, -1)})`);
    if (!pool.some((p) => p.id === id && dailySize(p.size) && !p.hidden)) throw new Error(`pin ${date}: ${id} — не малая и не средняя картинка, ещё не бывшая картинкой дня`);
    if (pinned.has(id)) throw new Error(`pin: ${id} — на двух днях`);
    pinned.add(id);
  }
  const after = last && addDays(last.date, 1) === start ? (latest.get(last.picture)?.collection ?? null) : null;
  const calendar = autoCalendar(pool, start, { ...rules, dates: plan.pin }, { days: plan.days, after });
  if (!fresh.length && !calendar.length) throw new Error('выпускать нечего: ни новых картинок с «да», ни дней календаря');

  const bytes = writePack({ id: plan.id, created: plan.from, pictures: fresh, calendar });
  const err = packError(openPack(bytes));
  if (err) throw new Error(`набор ${plan.id}: ${err}`);
  const catalog = makeCatalog({
    minApp: plan.minApp ?? released.catalog.minApp,
    packs: [
      ...released.packs.map((p) => ({ id: p.entry.id, bytes: p.pack.bytes, builtin: p.entry.builtin, from: p.entry.from })),
      { id: plan.id, bytes, from: plan.from },
    ],
    calendar: calendar.length ? { pack: plan.id, until: calendar.at(-1)!.date } : released.catalog.calendar,
    notice: plan.notice,
  });
  return { bytes, pictures: fresh.map((f) => f.picture), calendar, catalog };
}

/**
 * Первый каталог — встроенный набор выпуска (`builtin`: телефоны его не качают). Встроенный набор
 * следующей версии собирается уже по выпущенному: только выпущенные картинки и выпущенный
 * календарь — иначе прежние версии не получили бы его картинок (этап 1.1).
 */
export function baseCatalog(released: Released, base: Uint8Array, minApp: string): BuiltCatalog {
  if (released.catalog) throw new Error('каталог уже есть: встроенный набор следующей версии собирается по выпущенному (этап 1.1)');
  const pack = openPack(base);
  const cal = pack.json.calendar ?? [];
  return makeCatalog({
    minApp,
    packs: [{ id: pack.json.id, bytes: base, builtin: true }],
    calendar: cal.length ? { pack: pack.json.id, until: cal.at(-1)!.date } : null,
  });
}

/** Откуда читать выпущенное: адрес сервера или папка того же устройства; нет файла — null. */
export function reader(src: string): (path: string) => Promise<Uint8Array | null> {
  if (/^https?:\/\//.test(src)) {
    const base = src.endsWith('/') ? src : `${src}/`;
    return async (path) => {
      const r = await fetch(base + path, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(120000) });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`${base}${path}: HTTP ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    };
  }
  return async (path) => {
    const file = join(src, path);
    return existsSync(file) ? new Uint8Array(readFileSync(file)) : null;
  };
}

/**
 * Выпущенное с сервера: каталог, подпись — одним из ключей `keys` (пусто — не проверить, только
 * для сверки `lax`), наборы — по размеру, SHA-256 и содержимому.
 */
export async function loadReleased(read: (path: string) => Promise<Uint8Array | null>, keys: readonly string[], lax = false): Promise<Released> {
  const json = await read('catalog.json');
  if (!json) return NOTHING_RELEASED;
  const sig = await read('catalog.sig');
  if (!sig) throw new Error('каталог есть, а подписи catalog.sig нет');
  if (!keys.length) {
    if (!lax) throw new Error('нечем проверить подпись выпущенного каталога: ключей нет');
    console.log('предупреждение: подпись выпущенного каталога не проверена — ключей нет');
  } else if (!verifyCatalog(json, utf8Decode(sig), keys)) throw new Error('подпись выпущенного каталога не сходится ни с одним ключом');
  const catalog = readCatalog(utf8Decode(json));
  const packs: Released['packs'] = [];
  for (const entry of catalog.packs) {
    const bytes = await read(entry.file);
    if (!bytes) throw new Error(`${entry.file}: нет на сервере`);
    if (bytes.length !== entry.bytes || sha256Hex(bytes) !== entry.sha256) throw new Error(`${entry.file}: размер или SHA-256 не как в каталоге`);
    const pack = openPack(bytes);
    if (pack.json.id !== entry.id) throw new Error(`${entry.file}: внутри набор ${pack.json.id}`);
    const err = packError(pack);
    if (err) throw new Error(`${entry.file}: ${err}`);
    packs.push({ entry, pack });
  }
  return { catalog, json, sig: utf8Decode(sig), packs };
}

/** Список выпущенного у золотого теста до слияния (tools/test/content.test.ts; ADR 0010). */
export const RELEASED_FIXTURE = join(ROOT, 'tools', 'test', 'fixtures', 'released.json');
const RELEASED_NOTE = 'Выпущенные узоры (ADR 0010): ключ → SHA-256 клеток и палитры. Пополняют bun tools/content/week.ts --base --freeze в PR с «да» владельца и --freeze в PR набора недели (docs/05-process.md, «Выкладывание наборов»).';

/** SHA-256 клеток и палитры узора — как его считает золотой тест. */
export const patternDigest = (p: Pattern) =>
  createHash('sha256').update(p.cells).update(p.threads.map((t) => `${hex(t.rgb)} ${t.name}`).join('\n')).digest('hex');

/**
 * Пополняет список выпущенного у теста: ключ → хеш узора. Записанное не меняется — другой хеш
 * у того же ключа — ошибка: выпущенный узор собрался бы иначе. Возвращает, сколько ключей в списке.
 */
export function freezeReleased(file: string, sources: readonly Source[]): number {
  const doc = JSON.parse(readFileSync(file, 'utf8')) as { _: string; patterns: Record<string, string> };
  doc._ = RELEASED_NOTE;
  for (const s of sources) {
    const key = patternKey(s.picture);
    const sha = patternDigest(s.pattern);
    const was = doc.patterns[key];
    if (was !== undefined && was !== sha) throw new Error(`${key}: в released.json другой узор — поднимите v в карточке`);
    doc.patterns[key] = sha;
  }
  doc.patterns = Object.fromEntries(Object.entries(doc.patterns).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
  return Object.keys(doc.patterns).length;
}

/** Сводка для итогов запуска CI. */
export function weekReport(plan: WeekPlan, w: Week, released: Released): string {
  const lines = [`# Набор недели ${plan.id}`, '', `С ${plan.from}; новых картинок: ${w.pictures.length}; ${(w.bytes.length / 1024).toFixed(1)} КБ; выпущенных наборов до него: ${released.packs.length}.`, ''];
  if (w.pictures.length) {
    lines.push('| id | коллекция | размер | название |', '|---|---|---|---|');
    for (const p of w.pictures) lines.push(`| ${patternKey(p)} | ${p.collection} | ${p.size} | ${p.title} |`);
    lines.push('');
  }
  lines.push(w.calendar.length ? `Календарь картинок дня: ${w.calendar[0].date} — ${w.calendar.at(-1)!.date}.` : 'Календарь не продлён: картинок дня не осталось.', '');
  for (const d of w.calendar) lines.push(`- ${d.date} — ${d.picture}`);
  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const out = opt('--out') ?? join(ROOT, 'dist', 'v1');
  const secret = process.env.CATALOG_SIGNING_KEY?.trim() || null;

  // выложено ли то, что собрано: всё из dist/v1/catalog.json скачивается с сервера и сверяется
  const verify = opt('--verify');
  if (verify) {
    const read = reader(verify);
    const local = new Uint8Array(readFileSync(join(out, 'catalog.json')));
    const remote = await read('catalog.json');
    if (!remote || sha256Hex(remote) !== sha256Hex(local)) throw new Error('catalog.json на сервере — не тот, что собран');
    const sig = await read('catalog.sig');
    if (!sig || utf8Decode(sig) !== readFileSync(join(out, 'catalog.sig'), 'utf8')) throw new Error('catalog.sig на сервере — не тот, что собран');
    const cat = readCatalog(utf8Decode(local));
    for (const p of cat.packs) {
      const b = await read(p.file);
      if (!b || sha256Hex(b) !== p.sha256) throw new Error(`${p.file}: на сервере нет или не тот`);
    }
    console.log(`выложено то, что собрано: каталог, подпись, наборы (${cat.packs.length})`);
    return;
  }

  const src = opt('--released');
  const check = args.includes('--check');
  const base = args.includes('--base');
  const freeze = args.includes('--freeze');
  // узоры встроенного набора закрепляются и без сервера: так в PR с «да» владельца
  if (!src && !(base && freeze)) throw new Error('нужно --released <адрес сервера или папка> (без него — только --base --freeze)');
  // подпись выпущенного проверяется всегда, когда есть чем; без ключей — только для сверки
  const keys = secret ? [...new Set([...CATALOG_KEYS, publicKeyOf(secret)])] : CATALOG_KEYS;
  const released = src ? await loadReleased(reader(src), keys, true) : NOTHING_RELEASED;

  // набор недели — если в content/week.yaml ещё не выпущенный id
  let plan: WeekPlan | null = null;
  const file = join(CONTENT, 'week.yaml');
  if (!check && !base && existsSync(file)) {
    const w = readWeek(parse(readFileSync(file, 'utf8')));
    if (!w.plan) throw new Error(`content/week.yaml: ${w.errors.join('; ')}`);
    if (released.catalog?.packs.some((p) => p.id === w.plan!.id)) console.log(`набор ${w.plan.id} уже выпущен`);
    else plan = w.plan;
  }
  const publish = base || plan !== null;
  if (!publish && !released.catalog && !freeze) {
    console.log('выпущенного каталога нет, выкладывать нечего');
    return;
  }
  // --freeze только пополняет список выпущенного у теста и ничего не подписывает
  if (publish && !freeze) {
    if (!secret) throw new Error('нет CATALOG_SIGNING_KEY: подписать каталог нечем (docs/05-process.md, «Секреты»)');
    if (!CATALOG_KEYS.includes(publicKeyOf(secret))) throw new Error('открытой половины CATALOG_SIGNING_KEY нет в src/state/keys.ts — телефоны не примут каталог (В18)');
  }

  const r = await buildAll({ release: true });
  if (r.failed.length) throw new Error(`картинки не собрались: ${r.failed.map((f) => f.path).join(', ')}`);
  const built = r.built.map((b) => ({ picture: b.picture, pattern: b.pattern }));
  const golden = goldenErrors(released, built);
  for (const g of golden) console.log(`ошибка: ${g}`);
  if (golden.length) process.exit(1);
  const lib = libraryIndex(released.packs.map((p) => p.pack));
  const waiting = built.filter((b) => !lib.byKey.has(patternKey(b.picture))).length;
  console.log(`золотой тест: выпущенные узоры (${lib.byKey.size}) собираются так же; картинок с «да», ещё не выпущенных: ${waiting}`);
  if (!publish && !freeze) return;

  let catalog: BuiltCatalog | null = null;
  let frozen: Source[] = built.filter((b) => lib.byKey.has(patternKey(b.picture)));
  if (base) {
    catalog = baseCatalog(released, r.bytes, APP_VERSION);
    frozen = built;
    console.log(`первый каталог: встроенный набор ${r.meta.id}, ${r.built.length} картинок, minApp ${APP_VERSION}`);
  } else if (plan) {
    const rules: CalendarRules = {
      season: new Map(r.built.flatMap((b) => (b.card.season ? [[b.card.id, b.card.season] as const] : []))),
      day: new Map(r.built.flatMap((b) => (b.card.day ? [[b.card.id, b.card.day] as const] : []))),
    };
    const w = weekPack(released, built, plan, rules);
    catalog = w.catalog;
    const keysOfWeek = new Set(w.pictures.map((p) => patternKey(p)));
    frozen = frozen.concat(built.filter((b) => keysOfWeek.has(patternKey(b.picture))));
    const text = weekReport(plan, w, released);
    if (!freeze) {
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, 'week.md'), text);
    }
    console.log(text);
  }

  if (freeze) {
    const n = freezeReleased(RELEASED_FIXTURE, frozen);
    console.log(`tools/test/fixtures/released.json: узоров ${n} — выпущенные и этого набора`);
    return;
  }

  mkdirSync(join(out, 'packs'), { recursive: true });
  // прежний каталог с подписью — для отката: вернуть оба файла на место
  if (released.json) writeFileSync(join(out, 'previous-catalog.json'), released.json);
  if (released.sig) writeFileSync(join(out, 'previous-catalog.sig'), released.sig);
  // выпущенные наборы уже на сервере: в папку выкладки — только новый
  const old = new Set(released.packs.map((p) => p.entry.file));
  const added = [...catalog!.files.keys()].filter((p) => !old.has(p));
  for (const path of added) writeFileSync(join(out, path), catalog!.files.get(path)!);
  writeFileSync(join(out, 'catalog.json'), catalog!.json);
  writeFileSync(join(out, 'catalog.sig'), signJson(catalog!.json, secret!));
  console.log(`→ ${out}: catalog.json, catalog.sig, ${added.join(', ')}`);
}

if (import.meta.main) {
  main().catch((e: unknown) => {
    console.log(`ошибка: ${(e as Error).message}`);
    process.exit(1);
  });
}
