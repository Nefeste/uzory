// Сборка картинок (docs/specs/2026-09-content-pipeline.md): карточки и исходники из
// content/ → встроенный набор, отчёт и модуль для приложения; заодно — список пьес музыки
// (assets/music/music.yaml → src/content/generated/music.ts). Детерминированно: те же
// карточки — тот же набор до байта (дата набора — из content/pack.yaml, а не «сегодня»).
//
//   bun tools/content/build.ts               все картинки → dist/ и src/content/generated/
//   bun tools/content/build.ts --check       только проверки, как в CI
//   bun tools/content/build.ts --release     только то, что можно выпускать (approved, права; и музыка);
//                                            ни одной такой картинки — ошибка
//   bun tools/content/build.ts --only painting
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { base64Encode } from '../../src/engine/base64';
import { addDays, daysBetween } from '../../src/engine/dates';
import { COLLECTIONS, type CalendarDay, type CollectionId, type Picture } from '../../src/engine/library';
import { writePack } from '../../src/engine/pack';
import { CANVAS, dailySize, type Pattern, parseHex, type SizeClass } from '../../src/engine/pattern';
import { type Card, CONTENT, listCards, readCard, releasable, ROOT, type Season, SEASONS } from './cards';
import { type Checked, checkPattern } from './checks';
import { detectChart, PAPER_DELTA, PAPER_LINES, paperCells, sampleChart, whitePaperCells, whiten } from './chart';
import { decode, type Grid, toGrid } from './image';
import { fromGrid, generate } from './ornaments';
import { musicModule, readTracks } from '../audio/tracks';
import { type BuildLog, buildPattern } from '../../src/engine/build/palette';
import { SIMPLIFY_CLEAN, simplifyGrid } from '../../src/engine/build/simplify';

/** Встроенный набор — не больше 8 МБ (docs/02-architecture.md, «Ограничения»): у выпуска — ошибка, у сборки для проверки — предупреждение. */
export const PACK_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Предел времени сборки картинки (docs/specs/2026-09-content-pipeline.md, критерий 4): огромная —
 * 10 с, остальные — 2 с. Время зависит от машины, поэтому дольше предела — предупреждение в отчёте,
 * а не ошибка: в CI отчёт попадает в итоги прогона.
 */
export const buildLimitMs = (size: SizeClass) => (size === 'XL' ? 10_000 : 2_000);

/** Картинки, собиравшиеся дольше своего предела. */
export const slowPictures = (built: readonly Pick<Built, 'card' | 'checked' | 'ms'>[]) => built.filter((b) => b.ms > buildLimitMs(b.checked.size));

export interface Built {
  card: Card;
  pattern: Pattern;
  picture: Picture;
  checked: Checked;
  log?: BuildLog;
  ms: number;
  /** почему не в выпуск (сборки для проверки его показывают) */
  trial: string | null;
}

export async function buildCard(card: Card): Promise<{ pattern: Pattern; log?: BuildLog }> {
  const key = `${card.id}@${card.v}`;
  if (card.drawn) {
    const keys = Object.keys(card.drawn.legend);
    const d = card.drawn.grid ? fromGrid(card.drawn.grid, keys) : generate(card.drawn.generator!, card.drawn.params);
    const used = new Set([...d.cells].filter((c) => c !== CANVAS));
    // нити легенды, которых нет в рисунке, выпадают; номера — по порядку легенды
    const keep = keys.map((_, i) => i).filter((i) => used.has(i));
    const remap = new Map(keep.map((old, neu) => [old, neu]));
    const cells = d.cells.map((c) => (c === CANVAS ? CANVAS : remap.get(c)!));
    const threads = keep.map((i) => {
      const [hex, name] = card.drawn!.legend[keys[i]];
      return { rgb: parseHex(hex)!, name };
    });
    return { pattern: { key, w: d.w, h: d.h, threads, cells } };
  }
  const file = join(card.dir, card.source.file!);
  if (!existsSync(file)) throw new Error(`исходника ${card.source.file} нет рядом с карточкой`);
  const raster = await decode(file);
  const p = card.pattern!;
  const canvas = p.canvas ? parseHex(p.canvas)! : undefined;
  let grid: Grid;
  if (p.chart) {
    // старинная схема: линии сетки — по скану, число клеток — сверка с карточкой
    let cells = sampleChart(raster, detectChart(raster, p.chart), p.inset ?? 0.25);
    if (cells.w !== p.cells![0] || cells.h !== p.cells![1]) throw new Error(`схема: вышло ${cells.w} × ${cells.h} клеток, в карточке ${p.cells!.join(' × ')}`);
    const delta = p.canvas_delta ?? PAPER_DELTA;
    if (canvas === undefined) grid = cells;
    else if (p.white_paper) {
      // пожелтевший лист: цвета — как на белой бумаге, и бумага теперь белая
      cells = whiten(cells);
      grid = { ...cells, paper: whitePaperCells(cells, delta) };
    } else grid = { ...cells, paper: paperCells(cells, canvas, delta, p.canvas_lines ?? PAPER_LINES) };
  } else grid = simplifyGrid(toGrid(raster, p.crop ?? [0, 0, 1, 1], p.size), p.simplify ?? 0);
  return buildPattern(grid, {
    id: card.id, v: card.v, threads: p.threads, canvas, canvasDelta: p.canvas_delta, exact: !!p.exact,
    clean: SIMPLIFY_CLEAN[p.simplify ?? 0],
  });
}

