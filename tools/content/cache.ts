// Кэш узоров сборки картинок (вопрос владельца 31.10.2026: «можно уменьшить время тестирования при слиянии
// каждого PR?» — из 21,5 минуты проверки PR 20 уходили на три полные сборки набора). Узор карточки — функция
// карточки, её исходника и кода сборки. Ключ — SHA-256 карточки (без путей), версии узора, байтов исходника
// и отпечатка кода сборки: файлов, которые tools/content/build.ts импортирует (сам и через другие), версии
// Bun и зависимостей из package-lock.json (sharp и libvips читают снимки) — без номера версии приложения:
// его поднимает почти каждый PR, а сборку он не меняет. Значение — узор, журнал сборки и маска лиц: JSON
// в node_modules/.cache/uzory-patterns — не в dist: dist android.yml передаёт между заданиями, а
// node_modules никто не выкладывает и npm ci очищает. Шаг CI «Картинки» наполняет кэш, тесты и сценарий
// в той же задаче берут готовое; «две сборки подряд» сверяют кэш со свежей сборкой
// (tools/test/content.test.ts). UZORY_BUILD_CACHE=0 — сборка без кэша.
//
//   bun tools/content/cache.ts --files                        — файлы, от которых зависит сборка узоров
//   bun tools/content/cache.ts --touches [--base РЕВ] < файлы — «yes», если среди файлов (по одному в строке)
//     есть такие; package-lock.json — только если зависимости другие, чем в ревизии РЕВ (без неё — «yes»)
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { base64Decode, base64Encode } from '../../src/engine/base64';
import type { BuildLog } from '../../src/engine/build/palette';
import type { Pattern } from '../../src/engine/pattern';
import { type Card, ROOT } from './cards';

export const CACHE_DIR = join(ROOT, 'node_modules', '.cache', 'uzory-patterns');

/** Сборка с кэшем, если его не выключили. */
export const cacheOn = () => process.env.UZORY_BUILD_CACHE !== '0';

export interface CardBuild {
  pattern: Pattern;
  log?: BuildLog;
  focus?: Uint8Array;
  guard?: number;
}

/** Относительные импорты: `import … from`, `export … from`, `import './x'` и `import('./x')`. */
const IMPORT = /(?:^|[\s;])(?:import|export)\s[^'"]*?from\s+['"](\.[^'"]+)['"]|(?:^|[\s;])import\s*\(?\s*['"](\.[^'"]+)['"]/g;

function resolveImport(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const f of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) if (existsSync(f) && statSync(f).isFile()) return f;
  return null;
}

export const LOCK = 'package-lock.json';

/**
 * Отпечаток зависимостей: package-lock.json без номера версии приложения (`version` в корне и у пакета
 * ""). Поднятая версия меняет только эти два поля — зависимости сборки те же.
 */
export function lockPrint(text: string): string {
  const j = JSON.parse(text) as { version?: string; packages?: Record<string, { version?: string }> };
  delete j.version;
  if (j.packages?.['']) delete j.packages[''].version;
  return createHash('sha256').update(JSON.stringify(j)).digest('hex');
}

let files: string[] | null = null;

/** Файлы кода, от которых зависит сборка узоров: всё, что tools/content/build.ts импортирует, и package-lock.json. */
export function builderFiles(): string[] {
  if (files) return files;
  const seen = new Set<string>();
  const queue = [join(ROOT, 'tools', 'content', 'build.ts')];
  while (queue.length) {
    const f = queue.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(IMPORT)) {
      const next = resolveImport(f, m[1] ?? m[2]);
      if (next && !next.includes(`${ROOT}/node_modules/`)) queue.push(next);
    }
  }
  files = [...seen, join(ROOT, LOCK)].map((f) => relative(ROOT, f)).sort();
  return files;
}

let print: string | null = null;

/** Отпечаток кода сборки: поменялся любой его файл, Bun или зависимости — ключи у всех карточек новые. */
export function builderPrint(): string {
  if (print) return print;
  const h = createHash('sha256');
  for (const f of builderFiles()) {
    h.update(f);
    h.update('\0');
    h.update(f === LOCK ? lockPrint(readFileSync(join(ROOT, f), 'utf8')) : readFileSync(join(ROOT, f)));
    h.update('\0');
  }
  h.update(`bun ${Bun.version}`);
  print = h.digest('hex');
  return print;
}

