// Карточки картинок (docs/09-content.md, §3): YAML в content/<коллекция>/, рядом исходник.
// Здесь — чтение и проверка схемы и прав; сборка узора — в build.ts.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { parse } from 'yaml';
import { COLLECTIONS, type CollectionId } from '../../src/engine/library';
import { parseHex } from '../../src/engine/pattern';

export const ROOT = join(import.meta.dir, '..', '..');
export const CONTENT = join(ROOT, 'content');

/**
 * Правило срока с запасом (docs/09-content.md, §2): автор умер в DEATH_LIMIT году или
 * раньше, и работа создана до MADE_LIMIT года. Границу сдвигает владелец записью в 09-content.
 */
export const DEATH_LIMIT = 1951;
export const MADE_LIMIT = 1931;

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
  pattern?: { crop?: [number, number, number, number]; size: number; threads: number; canvas?: string; canvas_delta?: number };
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
    if (!Number.isInteger(p.size) || p.size < 8 || p.size > 120) errors.push(`pattern.size ${p.size} вне 8…120`);
    if (!Number.isInteger(p.threads) || p.threads < 2 || p.threads > 32) errors.push(`pattern.threads ${p.threads} вне 2…32`);
    if (p.crop && (p.crop.length !== 4 || p.crop[0] >= p.crop[2] || p.crop[1] >= p.crop[3] || p.crop.some((x) => x < 0 || x > 1))) errors.push(`pattern.crop ${JSON.stringify(p.crop)}`);
    if (p.canvas !== undefined && parseHex(p.canvas) === null) errors.push(`pattern.canvas «${p.canvas}» не #rrggbb`);
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
  if (card.collection === 'painting' || card.collection === 'tales' || card.collection === 'russia') {
    if (!card.author?.name || !card.author.life) errors.push('у живописи и снимков — автор и годы жизни');
    if (!card.made) errors.push('у живописи и снимков — год работы (made)');
    const death = Math.max(...years(card.author?.life));
    const made = Math.min(...years(card.made));
    if (Number.isFinite(death) && death > DEATH_LIMIT) errors.push(`автор умер в ${death}: позже ${DEATH_LIMIT} (правило срока)`);
    if (Number.isFinite(made) && made >= MADE_LIMIT) errors.push(`работа ${made} года: не раньше ${MADE_LIMIT} (правило срока)`);
  }
  if (card.collection === 'painting' || card.collection === 'tales') {
    if (!card.place) errors.push('у живописи — где хранится оригинал (place)');
    if (card.museum !== 'ru' && card.museum !== 'abroad' && card.museum !== 'none') errors.push('у живописи — museum: ru | abroad | none');
  }
  if (card.approved !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(card.approved))) errors.push(`approved «${String(card.approved)}» — дата`);
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