export function toPicture(card: Card, size: Picture['size'], created: string, trial: string | null): Picture {
  const p: Picture = {
    id: card.id, v: card.v, title: card.title, collection: card.collection, order: card.order, size,
    source: { url: card.source.url, basis: card.source.basis }, added: card.added ?? created,
  };
  if (card.free || card.collection === 'kids') p.free = true;
  if (card.author) p.author = card.author.life ? { name: card.author.name, life: card.author.life } : { name: card.author.name };
  if (card.made) p.made = String(card.made);
  if (card.place) p.place = card.place;
  if (card.about) p.about = card.about.trim();
  if (card.hidden) p.hidden = true;
  if (trial) p.trial = true;
  return p;
}

/** Время года дня: зима — декабрь, январь, февраль; весна — с марта; лето — с июня; осень — с сентября. */
export function seasonOf(date: string): Season {
  const m = Number(date.slice(5, 7));
  return m === 12 || m <= 2 ? 'winter' : m <= 5 ? 'spring' : m <= 8 ? 'summer' : 'autumn';
}

/** a лучше b: первое различие по порядку — больше */
const better = (a: number[], b: number[]) => {
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] > b[k];
  return false;
};

/** Первый день времени года `s` с даты `from` включительно и первый день после него. */
function seasonWindow(s: Season, from: string): [string, string] {
  let d = from;
  while (seasonOf(d) !== s) d = addDays(d, 1);
  const start = d;
  while (seasonOf(d) === s) d = addDays(d, 1);
  return [start, d];
}

/** Правила календаря из карточек (docs/09-content.md, §9). */
export interface CalendarRules {
  /** время года картинки (`season`): только в свой сезон, вразбивку по нему */
  season?: ReadonlyMap<string, Season>;
  /** день картинки «ММ-ДД» (`day`, праздник): ровно в этот день, если календарь до него дотянется */
  day?: ReadonlyMap<string, string>;
  /**
   * дни, расставленные руками в наборе недели (content/week.yaml, `pin`): дата → картинка —
   * праздник с плавающей датой, день рождения художника
   */
  dates?: ReadonlyMap<string, string>;
}

/** Как продолжать календарь: сколько дней (нет — пока есть картинки) и коллекция дня перед `from`. */
export interface CalendarRun {
  days?: number;
  after?: CollectionId | null;
}

/**
 * Календарь сборки: с `from` по дню на картинку — малые и средние (docs/09-content.md, §8–9).
 * - Картинка с днём (`day`) встаёт ровно в свой день — ближайший с `from`, если календарь
 *   до него дотянется; иначе в календарь не идёт.
 * - Картинка со временем года (`season`) встаёт только в свой сезон — первый с `from` — и не
 *   раньше своей доли сезона: картинки одного сезона идут вразбивку, а не в первые дни.
 * - В прочие дни выбирается коллекция: не та, что вчера, и не та, что у завтрашнего праздника,
 *   пока есть другая (две картинки одной коллекции подряд не идут); среди прочих — та, где
 *   подошла картинка сезона, потом та, где картинок осталось больше, — так коллекции идут
 *   вперемешку до конца, а не одна за другой.
 * - Картинка из `dates` — ровно в свою дату; такой день важнее праздника из карточки.
 * Остались одни картинки других сезонов — календарь кончается; `run.days` — не дальше стольких
 * дней, `run.after` — коллекция дня перед `from`: набор недели продолжает выпущенный календарь.
 */
