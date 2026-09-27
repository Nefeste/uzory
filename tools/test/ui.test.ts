// из votchina: tools/test/ui.test.ts @ 1242776
// Крупный системный шрифт (перенос из «Вотчины»): у каждого `Text` — предел FONT_MAX.
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const ROOT = join(import.meta.dir, '../..');
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? files(p) : /\.tsx$/.test(n) ? [p] : [];
});

function unbounded(path: string): string[] {
  const src = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && /^Text(Input)?$/.test(n.tagName.getText(src))) {
      const has = n.attributes.properties.some((a) => ts.isJsxAttribute(a) && a.name.getText(src) === 'maxFontSizeMultiplier');
      if (!has) out.push(`${relative(ROOT, path)}:${src.getLineAndCharacterOfPosition(n.getStart()).line + 1}`);
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  return out;
}

describe('крупный шрифт', () => {
  test('каждый Text ограничен FONT_MAX', () => {
    expect([...files(join(ROOT, 'src')), join(ROOT, 'App.tsx')].flatMap(unbounded)).toEqual([]);
  });
});
