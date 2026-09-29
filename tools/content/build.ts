// Сборка картинок (docs/specs/2026-09-content-pipeline.md): карточки и исходники из
// content/ → встроенный набор, отчёт и модуль для приложения. Детерминированно: те же
// карточки — тот же набор до байта (дата набора — из content/pack.yaml, а не «сегодня»).
//
//   bun tools/content/build.ts               все картинки → dist/ и src/content/generated/
//   bun tools/content/build.ts --check       только проверки, как в CI
//   bun tools/content/build.ts --release     только то, что можно выпускать (approved, права)
//   bun tools/content/build.ts --only painting
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { base64Encode } from '../../src/engine/base64';
import { addDays } from '../../src/engine/dates';
import { COLLECTIONS, type CalendarDay, type Picture } from '../../src/engine/library';
import { writePack } from '../../src/engine/pack';
import { CANVAS, dailySize, type Pattern, parseHex } from '../../src/engine/pattern';
import { type Card, CONTENT, listCards, readCard, releasable, ROOT } from './cards';
import { type Checked, checkPattern } from './checks';
import { detectChart, PAPER_DELTA, PAPER_LINES, paperCells, sampleChart, whitePaperCells, whiten } from './chart';
import { decode, type Grid, toGrid } from './image';
import { fromGrid, generate } from './ornaments';
import { type BuildLog, buildPattern } from '../../src/engine/build/palette';

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
  } else grid = toGrid(raster, p.crop ?? [0, 0, 1, 1], p.size);
  return buildPattern(grid, { id: card.id, v: card.v, threads: p.threads, canvas, canvasDelta: p.canvas_delta, exact: !!p.exact });
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

/**
 * Календарь сборки: с `from` по дню на картинку — малые и средние, коллекции по кругу,
 * чтобы две картинки одной коллекции не шли подряд (docs/09-content.md, §8–9).
 */
export function autoCalendar(pictures: Picture[], from: string): CalendarDay[] {
  const queues = COLLECTIONS.map((c) => pictures.filter((p) => p.collection === c && dailySize(p.size) && !p.hidden));
  const out: CalendarDay[] = [];
  let last: string | null = null;
  for (;;) {
    const ready = queues.filter((q) => q.length);
    if (!ready.length) break;
    const q = ready.find((x) => x[0].collection !== last) ?? ready[0];
    const p = q.shift()!;
    out.push({ date: addDays(from, out.length), picture: p.id });
    last = p.collection;
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
  const calendar = autoCalendar(built.map((b) => b.picture), meta.calendar_from ?? meta.created);
  const bytes = writePack({ id: meta.id, created: meta.created, pictures: built.map((b) => ({ picture: b.picture, pattern: b.pattern })), calendar });
  return { meta, built, failed, skipped, bytes, calendar };
}

function report(r: Awaited<ReturnType<typeof buildAll>>): string {
  const lines: string[] = [`# Сборка картинок: ${r.meta.id}`, ''];
  lines.push(`Картинок в наборе: ${r.built.length}; с ошибками: ${r.failed.length}; не в выпуск: ${r.skipped.length}.`, '');
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
  }
  console.log(text);
  console.log(`набор ${r.meta.id}: ${(r.bytes.length / 1024).toFixed(1)} КБ, SHA-256 ${sha}`);
  if (r.failed.length) process.exit(1);
}