export function autoCalendar(pictures: Picture[], from: string, rules: CalendarRules = {}, run: CalendarRun = {}): CalendarDay[] {
  const season = rules.season ?? new Map<string, Season>();
  const day = rules.day ?? new Map<string, string>();
  const dates = rules.dates ?? new Map<string, string>();
  const byDate = new Set(dates.values());
  const daily = pictures.filter((p) => dailySize(p.size) && !p.hidden);
  const queues = COLLECTIONS.map((c) => daily.filter((p) => p.collection === c && !day.has(p.id) && !byDate.has(p.id)));
  const pinned = new Map<string, Picture>();
  for (const [d, id] of dates) {
    const p = daily.find((x) => x.id === id);
    if (p) pinned.set(d, p);
  }
  // праздники: ближайший такой день, если до него картинок хватит
  for (const p of daily) {
    const md = day.get(p.id);
    if (!md || byDate.has(p.id)) continue;
    for (let k = 0; k < daily.length; k++) {
      const d = addDays(from, k);
      if (d.slice(5) === md) {
        if (!pinned.has(d)) pinned.set(d, p);
        break;
      }
    }
  }
  // время года: k-я из n картинок сезона — не раньше k/(n+1) его длины
  const notBefore = new Map<string, string>();
  for (const s of SEASONS) {
    const list = queues.flat().filter((p) => season.get(p.id) === s);
    if (!list.length) continue;
    const [start, end] = seasonWindow(s, from);
    const len = daysBetween(start, end);
    list.forEach((p, k) => notBefore.set(p.id, addDays(start, Math.floor(((k + 1) * len) / (list.length + 1)))));
  }
  const out: CalendarDay[] = [];
  let last: string | null = run.after ?? null;
  for (;;) {
    if (run.days !== undefined && out.length >= run.days) break;
    const date = addDays(from, out.length);
    const now = seasonOf(date);
    const tomorrow = pinned.get(addDays(date, 1))?.collection ?? null;
    let pick = pinned.get(date) ?? null;
    if (!pick) {
      let best: { q: Picture[]; i: number; key: number[] } | null = null;
      for (const q of queues) {
        const due = q.findIndex((p) => season.get(p.id) === now && date >= notBefore.get(p.id)!);
        const i = due >= 0 ? due : q.findIndex((p) => !season.has(p.id));
        if (i < 0) continue;
        const c = q[i].collection;
        const key: number[] = [c !== last ? 1 : 0, c !== tomorrow ? 1 : 0, due >= 0 ? 1 : 0, q.length];
        if (!best || better(key, best.key)) best = { q, i, key };
      }
      if (best) pick = best.q.splice(best.i, 1)[0];
    }
    if (!pick) break;
    out.push({ date, picture: pick.id });
    last = pick.collection;
  }
  return out;
}

interface PackMeta { id: string; created: string; calendar_from?: string }

export async function buildAll(opts: { only?: string; release?: boolean } = {}) {
  const meta = parse(readFileSync(join(CONTENT, 'pack.yaml'), 'utf8')) as PackMeta;
  const built: Built[] = [];
  const failed: { path: string; errors: string[] }[] = [];
  const skipped: { path: string; why: string }[] = [];
  const ids = new Set<string>();
  for (const file of listCards(opts.only)) {
    const { card, errors } = readCard(file);
    if (!card) {
      failed.push({ path: file.replace(`${ROOT}/`, ''), errors });
      continue;
    }
    if (ids.has(card.id)) {
      failed.push({ path: card.path, errors: [`id ${card.id} уже есть`] });
      continue;
    }
    ids.add(card.id);
    const trial = releasable(card);
    if (opts.release && trial) {
      skipped.push({ path: card.path, why: trial });
      continue;
    }
    const t0 = performance.now();
    try {
      const { pattern, log } = await buildCard(card);
      const ms = performance.now() - t0;
      const checked = checkPattern(pattern, card);
      if (checked.errors.length) {
        failed.push({ path: card.path, errors: checked.errors });
        continue;
      }
      built.push({ card, pattern, picture: toPicture(card, checked.size, meta.created, trial), checked, log, ms, trial });
    } catch (e) {
      failed.push({ path: card.path, errors: [(e as Error).message] });
    }
  }
  const col = (c: string) => COLLECTIONS.indexOf(c as Picture['collection']);
  built.sort((a, b) => col(a.card.collection) - col(b.card.collection) || a.card.order - b.card.order || a.card.id.localeCompare(b.card.id));
  const season = new Map(built.flatMap((b) => (b.card.season ? [[b.card.id, b.card.season] as const] : [])));
  const day = new Map(built.flatMap((b) => (b.card.day ? [[b.card.id, b.card.day] as const] : [])));
  const calendar = autoCalendar(built.map((b) => b.picture), meta.calendar_from ?? meta.created, { season, day });
  const bytes = writePack({ id: meta.id, created: meta.created, pictures: built.map((b) => ({ picture: b.picture, pattern: b.pattern })), calendar });
  return { meta, built, failed, skipped, bytes, calendar, ms: built.reduce((sum, b) => sum + b.ms, 0) };
}

