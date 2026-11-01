// Подпись мастерицы (0.21.0; src/engine/signature.ts): буквы крестиком в пять строк, инициалы и год одной
// строкой или двумя — как влезет в ширину узора; строки — под узором, номера клеток узора не меняются;
// вышитое — только клетки букв; испорченная запись подписи — нет подписи.
import { describe, expect, test } from 'bun:test';
import { CANVAS, type Pattern } from '../../src/engine/pattern';
import {
  cleanInitials, lineWidth, SIGN_ALPHABET, SIGN_GAP, SIGN_ROWS, signCells, signDone, signGrid, signLines, signOf, signPattern, signThread, withSign,
} from '../../src/engine/signature';

const pattern = (w: number, h: number): Pattern => ({
  key: 'sign-test@1', w, h,
  threads: [{ rgb: 0xf2c230, name: 'жёлтая' }, { rgb: 0x1f3c34, name: 'еловая' }, { rgb: 0xb3162f, name: 'кумачовая' }],
  cells: Uint8Array.from({ length: w * h }, (_, i) => i % 3),
});

describe('буквы и строки', () => {
  test('каждая русская буква и цифра — пять строк одной ширины', () => {
    for (const ch of [...SIGN_ALPHABET, ...'0123456789.']) {
      const one = lineWidth(ch === 'Ё' ? 'Е' : ch === 'Й' ? 'И' : ch);
      expect(one, ch).toBeGreaterThan(0);
      const g = signGrid([ch === 'Ё' ? 'Е' : ch === 'Й' ? 'И' : ch]);
      expect(g.h, ch).toBe(SIGN_ROWS);
      expect(g.cells.some((v) => v === 1), ch).toBe(true);
    }
  });

  test('инициалы — только русские буквы, заглавными, не больше трёх; Ё и Й — как Е и И', () => {
    expect(cleanInitials('ек')).toBe('ЕК');
    expect(cleanInitials('ёлка')).toBe('ЕЛК');
    expect(cleanInitials('Й. ab 7')).toBe('И');
    expect(cleanInitials('John')).toBe('');
  });

  test('одной строкой, если влезает; иначе инициалы и год двумя; иначе только инициалы; иначе нет', () => {
    expect(signLines('ек', 2026, 40)).toEqual(['Е.К. 2026']);
    expect(signLines('ек', 2026, 19)).toEqual(['Е.К.', '2026']);
    expect(signLines('ек', 2026, 12)).toEqual(['Е.К.']);
    expect(signLines('ек', 2026, 6)).toBeNull();
    expect(signLines('', 2026, 40)).toBeNull();
    expect(lineWidth('Е.К. 2026')).toBe(31);
  });

  test('сетка подписи: строки через пустую, по правому краю', () => {
    const g = signGrid(['Е.К.', '2026']);
    expect(g.w).toBe(lineWidth('2026'));
    expect(g.h).toBe(2 * SIGN_ROWS + 1);
    // строка между ними — пустая
    for (let x = 0; x < g.w; x++) expect(g.cells[SIGN_ROWS * g.w + x]).toBe(0);
    // «Е.К.» короче «2026» — прижата вправо: левый столбец первой строки пуст
    for (let y = 0; y < SIGN_ROWS; y++) expect(g.cells[y * g.w]).toBe(0);
  });
});

describe('подпись под работой', () => {
  const p = pattern(19, 19);
  const sign = { initials: 'ЕК', year: 2026, thread: 1, done: [] as number[] };

  test('маленький узор подписи — одна нить, клетки букв', () => {
    const mini = signPattern(p, sign)!;
    expect(mini.threads).toEqual([p.threads[1]]);
    const g = signGrid(signLines('ЕК', 2026, 19)!);
    expect(mini.w).toBe(g.w);
    expect([...mini.cells].filter((c) => c === 0).length).toBe(g.cells.reduce((n, v) => n + v, 0));
    expect([...mini.cells].every((c) => c === 0 || c === CANVAS)).toBe(true);
  });

  test('узор с подписью: те же клетки узора, ниже — пустые строки и вышитые клетки подписи', () => {
    const g = signGrid(signLines('ЕК', 2026, 19)!);
    const all = [...g.cells].flatMap((v, i) => (v ? [i] : []));
    const half = { ...sign, done: all.slice(0, 5) };
    const s = withSign(p, half);
    expect(s.w).toBe(p.w);
    expect(s.h).toBe(p.h + SIGN_GAP + g.h);
    expect(Array.from(s.cells.subarray(0, p.cells.length))).toEqual(Array.from(p.cells));
    expect([...s.cells.subarray(p.cells.length)].filter((c) => c === 1).length).toBe(5);
    expect(signCells(p, half)).toHaveLength(5);
    for (const i of signCells(p, half)) expect(s.cells[i]).toBe(1);
    expect(signDone(p, half)).toBe(false);
    expect(signDone(p, { ...sign, done: all })).toBe(true);
    // подписи нет или не влезает — узор как есть
    expect(withSign(p, undefined)).toBe(p);
    expect(withSign(pattern(5, 5), sign).h).toBe(5);
  });

  test('нить подписи — лучше всех видная на ткани канвы', () => {
    expect(signThread(p, 0xf3f0e6)).toBe(1); // ель на кремовой
    expect(signThread(p, 0x262628)).toBe(0); // жёлтая на чёрной
  });

  test('испорченная запись подписи — нет подписи; лишние клетки и повторы отбрасываются', () => {
    expect(signOf({ initials: 'ЕК', year: 2026, thread: 1, done: [1, 1, 2, -1, 'x'] })).toEqual({ initials: 'ЕК', year: 2026, thread: 1, done: [1, 2] });
    expect(signOf({ initials: 'ek', year: 2026, thread: 1, done: [] })).toBeUndefined();
    expect(signOf({ initials: 'ЕК', year: 20260, thread: 1, done: [] })).toBeUndefined();
    expect(signOf({ initials: 'ЕК', year: 2026, thread: 99, done: [] })).toBeUndefined();
    expect(signOf({ initials: 'ЕК', year: 2026, thread: 1 })).toBeUndefined();
    expect(signOf(null)).toBeUndefined();
  });
});
