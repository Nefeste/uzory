// Проверки узора (docs/09-content.md, §6; src/engine/build/checks.ts): испорченный узор не проходит —
// одиночная клетка у «Детям», нить из одних одиночек, неразличимые нити, нить меньше восьми клеток,
// мелкие пятна больше 3 % (docs/specs/2026-09-content-pipeline.md, критерий 3: образцы-карточки
// ловят схему карточки, здесь — сам узор).
import { describe, expect, test } from 'bun:test';
import { checkPatternWith } from '../../src/engine/build/checks';
import { CANVAS, type Pattern } from '../../src/engine/pattern';

const RED = 0xb3162f;
const GREEN = 0x1f3c34;
const GOLD = 0xd9a441;

/** Узор из строк: буква — нить по порядку `threads`, точка — канва. */
function grid(rows: string[], threads: number[]): Pattern {
  const keys = 'abcdefgh';
  const w = rows[0].length;
  const cells = new Uint8Array(w * rows.length);
  rows.forEach((r, y) => [...r].forEach((ch, x) => { cells[y * w + x] = ch === '.' ? CANVAS : keys.indexOf(ch); }));
  return { key: 'test@1', w, h: rows.length, threads: threads.map((rgb, i) => ({ rgb, name: `нить ${i + 1}` })), cells };
}

/** Чистый узор 12 × 12: три нити полосами по четыре ряда — без одиночек и мелких пятен. */
const clean = () => grid([
  ...Array(4).fill('aaaaaaaaaaaa'),
  ...Array(4).fill('bbbbbbbbbbbb'),
  ...Array(4).fill('cccccccccccc'),
], [RED, GREEN, GOLD]);

describe('проверки узора', () => {
  test('чистый узор проходит — и у «Детям»', () => {
    expect(checkPatternWith(clean(), { kids: true }).errors).toEqual([]);
  });

  test('одна одиночная клетка: у «Детям» — ошибка, у картины — нет', () => {
    const p = clean();
    p.cells[5 * 12 + 5] = 0; // красная клетка посреди зелёной полосы
    expect(checkPatternWith(p, { kids: true }).errors.join()).toContain('одиночных');
    expect(checkPatternWith(p).errors.join()).not.toContain('одиночных');
  });

  test('нить из одних одиночек — ошибка', () => {
    const p = grid([
      ...Array(4).fill('aaaaaaaaaaaa'),
      'bbbbbbbbbbbb', 'bdbbdbbdbbdb', 'bbbbbbbbbbbb', 'bdbbdbbdbbdb',
      ...Array(4).fill('cccccccccccc'),
    ], [RED, GREEN, GOLD, 0x3a5ba0]);
    expect(checkPatternWith(p).errors.join()).toContain('из одних одиночек');
  });

  test('неразличимые нити — ошибка', () => {
    const p = clean();
    p.threads[2] = { rgb: RED + 0x010101, name: 'почти кумачовая' };
    expect(checkPatternWith(p).errors.join()).toContain('неразличимы');
  });

  test('нить меньше восьми клеток — ошибка', () => {
    const p = grid([
      ...Array(4).fill('aaaaaaaaaaaa'),
      'bbbbbbbbbbbb', 'bbbbbddddbbb', 'bbbbbddbbbbb', 'bbbbbbbbbbbb',
      ...Array(4).fill('cccccccccccc'),
    ], [RED, GREEN, GOLD, 0x3a5ba0]);
    expect(checkPatternWith(p).errors.join()).toContain('нужно не меньше 8');
  });

  test('мелкие пятна больше 3 % — ошибка', () => {
    const rows = [...Array(4).fill('aaaaaaaaaaaa'), ...Array(4).fill('bbbbbbbbbbbb'), ...Array(4).fill('cccccccccccc')];
    // пары красных клеток в зелёной полосе: 3 пятна по 2 — 6 клеток из 144, больше 3 %
    rows[5] = 'baabbaabbaab';
    expect(checkPatternWith(grid(rows, [RED, GREEN, GOLD])).errors.join()).toContain('мелких пятнах');
  });
});
