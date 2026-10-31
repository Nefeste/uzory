// Кэш узоров сборки картинок (tools/content/cache.ts; вопрос владельца 31.10.2026 о времени проверки PR):
// ключ меняется от всего, что меняет узор, и только от этого; кэш отдаёт ровно записанное; код сборки —
// весь граф импортов tools/content/build.ts.
import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import type { Pattern } from '../../src/engine/pattern';
import { builderFiles, CACHE_DAYS, type CardBuild, cardKey, pruneCache, readCached, touchesBuilder, writeCached } from '../content/cache';
import { type Card, ROOT } from '../content/cards';

const tmp = mkdtempSync(join(tmpdir(), 'uzory-cache-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** Карточка снимка с исходником `bytes` в своей папке. */
function photoCard(name: string, bytes: string, patch: Partial<Card> = {}): Card {
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'src.jpg'), bytes);
  return {
    id: 'test-card', v: 2, title: 'Проба', collection: 'painting', order: 0,
    source: { file: 'src.jpg', url: 'https://example.org/src.jpg', basis: 'PD' },
    pattern: { size: 40, threads: 12 },
    path: join(dir, 'test-card.yaml'), dir,
    ...patch,
  } as Card;
}

describe('ключ узора', () => {
  test('где лежит карточка — не важно; поле карточки, версия и байты исходника — важны', () => {
    const a = photoCard('a', 'один и тот же снимок');
    const moved = photoCard('moved', 'один и тот же снимок');
    expect(cardKey(moved, 2)).toBe(cardKey(a, 2));
    expect(cardKey(a, 1)).not.toBe(cardKey(a, 2));
    expect(cardKey(photoCard('threads', 'один и тот же снимок', { pattern: { size: 40, threads: 13 } }), 2)).not.toBe(cardKey(a, 2));
    expect(cardKey(photoCard('title', 'один и тот же снимок', { title: 'Другая' }), 2)).not.toBe(cardKey(a, 2));
    expect(cardKey(photoCard('bytes', 'снимок переснят'), 2)).not.toBe(cardKey(a, 2));
  });
});

describe('кэш', () => {
  const pattern: Pattern = {
    key: 'test-card@2', w: 3, h: 2, threads: [{ rgb: 0xc8102e, name: 'красная' }, { rgb: 0x2e4a1e, name: 'зелёная' }],
    cells: Uint8Array.from([0, 1, 255, 1, 0, 255]),
  };
  const build: CardBuild = {
    pattern,
    log: { asked: 12, afterKmeans: 11, afterMerge: 9, final: 2, singlesBefore: 4, smallBefore: 1 },
    focus: Uint8Array.from([0, 0, 1, 1, 0, 0]),
    guard: 3,
  };

  test('отдаёт ровно записанное: узор, журнал сборки, маску лиц; без обрывков временных файлов', () => {
    const dir = join(tmp, 'store');
    writeCached('k1', build, dir);
    expect(readCached('k1', dir)).toEqual(build);
    writeCached('k2', { pattern }, dir);
    expect(readCached('k2', dir)).toEqual({ pattern });
    expect(readdirSync(dir).sort()).toEqual(['k1.json', 'k2.json']);
  });

  test('нет узора или файл испорчен — null: узор собирается заново', () => {
    const dir = join(tmp, 'broken');
    expect(readCached('nope', dir)).toBeNull();
    writeCached('k', build, dir);
    const f = join(dir, 'k.json');
    writeFileSync(f, readFileSync(f, 'utf8').slice(0, 40));
    expect(readCached('k', dir)).toBeNull();
  });

  test(`уходят узоры, которых не брали ${CACHE_DAYS} дней; взятый — снова свежий`, () => {
    const dir = join(tmp, 'prune');
    const day = 86_400_000;
    const now = Date.now();
    for (const k of ['old', 'week', 'taken']) writeCached(k, { pattern }, dir);
    const ago = (k: string, days: number) => utimesSync(join(dir, `${k}.json`), new Date(now - days * day), new Date(now - days * day));
    ago('old', CACHE_DAYS + 1);
    ago('week', CACHE_DAYS - 1);
    ago('taken', CACHE_DAYS + 1);
    expect(readCached('taken', dir)).not.toBeNull();
    expect(pruneCache(now, dir)).toBe(1);
    expect(readdirSync(dir).sort()).toEqual(['taken.json', 'week.json']);
    expect(now - statSync(join(dir, 'taken.json')).mtimeMs).toBeLessThan(day);
  });
});

describe('код сборки', () => {
  // граф импортов, как его видит компилятор TypeScript: регулярное выражение кэша не теряет ни одного файла
  function tsGraph(): string[] {
    const seen = new Set<string>();
    const queue = [join(ROOT, 'tools', 'content', 'build.ts')];
    while (queue.length) {
      const f = queue.pop()!;
      if (seen.has(f)) continue;
      seen.add(f);
      for (const { fileName } of ts.preProcessFile(readFileSync(f, 'utf8'), true, true).importedFiles) {
        if (!fileName.startsWith('.')) continue;
        const base = resolve(dirname(f), fileName);
        const next = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')].find((x) => existsSync(x) && statSync(x).isFile());
        if (next) queue.push(next);
      }
    }
    return [...seen].map((f) => relative(ROOT, f)).sort();
  }

  test('все файлы, которые импортирует tools/content/build.ts, и package-lock.json — и ничего из node_modules', () => {
    const files = builderFiles();
    expect(files.filter((f) => f !== 'package-lock.json')).toEqual(tsGraph());
    expect(files).toContain('package-lock.json');
    for (const f of ['tools/content/build.ts', 'tools/content/cache.ts', 'tools/content/image.ts', 'src/engine/build/palette.ts']) expect(files).toContain(f);
    expect(files.some((f) => f.startsWith('node_modules/'))).toBe(false);
  });

  test('PR меняет код сборки — да; экраны, тесты, карточки и документы — нет', () => {
    expect(touchesBuilder(['docs/06-testing.md', 'src/engine/build/palette.ts'])).toBe(true);
    expect(touchesBuilder(['package-lock.json'])).toBe(true);
    expect(touchesBuilder(['src/screens/HomeScreen.tsx', 'tools/test/content.test.ts', 'content/painting/shishkin-rozh.yaml', 'docs/06-testing.md', ''])).toBe(false);
  });
});
