// Карточки картинок (docs/09-content.md, §3): YAML в content/<коллекция>/, рядом исходник.
// Здесь — чтение и проверка схемы и прав; сборка узора — в build.ts.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { parse } from 'yaml';
import { COLLECTIONS, type CollectionId } from '../../src/engine/library';
import { isDate } from '../../src/engine/dates';
import { parseHex } from '../../src/engine/pattern';
import { SIZES } from './checks';

export const ROOT = join(import.meta.dir, '..', '..');
export const CONTENT = join(ROOT, 'content');

/**
 * Правило срока с запасом (docs/09-content.md, §2): автор умер в DEATH_LIMIT году или
 * раньше, и работа создана до MADE_LIMIT года. Границу сдвигает владелец записью в 09-content.
 */
export const DEATH_LIMIT = 1951;
export const MADE_LIMIT = 1931;

/** Времена года календаря картинок дня (docs/09-content.md, §9): зима — декабрь–февраль и так далее. */
export const SEASONS = ['winter', 'spring', 'summer', 'autumn'] as const;
export type Season = (typeof SEASONS)[number];

export interface Card {
  id: string;
  v: number;
  title: string;
  collection: CollectionId;
  order: number;
  author?: { name: string; life?: string };
  made?: string;
  place?: string;
  museum?: 'ru' | 'abroad' | 'none';
  license?: string | null;
  about?: string;
  about_sources?: string[];
  source: { file?: string; url: string; basis: string };
  pattern?: {
    crop?: [number, number, number, number]; size: number; threads: number; canvas?: string; canvas_delta?: number;
    /**
     * Старинная схема (chart.ts): рамка чуть шире сетки в долях кадра — линии сборка находит
     * сама, поле без сетки отрезает; сколько клеток должно выйти; доля клетки с краёв без
     * линий сетки. Фон — бумага: цвет не дальше canvas_delta от бумаги рядом и сетка видна
     * хотя бы на canvas_lines (ChartCells.lines).
     */
    chart?: [number, number, number, number]; cells?: [number, number]; inset?: number; canvas_lines?: number;
    /** схема на белой бумаге, скан пожелтел: цвета — относительно бумаги рядом (chart.ts, whiten) */
    white_paper?: boolean;
    /**
     * печатная схема ровными красками: одиночные клетки и шахматка — замысел, чистка их не
     * трогает, а проверка одиночных и мелких пятен — предупреждение (docs/09-content.md, §6)
     */
    exact?: boolean;
    /** упрощение перед палитрой: 1 — немного, 2 — сильно (src/engine/build/simplify.ts) */
    simplify?: 1 | 2;
  };
  drawn?: {
    legend: Record<string, [string, string]>;
    grid?: string;
    generator?: string;
    params?: Record<string, number | number[]>;
  };
  approved?: string;
  added?: string;
  free?: boolean;
  hidden?: boolean;
  /** время года: в календаре сборки картинка встаёт только в свой сезон (docs/09-content.md, §9) */
  season?: Season;
  /** день «ММ-ДД» — праздник: в календаре сборки картинка встаёт ровно в этот день (§9) */
  day?: string;
  /** путь к карточке от корня — для отчёта */
  path: string;
  dir: string;
}

const years = (s: string | undefined) => (s?.match(/\d{4}/g) ?? []).map(Number);

export function listCards(only?: string): string[] {
  const out: string[] = [];
  for (const col of readdirSync(CONTENT)) {
    const dir = join(CONTENT, col);
    if (!statSync(dir).isDirectory() || (only && col !== only)) continue;
    for (const f of readdirSync(dir).sort()) if (f.endsWith('.yaml')) out.push(join(dir, f));
  }
  return out.sort();
}