/** Ключ узора карточки версии `v`. */
export function cardKey(card: Card, v: number): string {
  const { path: _path, dir: _dir, ...rest } = card;
  const h = createHash('sha256');
  h.update(builderPrint());
  h.update(JSON.stringify(rest));
  h.update(`@${v}`);
  if (!card.drawn && card.source?.file) {
    const f = join(card.dir, card.source.file);
    if (existsSync(f)) h.update(readFileSync(f));
  }
  return h.digest('hex');
}

/**
 * Меняет ли PR код сборки узоров: `changed` — его файлы от корня репозитория, `baseLock` — package-lock.json
 * до PR. Lock-файл в списке, а зависимости те же (поднята только версия приложения) — нет; прежнего
 * lock-файла нет — да, на всякий случай.
 */
export function touchesBuilder(changed: Iterable<string>, baseLock: string | null = null): boolean {
  const set = new Set(builderFiles());
  for (const raw of changed) {
    const f = raw.trim();
    if (!set.has(f)) continue;
    if (f !== LOCK) return true;
    const now = join(ROOT, LOCK);
    if (baseLock === null || !existsSync(now) || lockPrint(baseLock) !== lockPrint(readFileSync(now, 'utf8'))) return true;
  }
  return false;
}

/** Файл ревизии git (`git show РЕВ:файл`); нет ревизии или файла — null. */
function gitShow(rev: string, file: string): string | null {
  const r = Bun.spawnSync(['git', 'show', `${rev}:${file}`], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' });
  return r.exitCode === 0 ? r.stdout.toString() : null;
}

const fileOf = (key: string, dir: string) => join(dir, `${key}.json`);

/** Узор из кэша; нет или испорчен — null. Взятый узор помечается свежим: его не уберёт `pruneCache`. */
export function readCached(key: string, dir = CACHE_DIR): CardBuild | null {
  const f = fileOf(key, dir);
  if (!existsSync(f)) return null;
  try {
    const j = JSON.parse(readFileSync(f, 'utf8')) as { pattern: Omit<Pattern, 'cells'> & { cells: string }; log?: BuildLog; focus?: string; guard?: number };
    const now = new Date();
    utimesSync(f, now, now);
    return {
      pattern: { ...j.pattern, cells: base64Decode(j.pattern.cells) },
      ...(j.log ? { log: j.log } : {}),
      ...(j.focus ? { focus: base64Decode(j.focus) } : {}),
      ...(j.guard !== undefined ? { guard: j.guard } : {}),
    };
  } catch {
    return null;
  }
}

export function writeCached(key: string, b: CardBuild, dir = CACHE_DIR): void {
  mkdirSync(dir, { recursive: true });
  const json = {
    pattern: { ...b.pattern, cells: base64Encode(b.pattern.cells) },
    ...(b.log ? { log: b.log } : {}),
    ...(b.focus ? { focus: base64Encode(b.focus) } : {}),
    ...(b.guard !== undefined ? { guard: b.guard } : {}),
  };
  // сначала во временный файл, потом переименование: прерванная сборка не оставляет обрывка, а соседняя
  // сборка (другая копия репозитория с теми же node_modules) не прочтёт половину файла
  const f = fileOf(key, dir);
  const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(json));
  renameSync(tmp, f);
}

/** Сколько дней узор живёт в кэше без спроса. */
export const CACHE_DAYS = 7;

/**
 * Убирает узоры, которых не брали `CACHE_DAYS` дней, и обрывки временных файлов: кэш не растёт от версии
 * к версии кода сборки. По давности, а не по списку нужных: кэш могут делить копии репозитория с разным
 * кодом сборки — узоры соседней копии остаются.
 */
export function pruneCache(now = Date.now(), dir = CACHE_DIR): number {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const name of readdirSync(dir)) {
    const f = join(dir, name);
    try {
      if (now - statSync(f).mtimeMs <= CACHE_DAYS * 86_400_000) continue;
      unlinkSync(f);
      n++;
    } catch {
      // файл убрала соседняя сборка
    }
  }
  return n;
}

if (import.meta.main) {
  const arg = process.argv[2];
  if (arg === '--files') console.log(builderFiles().join('\n'));
  else if (arg === '--touches') {
    const at = process.argv.indexOf('--base');
    const baseLock = at > 0 && process.argv[at + 1] ? gitShow(process.argv[at + 1], LOCK) : null;
    console.log(touchesBuilder(readFileSync(0, 'utf8').split('\n'), baseLock) ? 'yes' : 'no');
  } else console.log(builderPrint());
}
