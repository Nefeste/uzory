// из votchina: tools/test/i18n.test.ts @ 1242776
// Тексты — только в словаре (перенос из «Вотчины»): кириллица в строках кода вне
// src/i18n — ошибка. Движок не в счёт: его сообщения — для сборки и журнала, не для экрана.
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { pluralRu } from '../../src/i18n/plural';
import { ru } from '../../src/i18n/ru';

const ROOT = join(import.meta.dir, '../..');
const CYR = /[А-Яа-яЁё]/;
const SKIP = new Set(['i18n', 'engine', 'generated']);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return SKIP.has(n) ? [] : files(p);
    return /\.tsx?$/.test(n) ? [p] : [];
  });
}

function leaks(path: string): { line: number; text: string }[] {
  const src = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: { line: number; text: string }[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n) || ts.isJsxText(n)) {
      const text = n.text.trim();
      if (CYR.test(text)) out.push({ line: src.getLineAndCharacterOfPosition(n.getStart()).line + 1, text });
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  return out;
}

describe('тексты — только в словаре', () => {
  test('в src и App.tsx нет русских строк вне src/i18n', () => {
    const found: string[] = [];
    for (const f of [...files(join(ROOT, 'src')), join(ROOT, 'App.tsx')]) {
      for (const l of leaks(f)) found.push(`${relative(ROOT, f)}:${l.line}  ${l.text.slice(0, 60)}`);
    }
    expect(found).toEqual([]);
  });
});

describe('склонения', () => {
  test('один, несколько, много', () => {
    const f = (n: number) => pluralRu(n, 'нить', 'нити', 'нитей');
    expect([0, 1, 2, 5, 11, 12, 14, 21, 22, 25, 111, 112, 121].map(f)).toEqual(
      ['нитей', 'нить', 'нити', 'нитей', 'нитей', 'нитей', 'нитей', 'нить', 'нити', 'нитей', 'нитей', 'нитей', 'нить']);
    expect(ru.common.threads(21)).toBe('21 нить');
    expect(ru.common.meta(70, 52, 18, 25)).toBe('70 × 52 · 18 нитей · ≈ 25 мин');
  });

  test('«Готово»: стежки со склонением и разрядами, время — минуты со стежками, без них — без времени', () => {
    const nb = '\u00a0';
    expect(ru.done.stats(120, 2)).toBe('120 стежков · 2 минуты');
    expect(ru.done.stats(121, 1)).toBe('121 стежок · 1 минута');
    expect(ru.done.stats(1203, 89)).toBe('1203 стежка · 89 минут');
    expect(ru.done.stats(116640, 486)).toBe(`116${nb}640 стежков · 8 часов`);
    expect(ru.done.stats(14400, 95)).toBe(`14${nb}400 стежков · 1,5 часа`);
    expect(ru.done.stats(1048576, 1265)).toBe(`1${nb}048${nb}576 стежков · 21 час`);
    expect(ru.done.stats(1048572, 1322)).toBe(`1${nb}048${nb}572 стежка · 22 часа`);
    expect(ru.done.stats(116640, undefined)).toBe(`116${nb}640 стежков`);
    expect(ru.common.percent(65)).toBe(`65${nb}%`);
  });
});
