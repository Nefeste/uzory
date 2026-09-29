// Каталог наборов (docs/03-server-api.md, «Каталог»): что телефон берёт из catalog.json.
// Подпись проверяется до разбора (src/engine/sign.ts), наборы — по размеру и SHA-256 отсюда.
// Каталог приходит из сети, поэтому проверяется строго: id набора становится именем файла.
import { isDate } from './dates';

export const CATALOG_FORMAT = 1;
/** Набор больше не бывает: встроенный — около 2 МБ, с огромными картинами — несколько. */
export const PACK_MAX = 64 * 1024 * 1024;

export interface CatalogPack {
  /** «w2026-41», «base-1.0» */
  id: string;
  /** «packs/w2026-41.a91e0c77.pack» — путь от папки каталога */
  file: string;
  sha256: string;
  bytes: number;
  /** уже лежит в APK: не скачивается */
  builtin?: true;
  /** с какой даты показывать в библиотеке */
  from?: string;
}

export interface Catalog {
  format: number;
  minApp: string;
  packs: CatalogPack[];
  calendar: { pack: string; until: string } | null;
  notice: string | null;
}

export class CatalogError extends Error {}

const PACK_ID = /^[a-z0-9][a-z0-9.-]{0,40}$/;
const SHA = /^[0-9a-f]{64}$/;
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Разбирает каталог. Не JSON, неизвестный `format` или битое поле — CatalogError: телефон
 * такой каталог не трогает и живёт тем, что уже скачал.
 */
export function readCatalog(text: string): Catalog {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new CatalogError('каталог — не JSON');
  }
  if (!isObj(raw)) throw new CatalogError('каталог — не объект');
  if (raw.format !== CATALOG_FORMAT) throw new CatalogError(`формат каталога ${String(raw.format)}`);
  if (typeof raw.minApp !== 'string' || !VERSION.test(raw.minApp)) throw new CatalogError(`minApp ${String(raw.minApp)}`);
  if (!Array.isArray(raw.packs)) throw new CatalogError('нет списка наборов');
  const ids = new Set<string>();
  const packs = raw.packs.map((p): CatalogPack => {
    if (!isObj(p) || typeof p.id !== 'string' || !PACK_ID.test(p.id)) throw new CatalogError(`набор ${JSON.stringify(p)}`);
    const at = `набор ${p.id}`;
    if (ids.has(p.id)) throw new CatalogError(`${at} дважды`);
    ids.add(p.id);
    if (typeof p.sha256 !== 'string' || !SHA.test(p.sha256)) throw new CatalogError(`${at}: sha256`);
    if (p.file !== `packs/${p.id}.${p.sha256.slice(0, 8)}.pack`) throw new CatalogError(`${at}: файл ${String(p.file)}`);
    if (!Number.isInteger(p.bytes) || (p.bytes as number) < 8 || (p.bytes as number) > PACK_MAX) throw new CatalogError(`${at}: ${String(p.bytes)} байт`);
    if (p.builtin !== undefined && p.builtin !== true) throw new CatalogError(`${at}: builtin`);
    if (p.from !== undefined && (typeof p.from !== 'string' || !isDate(p.from))) throw new CatalogError(`${at}: from ${String(p.from)}`);
    const out: CatalogPack = { id: p.id, file: p.file, sha256: p.sha256, bytes: p.bytes as number };
    if (p.builtin) out.builtin = true;
    if (p.from) out.from = p.from;
    return out;
  });
  let calendar: Catalog['calendar'] = null;
  if (raw.calendar !== undefined && raw.calendar !== null) {
    const c = raw.calendar;
    if (!isObj(c) || typeof c.pack !== 'string' || typeof c.until !== 'string' || !isDate(c.until)) throw new CatalogError('календарь каталога');
    calendar = { pack: c.pack, until: c.until };
  }
  let notice: string | null = null;
  if (raw.notice !== undefined && raw.notice !== null) {
    if (typeof raw.notice !== 'string' || raw.notice.length > 200) throw new CatalogError('notice');
    notice = raw.notice.trim() || null;
  }
  return { format: CATALOG_FORMAT, minApp: raw.minApp, packs, calendar, notice };
}

/** «1.0.0» < «1.0.10»: числа по порядку, а не строки. */
export function versionLess(a: string, b: string): boolean {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0);
  return false;
}

/** Что скачать: не встроенные и ещё не скачанные наборы — по порядку выхода. */
export function packsToFetch(c: Catalog, have: ReadonlySet<string>): CatalogPack[] {
  return c.packs.filter((p) => !p.builtin && !have.has(p.id));
}
