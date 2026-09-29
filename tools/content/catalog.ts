// Каталог наборов для сервера (docs/03-server-api.md, «Каталог»; docs/05-process.md,
// «Выкладывание наборов»): catalog.json по списку наборов — id, файл с первыми восемью знаками
// SHA-256, размер, встроенный ли, с какой даты, — и подпись catalog.sig закрытым ключом из
// секрета CI. Тем же собирает поддельную раздачу сценарий tools/e2e (со своим ключом).
import { type Catalog, CATALOG_FORMAT, type CatalogPack } from '../../src/engine/catalog';
import { sha256Hex, signCatalog } from '../../src/engine/sign';
import { utf8Encode } from '../../src/engine/utf8';

export interface CatalogInput {
  minApp: string;
  packs: { id: string; bytes: Uint8Array; builtin?: boolean; from?: string }[];
  calendar?: { pack: string; until: string } | null;
  notice?: string | null;
}

export interface BuiltCatalog {
  /** точные байты catalog.json: подписываются именно они */
  json: Uint8Array;
  /** путь от папки каталога → байты набора; встроенные тоже выкладываются */
  files: Map<string, Uint8Array>;
}

export function makeCatalog(input: CatalogInput): BuiltCatalog {
  const files = new Map<string, Uint8Array>();
  const packs = input.packs.map((p): CatalogPack => {
    const sha256 = sha256Hex(p.bytes);
    const file = `packs/${p.id}.${sha256.slice(0, 8)}.pack`;
    files.set(file, p.bytes);
    const out: CatalogPack = { id: p.id, file, sha256, bytes: p.bytes.length };
    if (p.builtin) out.builtin = true;
    if (p.from) out.from = p.from;
    return out;
  });
  const catalog: Catalog = { format: CATALOG_FORMAT, minApp: input.minApp, packs, calendar: input.calendar ?? null, notice: input.notice ?? null };
  return { json: utf8Encode(`${JSON.stringify(catalog, null, 2)}\n`), files };
}

/** catalog.sig: подпись Ed25519 точных байтов каталога, base64. */
export const signJson = (json: Uint8Array, secret: string) => `${signCatalog(json, secret)}\n`;