function report(r: Awaited<ReturnType<typeof buildAll>>): string {
  const lines: string[] = [`# Сборка картинок: ${r.meta.id}`, ''];
  lines.push(`Картинок в наборе: ${r.built.length}; с ошибками: ${r.failed.length}; не в выпуск: ${r.skipped.length}; сборка узоров — ${(r.ms / 1000).toFixed(0)} с.`, '');
  if (r.failed.length) {
    lines.push('## Ошибки', '');
    for (const f of r.failed) lines.push(`- \`${f.path}\`: ${f.errors.join('; ')}`);
    lines.push('');
  }
  const warn = r.built.filter((b) => b.checked.warnings.length);
  if (warn.length) {
    lines.push('## Предупреждения', '');
    for (const b of warn) lines.push(`- \`${b.card.path}\`: ${b.checked.warnings.join('; ')}`);
    lines.push('');
  }
  const slow = slowPictures(r.built);
  if (slow.length) {
    lines.push('## Дольше предела', '');
    for (const b of slow) lines.push(`- \`${b.card.path}\`: ${(b.ms / 1000).toFixed(1)} с при пределе ${buildLimitMs(b.checked.size) / 1000} с`);
    lines.push('');
  }
  lines.push('## Картинки', '', '| id | размер | клеток | нитей (заказано → после слияния → итог) | одиночных | в мелких пятнах | различимость | не в выпуск | мс |', '|---|---|---|---|---|---|---|---|---|');
  for (const b of r.built) {
    const s = b.checked.stats;
    const n = b.log ? `${b.log.asked} → ${b.log.afterMerge} → ${b.log.final}` : String(b.pattern.threads.length);
    lines.push(`| ${b.card.id} | ${b.checked.size} ${b.pattern.w}×${b.pattern.h} | ${s.cells} | ${n} | ${s.singles.toFixed(2)} % | ${s.small.toFixed(2)} % | ${Number.isFinite(s.minDelta) ? s.minDelta.toFixed(3) : '—'} | ${b.trial ?? ''} | ${b.ms.toFixed(0)} |`);
  }
  if (r.skipped.length) {
    lines.push('', '## Не в выпуск', '');
    for (const s of r.skipped) lines.push(`- \`${s.path}\`: ${s.why}`);
  }
  return `${lines.join('\n')}\n`;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : undefined;
  const check = args.includes('--check');
  const release = args.includes('--release');
  const r = await buildAll({ only, release });
  // пьесы музыки — рядом с набором: их список проверяется и в --check (docs/09-content.md, «Звук и музыка»)
  const music = musicModule(readTracks(), release);
  const text = report(r);
  const sha = createHash('sha256').update(r.bytes).digest('hex');
  if (!check) {
    const dist = join(ROOT, 'dist');
    mkdirSync(join(dist, 'packs'), { recursive: true });
    writeFileSync(join(dist, 'packs', `${r.meta.id}.${sha.slice(0, 8)}.pack`), r.bytes);
    writeFileSync(join(dist, 'report.md'), text);
    const gen = join(ROOT, 'src', 'content', 'generated');
    mkdirSync(gen, { recursive: true });
    writeFileSync(join(gen, 'pack.ts'), `// Собрано tools/content/build.ts из content/ — не править руками.\n// ${r.meta.id}, ${r.built.length} картинок, SHA-256 ${sha}\nexport const BASE_PACK = '${base64Encode(r.bytes)}';\n`);
    writeFileSync(join(gen, 'music.ts'), music);
  }
  console.log(text);
  console.log(`набор ${r.meta.id}: ${(r.bytes.length / 1024).toFixed(1)} КБ, SHA-256 ${sha}`);
  const over = r.bytes.length > PACK_MAX_BYTES;
  if (over) console.log(`${release ? 'ошибка' : 'предупреждение'}: набор больше ${PACK_MAX_BYTES / 1048576} МБ — бюджет встроенного набора (docs/02-architecture.md, «Ограничения»)`);
  // выпуск без единой картинки — пустое приложение: его не собирают (docs/09-content.md, §8)
  const empty = release && !r.built.length;
  if (empty) console.log('ошибка: в выпуск не попала ни одна картинка — нужны «да» владельца (approved; docs/09-content.md, §8)');
  if (r.failed.length || (over && release) || empty) process.exit(1);
}