/** Читает карточку; ошибки схемы и прав — списком (пустой — карточка цела). */
export function readCard(file: string): { card: Card | null; errors: string[] } {
  const errors: string[] = [];
  let raw: Record<string, unknown>;
  try {
    raw = parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch (e) {
    return { card: null, errors: [`YAML: ${(e as Error).message}`] };
  }
  const card = { v: 1, ...raw, path: relative(ROOT, file), dir: dirname(file) } as Card;
  const col = basename(dirname(file));
  if (card.id !== basename(file, '.yaml')) errors.push(`id «${card.id}» не совпадает с именем файла`);
  if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(String(card.id))) errors.push('id — латиница, цифры и дефис, до 80 знаков');
  if (!Number.isInteger(card.v) || card.v < 1) errors.push(`версия узора v: ${String(card.v)}`);
  if (typeof card.title !== 'string' || !card.title.trim()) errors.push('нет названия');
  if (!COLLECTIONS.includes(card.collection)) errors.push(`коллекция «${String(card.collection)}»`);
  else if (card.collection !== col) errors.push(`коллекция ${card.collection}, а папка ${col}`);
  if (!Number.isInteger(card.order) || card.order < 0) errors.push(`order: ${String(card.order)}`);
  if (!card.source || typeof card.source.basis !== 'string' || !card.source.basis.trim()) errors.push('нет основания (source.basis)');
  if (!card.source || typeof card.source.url !== 'string') errors.push('нет адреса источника (source.url; для своей работы — пустая строка)');
  if (!!card.pattern === !!card.drawn) errors.push('нужно ровно одно: pattern (из исходника) или drawn (нарисован)');
  if (card.pattern) {
    const p = card.pattern;
    if (!card.source?.file) errors.push('pattern без source.file');
    // пределы — самого большого размера, «Огромной» (docs/08-game-design.md, «Размеры узоров»)
    const top = SIZES.XL;
    if (!Number.isInteger(p.size) || p.size < 8 || p.size > top.side) errors.push(`pattern.size ${p.size} вне 8…${top.side}`);
    if (!Number.isInteger(p.threads) || p.threads < 2 || p.threads > top.threads[1]) errors.push(`pattern.threads ${p.threads} вне 2…${top.threads[1]}`);
    if (p.crop && (p.crop.length !== 4 || p.crop[0] >= p.crop[2] || p.crop[1] >= p.crop[3] || p.crop.some((x) => x < 0 || x > 1))) errors.push(`pattern.crop ${JSON.stringify(p.crop)}`);
    if (p.canvas !== undefined && parseHex(p.canvas) === null) errors.push(`pattern.canvas «${p.canvas}» не #rrggbb`);
    if (p.cells !== undefined && (!Array.isArray(p.cells) || p.cells.length !== 2 || p.cells.some((c) => !Number.isInteger(c) || c < 4) || Math.max(...p.cells) !== p.size)) {
      errors.push(`pattern.cells ${JSON.stringify(p.cells)}: два целых не меньше 4, большее — равно size`);
    }
    if (p.inset !== undefined && (typeof p.inset !== 'number' || p.inset < 0 || p.inset > 0.45)) errors.push(`pattern.inset ${String(p.inset)} вне 0…0,45`);
    if ((p.cells !== undefined || p.inset !== undefined) && !p.chart) errors.push('pattern.cells и inset — только у схемы (chart)');
    if (p.chart !== undefined) {
      if (p.chart.length !== 4 || p.chart[0] >= p.chart[2] || p.chart[1] >= p.chart[3] || p.chart.some((x) => x < 0 || x > 1)) errors.push(`pattern.chart ${JSON.stringify(p.chart)}`);
      if (!p.cells) errors.push('pattern.chart без cells: сколько клеток должно выйти');
      if (p.crop) errors.push('pattern.chart и crop вместе: у схемы кадр — рамка сетки');
    }
    if (p.canvas_lines !== undefined && (typeof p.canvas_lines !== 'number' || p.canvas_lines <= 0 || p.canvas_lines > 0.5 || !p.chart || !p.canvas)) {
      errors.push(`pattern.canvas_lines ${String(p.canvas_lines)}: 0…0,5 и только у схемы с canvas`);
    }
    if (p.white_paper !== undefined && (p.white_paper !== true || !p.chart || !p.canvas)) errors.push('pattern.white_paper: true и только у схемы с canvas');
    if (p.exact !== undefined && (p.exact !== true || !p.chart)) errors.push('pattern.exact: true и только у схемы (chart)');
    if (p.simplify !== undefined && ((p.simplify !== 1 && p.simplify !== 2) || p.chart)) errors.push(`pattern.simplify ${String(p.simplify)}: 1 или 2, и не у схемы — её клетки и так замысел`);
  }
  if (card.drawn) {
    const d = card.drawn;
    if (!d.legend || typeof d.legend !== 'object') errors.push('drawn без легенды');
    else for (const [k, v] of Object.entries(d.legend)) {
      if (k.length !== 1 || k === '.') errors.push(`ключ легенды «${k}» — один знак, не точка`);
      if (!Array.isArray(v) || parseHex(v[0]) === null || typeof v[1] !== 'string') errors.push(`нить «${k}»: [«#rrggbb», название]`);
    }
    if (!d.grid === !d.generator) errors.push('drawn: либо grid, либо generator');
  }
  // рисунки и снимки живописи несут автора и год; правило срока
  const art = card.collection === 'painting' || card.collection === 'tales' || card.collection === 'flowers';
  if (art || card.collection === 'russia') {
    if (!card.author?.name || !card.author.life) errors.push('у живописи и снимков — автор и годы жизни');
    if (!card.made) errors.push('у живописи и снимков — год работы (made)');
    const death = Math.max(...years(card.author?.life));
    const made = Math.min(...years(card.made));
    if (Number.isFinite(death) && death > DEATH_LIMIT) errors.push(`автор умер в ${death}: позже ${DEATH_LIMIT} (правило срока)`);
    if (Number.isFinite(made) && made >= MADE_LIMIT) errors.push(`работа ${made} года: не раньше ${MADE_LIMIT} (правило срока)`);
  }
  if (art) {
    if (!card.place) errors.push('у живописи — где хранится оригинал (place)');
    if (card.museum !== 'ru' && card.museum !== 'abroad' && card.museum !== 'none') errors.push('у живописи — museum: ru | abroad | none');
  }
  if (card.approved !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(card.approved))) errors.push(`approved «${String(card.approved)}» — дата`);
  if (card.season !== undefined && !SEASONS.includes(card.season)) errors.push(`season «${String(card.season)}» — одно из: ${SEASONS.join(', ')}`);
  if (card.day !== undefined && !(typeof card.day === 'string' && /^\d{2}-\d{2}$/.test(card.day) && isDate(`2028-${card.day}`))) {
    errors.push(`day «${String(card.day)}» — день года «ММ-ДД», например «12-31»`);
  }
  return { card: errors.length ? null : card, errors };
}

/**
 * Можно ли в выпуск: есть «да» владельца и не музейный предмет из России без лицензии
 * (docs/09-content.md, §2, «Музейные предметы»). Иначе — только в сборки для проверки.
 */
export function releasable(c: Card): string | null {
  if (!c.approved) return 'нет «да» владельца (approved)';
  if (c.museum === 'ru' && !c.license) return 'оригинал в российском музее, лицензии нет (решение В12)';
  return null;
}
